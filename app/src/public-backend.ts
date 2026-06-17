import type { ActivityEntry } from "./activity-log";
import { titleFromContent } from "./markdown";
import type {
  BackendCapabilities,
  BackendInfo,
  Page,
  StorageBackend,
  StoredAsset,
} from "./storage";

export interface PublicBackendConfig {
  owner: string;
  repo: string;
  path: string;
}

/** Thrown when the public endpoint reports the doc isn't public/available (404). */
export class PublicDocNotFoundError extends Error {
  constructor() {
    super("This document is not publicly shared.");
    this.name = "PublicDocNotFoundError";
  }
}

const READ_ONLY = "This document is read-only (public view).";

/**
 * Read-only backend for logged-out visitors. Fetches a single doc from the
 * Phase-1A `/api/public/doc` endpoint (which serves only `public: true` files,
 * comment-stripped). Every write rejects.
 */
export class PublicBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "public",
    label: "Public",
    detail: "Read-only",
  };
  capabilities: BackendCapabilities = {
    documentPath: false,
    manualCommit: false,
    remoteSession: false,
    createFile: false,
    activityLog: false,
  };
  canManageProjects = false;

  private cfg: PublicBackendConfig;

  constructor(cfg: PublicBackendConfig) {
    this.cfg = cfg;
  }

  async getMarkdownFile(_relativePath: string): Promise<Page> {
    const { owner, repo, path } = this.cfg;
    const url = `/api/public/doc?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url);
    if (res.status === 404) throw new PublicDocNotFoundError();
    if (!res.ok) throw new Error(`Public document load failed (${res.status})`);
    const body = (await res.json()) as { markdown: string };
    return {
      id: path,
      title: titleFromContent(body.markdown, path.split("/").at(-1) || path),
      content: body.markdown,
    };
  }

  saveMarkdownFile(): Promise<Page> {
    return Promise.reject(new Error(READ_ONLY));
  }
  createMarkdownFile(): Promise<Page> {
    return Promise.reject(new Error(READ_ONLY));
  }
  readActivityLog(_docPath: string): Promise<ActivityEntry[]> {
    return Promise.resolve([]);
  }
  appendActivityEntry(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  }
  saveAsset(_file: File): Promise<StoredAsset> {
    return Promise.reject(new Error(READ_ONLY));
  }
  resolveFileUrl(_path: string): string | null {
    return null;
  }
  async openProject(_path: string): Promise<void> {
    return;
  }
}
