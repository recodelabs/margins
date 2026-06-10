import {
  type StorageBackend,
  type BackendInfo,
  type Page,
  type StoredAsset,
  MarkdownFileConflictError,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Buffer: any;

function decodeBase64(b64: string): string {
  const clean = b64.replace(/\n/g, "");
  if (typeof atob === "function") {
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(clean, "base64").toString("utf8");
}
function encodeBase64(text: string): string {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach((byte) => { bin += String.fromCharCode(byte); });
    return btoa(bin);
  }
  return Buffer.from(text, "utf8").toString("base64");
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
    return this.readFile(relativePath);
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page | undefined> {
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
      const current = await this.readFile(relativePath);
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
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GitHub tree failed (${res.status})`);
    const json = (await res.json()) as { tree: Array<{ path: string; type: string }> };
    return json.tree
      .filter((e) => e.type === "blob" && /\.md$/i.test(e.path))
      .map((e) => e.path);
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
