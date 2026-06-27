import { serializeForChangeCheck } from "./activity-live";
import {
  type ActivityEntry,
  activityLogPath,
  appendActivityLine,
  parseActivityLog,
} from "./activity-log";
import { isSupportedPath } from "./file-types";
import { invalidateCachedUrl } from "./github-cache";
import { githubFetch, githubGet } from "./github-fetch";
import type { FileMeta } from "./github-tree";
import { titleFromContent } from "./markdown";
import {
  type BackendCapabilities,
  type BackendInfo,
  FileTooLargeError,
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
  type StoredAsset,
} from "./storage";

export interface GitHubBackendConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  login: string;
}

/** Last-commit metadata for a single file, as shown in the file list. */
export interface FileCommitInfo {
  /** ISO 8601 committed date of the most recent commit touching the file. */
  date: string;
  /** Commit author's display name (may be empty if GitHub omits it). */
  authorName: string;
  /** Author's GitHub login when the commit maps to a user, else null. */
  authorLogin: string | null;
}

const API = "https://api.github.com";
const ACTIVITY_POLL_MS = 10_000;

function pageId(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "");
}
function decodeBase64(b64: string): string {
  const bytes = Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) =>
    c.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((byte) => {
    bin += String.fromCharCode(byte);
  });
  return btoa(bin);
}

/** Sanitise a path segment so it's safe to embed in a git branch name. */
function branchSafe(segment: string): string {
  return (
    segment
      .replace(/[^a-zA-Z0-9._/-]+/g, "-")
      .replace(/^[-./]+|[-./]+$/g, "")
      .replace(/\.\.+/g, "-") || "x"
  );
}

export class GitHubBackend implements StorageBackend {
  info: BackendInfo;
  capabilities: BackendCapabilities = {
    documentPath: false,
    manualCommit: true,
    remoteSession: false,
    createFile: true,
    activityLog: true,
    pullRequests: true,
  };
  canManageProjects = false;
  private cfg: GitHubBackendConfig;

  /**
   * "Propose changes" mode. When on, commits land on a working branch
   * ({@link workingBranch}) instead of the selected base branch, and saving
   * opens (or reuses) a Pull Request back to the base. Off by default, so the
   * straight-to-branch behaviour is unchanged until the user opts in.
   */
  private proposeChanges = false;
  /** Set once the working branch is known to exist (created or already there). */
  private workingBranchEnsured = false;
  /** In-flight ensure, so concurrent saves don't each try to create the branch. */
  private ensurePromise: Promise<void> | null = null;
  /** Cached open-PR URL, so we only create/look it up once per session. */
  private prUrl: string | null = null;

  constructor(cfg: GitHubBackendConfig) {
    this.cfg = cfg;
    this.info = {
      kind: "github",
      label: "GitHub",
      detail: `${cfg.owner}/${cfg.repo}@${cfg.branch}`,
      authorLabel: cfg.login,
    };
  }

  /** Stable per-user working branch for this repo, e.g. `margins/octocat/main`. */
  private get workingBranch(): string {
    return `margins/${branchSafe(this.cfg.login)}/${branchSafe(this.cfg.branch)}`;
  }

  /**
   * The branch every read/write targets right now. In propose-changes mode this
   * is the working branch *once it exists* — until the first write creates it,
   * reads still come from the base branch (where the content is identical), so
   * we never address a branch that isn't there.
   */
  private get ref(): string {
    return this.proposeChanges && this.workingBranchEnsured
      ? this.workingBranch
      : this.cfg.branch;
  }

  /** Turn propose-changes mode on or off for this session. */
  setProposeChanges(enabled: boolean): void {
    this.proposeChanges = enabled;
  }

  /** Whether propose-changes mode is currently on. */
  get isProposingChanges(): boolean {
    return this.proposeChanges;
  }

  /** The open PR's URL once one has been created/found, else null. */
  pullRequestUrl(): string | null {
    return this.proposeChanges ? this.prUrl : null;
  }

  /**
   * Ensure the working branch exists before a write lands on it. Creates it off
   * the current base-branch head; a 422 means it already exists (reuse it). A
   * no-op outside propose-changes mode and after the branch is known to exist.
   */
  private ensureWorkingBranch(): Promise<void> {
    if (!this.proposeChanges || this.workingBranchEnsured) {
      return Promise.resolve();
    }
    if (!this.ensurePromise) {
      this.ensurePromise = this.createWorkingBranch().then(
        () => {
          this.workingBranchEnsured = true;
        },
        (err) => {
          // Let the next write retry instead of wedging on a transient failure.
          this.ensurePromise = null;
          throw err;
        },
      );
    }
    return this.ensurePromise;
  }

