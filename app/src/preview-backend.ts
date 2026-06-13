import type { ActivityEntry } from "./activity-log";
import { titleFromContent } from "./markdown";
import type {
  BackendCapabilities,
  BackendInfo,
  Page,
  StorageBackend,
  StoredAsset,
} from "./storage";

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function nextAssetPath(assets: Map<string, string>, filename: string): string {
  const safeName = sanitizeFilename(filename);
  const dotIndex = safeName.lastIndexOf(".");
  const basename = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  let counter = 0;

  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const path = `./.roughdraft-preview-assets/${basename}${suffix}${extension}`;
    if (!assets.has(path)) return path;
    counter += 1;
  }
}

export class PreviewBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "local-storage",
    label: "Live preview",
    detail: "In memory only",
  };
  capabilities: BackendCapabilities = {
    documentPath: false,
    manualCommit: false,
    remoteSession: false,
    createFile: false,
    activityLog: false,
  };
  canManageProjects = false;

  private page: Page;
  private assets = new Map<string, string>();

  constructor(page: Page) {
    this.page = page;
  }

  getCurrentPage(): Page {
    return this.page;
  }

  async getMarkdownFile(_relativePath: string): Promise<Page> {
    return this.page;
  }

  async saveMarkdownFile(
    _relativePath: string,
    content: string,
  ): Promise<Page> {
    this.page = {
      ...this.page,
      title: titleFromContent(content, this.page.id),
      content,
      version: `memory:${Date.now()}`,
    };

    return this.page;
  }

  async completeReview(
    _relativePath: string,
    _options?: { overallComment?: string },
  ): Promise<{ delivered: boolean }> {
    return { delivered: false };
  }

  createMarkdownFile(_relativePath: string, _content: string): Promise<Page> {
    return Promise.reject(
      new Error("Creating new files is not supported in this backend"),
    );
  }

  readActivityLog(_docPath: string): Promise<ActivityEntry[]> {
    return Promise.resolve([]);
  }
  appendActivityEntry(_docPath: string, _entry: ActivityEntry): Promise<void> {
    return Promise.reject(
      new Error("Activity log is not supported in this backend"),
    );
  }

  async saveAsset(file: File): Promise<StoredAsset> {
    const markdownPath = nextAssetPath(this.assets, file.name);
    const previewUrl = URL.createObjectURL(file);
    this.assets.set(markdownPath, previewUrl);

    return {
      markdownPath,
      previewUrl,
      mimeType: file.type || "application/octet-stream",
    };
  }

  resolveFileUrl(path: string): string | null {
    const normalized = path.startsWith("./")
      ? path
      : `./${path.replace(/^\/+/, "")}`;
    return this.assets.get(normalized) ?? null;
  }

  async openProject(_path: string): Promise<void> {
    return;
  }

  dispose(): void {
    for (const previewUrl of this.assets.values()) {
      URL.revokeObjectURL(previewUrl);
    }
    this.assets.clear();
  }
}
