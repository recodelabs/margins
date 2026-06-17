import { serializeForChangeCheck } from "./activity-live";
import {
  type ActivityEntry,
  activityLogPath,
  appendActivityLine,
  parseActivityLog,
} from "./activity-log";
import { invalidateCachedUrl } from "./github-cache";
import { githubFetch, githubGet } from "./github-fetch";
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

export class GitHubBackend implements StorageBackend {
  info: BackendInfo;
  capabilities: BackendCapabilities = {
    documentPath: false,
    manualCommit: true,
    remoteSession: false,
    createFile: true,
    activityLog: true,
  };
  canManageProjects = false;
  private cfg: GitHubBackendConfig;

  constructor(cfg: GitHubBackendConfig) {
    this.cfg = cfg;
    this.info = {
      kind: "github",
      label: "GitHub",
      detail: `${cfg.owner}/${cfg.repo}@${cfg.branch}`,
      authorLabel: cfg.login,
    };
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: "application/vnd.github+json",
      ...extra,
    };
  }

  private contentsUrl(relativePath: string): string {
    const { owner, repo, branch } = this.cfg;
    return `${API}/repos/${owner}/${repo}/contents/${relativePath}?ref=${branch}`;
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
    if (!/\.md$/i.test(relativePath)) {
      throw new Error("Only markdown (.md) files can be opened in margins");
    }
    return this.readFile(relativePath);
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page> {
    if (!/\.md$/i.test(relativePath)) {
      throw new Error("Only markdown (.md) files can be opened in margins");
    }
    const { owner, repo, branch } = this.cfg;
    const res = await githubFetch(
      `${API}/repos/${owner}/${repo}/contents/${relativePath}`,
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: `Update ${relativePath}`,
          content: encodeBase64(content),
          sha: expectedVersion,
          branch,
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
    if (!/\.md$/i.test(relativePath)) {
      throw new Error("Only markdown (.md) files can be created in margins");
    }
    const { owner, repo, branch } = this.cfg;
    const res = await githubFetch(
      `${API}/repos/${owner}/${repo}/contents/${relativePath}`,
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: `Create ${relativePath}`,
          content: encodeBase64(content),
          branch,
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
    const { owner, repo, branch } = this.cfg;
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
            branch,
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

  async listMarkdownPaths(): Promise<string[]> {
    const { owner, repo, branch } = this.cfg;
    const url = `${API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    return githubGet(url, this.headers(), async (res) => {
      if (!res.ok) throw new Error(`GitHub tree failed (${res.status})`);
      const json = (await res.json()) as {
        tree: Array<{ path: string; type: string }>;
        truncated?: boolean;
      };
      if (json.truncated) {
        throw new Error(
          "GitHub tree listing was truncated (repo too large to list recursively)",
        );
      }
      return json.tree
        .filter((e) => e.type === "blob" && /\.md$/i.test(e.path))
        .map((e) => e.path);
    });
  }

  saveAsset(_file: File): Promise<StoredAsset> {
    return Promise.reject(
      new Error("Asset upload is not supported yet in GitHub mode"),
    );
  }

  resolveFileUrl(path: string): string | null {
    const { owner, repo, branch } = this.cfg;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
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
