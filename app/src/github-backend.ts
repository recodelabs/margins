import {
  type BackendInfo,
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

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}
function pageId(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "");
}
function decodeBase64(b64: string): string {
  const bytes = Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0));
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

  private async readFile(relativePath: string): Promise<Page> {
    const { owner, repo, branch } = this.cfg;
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/contents/${relativePath}?ref=${branch}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    const json = (await res.json()) as { sha: string; content: string };
    const content = decodeBase64(json.content);
    return {
      id: pageId(relativePath),
      title: titleFromContent(content, relativePath.split("/").at(-1) || relativePath),
      content,
      version: json.sha,
    };
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    if (!/\.md$/i.test(relativePath)) {
      throw new Error("Only markdown (.md) files can be opened in roughneck");
    }
    return this.readFile(relativePath);
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page | undefined> {
    if (!/\.md$/i.test(relativePath)) {
      throw new Error("Only markdown (.md) files can be opened in roughneck");
    }
    const { owner, repo, branch } = this.cfg;
    const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${relativePath}`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: `Update ${relativePath}`,
        content: encodeBase64(content),
        sha: expectedVersion,
        branch,
      }),
    });
    if (res.status === 409 || res.status === 422) {
      const errBody = (await res.json().catch(() => ({}))) as { message?: string };
      // 422 is also used for plain validation errors — only a SHA mismatch is a real conflict.
      if (res.status === 422 && !errBody.message?.includes("but expected")) {
        throw new Error(`GitHub save failed (422): ${errBody.message ?? "validation error"}`);
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
    return {
      id: pageId(relativePath),
      title: titleFromContent(content, relativePath.split("/").at(-1) || relativePath),
      content,
      version: json.content.sha,
    };
  }

  async listMarkdownPaths(): Promise<string[]> {
    const { owner, repo, branch } = this.cfg;
    const res = await fetch(`${API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GitHub tree failed (${res.status})`);
    const json = (await res.json()) as {
      tree: Array<{ path: string; type: string }>;
      truncated?: boolean;
    };
    if (json.truncated) {
      throw new Error("GitHub tree listing was truncated (repo too large to list recursively)");
    }
    return json.tree.filter((e) => e.type === "blob" && /\.md$/i.test(e.path)).map((e) => e.path);
  }

  saveAsset(_file: File): Promise<StoredAsset> {
    return Promise.reject(new Error("Asset upload is not supported yet in GitHub mode"));
  }

  resolveFileUrl(path: string): string | null {
    const { owner, repo, branch } = this.cfg;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }

  async openProject(_path: string): Promise<void> {
    // no-op: repo/branch are fixed at construction
  }
}