  private async createWorkingBranch(): Promise<void> {
    const { owner, repo, branch } = this.cfg;
    const refRes = await githubFetch(
      `${API}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
      { headers: this.headers() },
    );
    if (!refRes.ok) {
      throw new Error(`GitHub base ref read failed (${refRes.status})`);
    }
    const refJson = (await refRes.json()) as { object?: { sha?: string } };
    const sha = refJson.object?.sha;
    if (!sha) throw new Error("GitHub base ref had no commit sha");

    const createRes = await githubFetch(
      `${API}/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ref: `refs/heads/${this.workingBranch}`,
          sha,
        }),
      },
    );
    // 422 == the ref already exists; reuse it rather than erroring.
    if (createRes.ok || createRes.status === 422) return;
    throw new Error(
      `GitHub working branch create failed (${createRes.status})`,
    );
  }

  /**
   * Make sure an open PR exists from the working branch back to the base, and
   * cache its URL. Best-effort: the commit has already landed, so a PR failure
   * is logged rather than thrown (it would otherwise fail an otherwise-good
   * save). A 422 means a PR is already open — look it up and reuse it.
   */
  private async ensurePullRequest(): Promise<void> {
    if (!this.proposeChanges || this.prUrl) return;
    const { owner, repo, branch, login } = this.cfg;
    try {
      const res = await githubFetch(`${API}/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: `margins: changes from ${login}`,
          head: this.workingBranch,
          base: branch,
          body: "Proposed from [margins](https://github.com/recodelabs/margins).",
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { html_url?: string };
        if (json.html_url) this.prUrl = json.html_url;
        return;
      }
      if (res.status === 422) {
        this.prUrl = await this.findOpenPullRequest();
        return;
      }
      throw new Error(`GitHub pull request failed (${res.status})`);
    } catch (error) {
      console.error("Could not open pull request:", error);
    }
  }

  private async findOpenPullRequest(): Promise<string | null> {
    const { owner, repo, branch } = this.cfg;
    const url =
      `${API}/repos/${owner}/${repo}/pulls` +
      `?head=${owner}:${this.workingBranch}&base=${branch}&state=open`;
    const res = await githubFetch(url, { headers: this.headers() });
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ html_url?: string }>;
    return list[0]?.html_url ?? null;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: "application/vnd.github+json",
      ...extra,
    };
  }

  private contentsUrl(relativePath: string): string {
    const { owner, repo } = this.cfg;
    return `${API}/repos/${owner}/${repo}/contents/${relativePath}?ref=${this.ref}`;
  }

  private async readFile(relativePath: string): Promise<Page> {
    return githubGet(
      this.contentsUrl(relativePath),
      this.headers(),
      async (res) => {
        if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
        const json = (await res.json()) as {
          sha: string;
          content: string;
          encoding?: string;
          size?: number;
        };
        // The Contents API only returns inline content for files up to 1 MB. For
        // larger files it responds with `encoding: "none"` and an empty `content`,
        // which would otherwise decode to "" and silently open an empty editor —
        // and a later autosave would overwrite the real file with emptiness.
        if (
          json.encoding === "none" ||
          (json.content === "" && (json.size ?? 0) > 0)
        ) {
          throw new FileTooLargeError(relativePath, json.size);
        }
        const content = decodeBase64(json.content);
        return {
          id: pageId(relativePath),
          title: titleFromContent(
            content,
            relativePath.split("/").at(-1) || relativePath,
          ),
          content,
          version: json.sha,
        };
      },
    );
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    if (!isSupportedPath(relativePath)) {
      throw new Error("This file type can't be opened in margins");
    }
    return this.readFile(relativePath);
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page> {
    if (!isSupportedPath(relativePath)) {
      throw new Error("This file type can't be opened in margins");
    }
    // In propose-changes mode this creates the working branch (if needed) so the
    // commit below lands there and `this.ref` resolves to it.
    await this.ensureWorkingBranch();
    const { owner, repo } = this.cfg;
    const res = await githubFetch(
      `${API}/repos/${owner}/${repo}/contents/${relativePath}`,
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: `Update ${relativePath}`,
          content: encodeBase64(content),
          sha: expectedVersion,
          branch: this.ref,
        }),
      },
    );
    if (res.status === 409 || res.status === 422) {
      const errBody = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      // 422 is also used for plain validation errors — only a SHA mismatch is a real conflict.
      if (res.status === 422 && !errBody.message?.includes("but expected")) {
        throw new Error(
          `GitHub save failed (422): ${errBody.message ?? "validation error"}`,
        );
      }
      let current: Page;
      try {
        current = await this.readFile(relativePath);
      } catch {
        throw new Error(
          `GitHub conflict detected but the current file could not be re-read (${res.status})`,
        );
      }
      throw new MarkdownFileConflictError(current);
    }
    if (!res.ok) throw new Error(`GitHub save failed (${res.status})`);
    const json = (await res.json()) as { content: { sha: string } };
    // The file changed on the server — drop any cached read so the next open
    // re-fetches (and re-conditionalises) instead of serving stale content.
    invalidateCachedUrl(this.contentsUrl(relativePath));
    // The working branch now has a commit ahead of base — open (or reuse) a PR.
    await this.ensurePullRequest();
    return {
      id: pageId(relativePath),
      title: titleFromContent(
        content,
        relativePath.split("/").at(-1) || relativePath,
      ),
      content,
      version: json.content.sha,
    };
  }

  async createMarkdownFile(
    relativePath: string,
    content: string,
  ): Promise<Page> {
    if (!isSupportedPath(relativePath)) {
      throw new Error("This file type can't be created in margins");
    }
    await this.ensureWorkingBranch();
    const { owner, repo } = this.cfg;
    const res = await githubFetch(
      `${API}/repos/${owner}/${repo}/contents/${relativePath}`,
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: `Create ${relativePath}`,
          content: encodeBase64(content),
          branch: this.ref,
        }),
      },
    );
    // A no-sha PUT to an existing path 422s with a message about the missing
    // sha — surface that as a friendly collision error. Other 422s are real
    // validation failures, so pass GitHub's message through instead of
    // mislabeling them as collisions (mirrors saveMarkdownFile's 422 handling).
    if (res.status === 422) {
      const errBody = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      const msg = errBody.message ?? "";
      if (/sha.*supplied|already exists/i.test(msg)) {
        throw new Error(`A file named "${relativePath}" already exists`);
      }
      throw new Error(
        `GitHub create failed (422): ${msg || "validation error"}`,
      );
    }
    if (!res.ok) throw new Error(`GitHub create failed (${res.status})`);
    const json = (await res.json()) as { content: { sha: string } };
    invalidateCachedUrl(this.contentsUrl(relativePath));
    await this.ensurePullRequest();
    return {
      id: pageId(relativePath),
      title: titleFromContent(
        content,
        relativePath.split("/").at(-1) || relativePath,
      ),
      content,
      version: json.content.sha,
    };
  }

  private async readActivityRaw(
    path: string,
  ): Promise<{ text: string; sha: string } | null> {
    const res = await githubFetch(this.contentsUrl(path), {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub activity read failed (${res.status})`);
    const json = (await res.json()) as {
      sha: string;
      content: string;
      encoding?: string;
      size?: number;
    };
    // The Contents API only inlines content for files ≤1 MB. For larger files it
    // returns encoding:"none" with empty content but a real sha — decoding that
    // would produce "" and a subsequent PUT would overwrite the entire history.
    if (
      json.encoding === "none" ||
      (json.content === "" && (json.size ?? 0) > 0)
    ) {
      throw new FileTooLargeError(path, json.size);
    }
    return { text: decodeBase64(json.content), sha: json.sha };
  }

  async readActivityLog(docPath: string): Promise<ActivityEntry[]> {
    const raw = await this.readActivityRaw(activityLogPath(docPath));
    return raw ? parseActivityLog(raw.text) : [];
  }

  watchActivityLog(
    docPath: string,
    onChange: (entries: ActivityEntry[]) => void,
  ): () => void {
    let disposed = false;
    let lastSig: string | null = null;

    const tick = async () => {
      try {
        const entries = await this.readActivityLog(docPath);
        if (disposed) return;
        const sig = serializeForChangeCheck(entries);
        if (sig !== lastSig) {
          lastSig = sig;
          onChange(entries);
        }
      } catch (error) {
        console.error("activity-log poll failed:", error);
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, ACTIVITY_POLL_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }

  commitUrl(sha: string): string {
    const { owner, repo } = this.cfg;
    return `https://github.com/${owner}/${repo}/commit/${sha}`;
  }

  async appendActivityEntry(
    docPath: string,
    entry: ActivityEntry,
  ): Promise<void> {
    // Settle on one branch up front so the read-sha and the write target match.
    await this.ensureWorkingBranch();
    const { owner, repo } = this.cfg;
    const path = activityLogPath(docPath);

    // GET the current sha then PUT with it. If another writer appended in
    // between, GitHub 422s on the stale sha — re-read and retry once.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await this.readActivityRaw(path);
      const nextText = appendActivityLine(existing?.text ?? "", entry);
      const res = await githubFetch(
        `${API}/repos/${owner}/${repo}/contents/${path}`,
        {
          method: "PUT",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            message: `chore(margins): activity (${entry.role}) on ${docPath}`,
            content: encodeBase64(nextText),
            sha: existing?.sha,
            branch: this.ref,
          }),
        },
      );
      if (res.ok) {
        invalidateCachedUrl(this.contentsUrl(path));
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as {
        message?: string;
      };
      const isStaleSha =
        res.status === 422 && (errBody.message ?? "").includes("but expected");
      if (isStaleSha && attempt === 0) continue;
      throw new Error(
        `GitHub activity append failed (${res.status}): ${errBody.message ?? "error"}`,
      );
    }
  }

  async listMarkdownPaths(): Promise<FileMeta[]> {
    const { owner, repo } = this.cfg;
    const url = `${API}/repos/${owner}/${repo}/git/trees/${this.ref}?recursive=1`;
    return githubGet(url, this.headers(), async (res) => {
      if (!res.ok) throw new Error(`GitHub tree failed (${res.status})`);
      const json = (await res.json()) as {
        tree: Array<{ path: string; type: string; size?: number }>;
        truncated?: boolean;
      };
      if (json.truncated) {
        throw new Error(
          "GitHub tree listing was truncated (repo too large to list recursively)",
        );
      }
      return json.tree
        .filter((e) => e.type === "blob" && isSupportedPath(e.path))
        .map((e) => ({ path: e.path, size: e.size ?? 0 }));
    });
  }

  /**
   * Last-commit metadata (date + author) for a set of paths, fetched in a
   * single GraphQL call. Used by the file list to show "last modified … by …".
   * Paths with no commit history (shouldn't normally happen for tracked files)
   * are simply absent from the returned map. Returns an empty map — with no
   * network call — for an empty input.
   *
   * The query aliases one `history(first: 1, path: …)` per file off the branch
   * head commit, so it's one round-trip per folder view regardless of count.
   */
  async listPathCommitInfo(
    paths: string[],
  ): Promise<Map<string, FileCommitInfo>> {
    const result = new Map<string, FileCommitInfo>();
    if (paths.length === 0) return result;

    const { owner, repo } = this.cfg;
    const ref = this.ref;
    const fields = paths
      .map(
        (path, i) =>
          `f${i}: object(expression: ${JSON.stringify(ref)}) { ` +
          `... on Commit { history(first: 1, path: ${JSON.stringify(path)}) { ` +
          `nodes { committedDate author { name user { login } } } } } }`,
      )
      .join("\n");
    const query = `query { repository(owner: ${JSON.stringify(
      owner,
    )}, name: ${JSON.stringify(repo)}) {\n${fields}\n} }`;

    const res = await githubFetch(`${API}/graphql`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      throw new Error(`GitHub commit info failed (${res.status})`);
    }
    const json = (await res.json()) as {
      data?: {
        repository?: Record<
          string,
          {
            history?: {
              nodes?: Array<{
                committedDate: string;
                author?: {
                  name?: string;
                  user?: { login?: string } | null;
                } | null;
              }>;
            };
          } | null
        >;
      };
    };

    const repository = json.data?.repository;
    if (!repository) return result;

    paths.forEach((path, i) => {
      const node = repository[`f${i}`]?.history?.nodes?.[0];
      if (!node) return;
      result.set(path, {
        date: node.committedDate,
        authorName: node.author?.name ?? "",
        authorLogin: node.author?.user?.login ?? null,
      });
    });

    return result;
  }

  saveAsset(_file: File): Promise<StoredAsset> {
    return Promise.reject(
      new Error("Asset upload is not supported yet in GitHub mode"),
    );
  }

  resolveFileUrl(path: string): string | null {
    const { owner, repo } = this.cfg;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${this.ref}/${path}`;
  }

  async openProject(_path: string): Promise<void> {
    // no-op: repo/branch are fixed at construction
  }

  /**
   * Whether the signed-in user has push (write) access to the repo, read from
   * `GET /repos/{owner}/{repo}`'s `permissions.push`. Returns false on any error
   * (fail safe: hide edit controls rather than offer a commit that 403s).
   */
  async getRepoPermission(): Promise<boolean> {
    const { owner, repo } = this.cfg;
    try {
      const res = await fetch(`${API}/repos/${owner}/${repo}`, {
        headers: this.headers(),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { permissions?: { push?: boolean } };
      return json.permissions?.push === true;
    } catch {
      return false;
    }
  }
}
