import type { ActivityEntry } from "./activity-log";
import { titleFromContent } from "./markdown";
import type {
  BackendCapabilities,
  BackendInfo,
  Page,
  StorageBackend,
  StoredAsset,
} from "./storage";

const PAGES_KEY = "margins:pages";
const ASSETS_KEY = "margins:assets";

// Pre-rename keys. Docs saved before the roughdraft→margins rename live here.
const LEGACY_PAGES_KEY = "roughdraft:pages";
const LEGACY_ASSETS_KEY = "roughdraft:assets";

// One-time migration so the rename doesn't orphan existing local docs: on first
// use, copy any legacy `roughdraft:*` value into its `margins:*` key when the new
// key is empty. Non-destructive (legacy keys are left as-is) and runs at most
// once per page load.
let migratedLegacyKeys = false;
function migrateLegacyKeys(): void {
  if (migratedLegacyKeys) return;
  migratedLegacyKeys = true;
  try {
    for (const [legacy, current] of [
      [LEGACY_PAGES_KEY, PAGES_KEY],
      [LEGACY_ASSETS_KEY, ASSETS_KEY],
    ] as const) {
      if (localStorage.getItem(current) !== null) continue;
      const legacyValue = localStorage.getItem(legacy);
      if (legacyValue !== null) localStorage.setItem(current, legacyValue);
    }
  } catch {
    // storage unavailable / quota — nothing to migrate
  }
}

interface LocalAssetRecord {
  path: string;
  dataUrl: string;
  mimeType: string;
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    // Standard name, plus Firefox's legacy name / numeric codes.
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
  );
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    if (isQuotaExceeded(error)) {
      throw new Error(
        "Browser storage is full. Delete some images or documents and try again.",
      );
    }
    throw error;
  }
}

function readPages(): Record<string, Page> {
  try {
    const raw = localStorage.getItem(PAGES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function writePages(pages: Record<string, Page>): void {
  persist(PAGES_KEY, JSON.stringify(pages));
}

// Parse the asset blob once and reuse it, so resolveFileUrl() doesn't
// re-JSON.parse the entire (potentially large) blob for every image.
let assetCache: Record<string, LocalAssetRecord> | null = null;

function readAssets(): Record<string, LocalAssetRecord> {
  if (assetCache) return assetCache;
  try {
    const raw = localStorage.getItem(ASSETS_KEY);
    assetCache = raw ? JSON.parse(raw) : {};
  } catch {
    assetCache = {};
  }
  return assetCache as Record<string, LocalAssetRecord>;
}

function writeAssets(assets: Record<string, LocalAssetRecord>): void {
  persist(ASSETS_KEY, JSON.stringify(assets));
  assetCache = assets;
}

// Invalidate the cache when another tab mutates the asset blob.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === ASSETS_KEY || event.key === null) {
      assetCache = null;
    }
  });
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function nextAssetPath(
  assets: Record<string, LocalAssetRecord>,
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  const dotIndex = safeName.lastIndexOf(".");
  const basename = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  let counter = 0;

  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const path = `./.roughdraft-assets/${basename}${suffix}${extension}`;
    if (!assets[path]) return path;
    counter += 1;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function normalizeAssetPath(input: string): string {
  if (input.startsWith("./")) return input;
  return `./${input.replace(/^\/+/, "")}`;
}

export class LocalStorageBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "local-storage",
    label: "Browser storage",
    detail: "Saved in this browser only",
  };
  capabilities: BackendCapabilities = {
    documentPath: false,
    manualCommit: false,
    remoteSession: false,
    createFile: false,
    activityLog: false,
  };
  canManageProjects = false;

  constructor() {
    migrateLegacyKeys();
  }

  private async getPage(id: string): Promise<Page> {
    const pages = readPages();
    const page = pages[id];
    if (!page) throw new Error(`Page not found: ${id}`);
    return page;
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    const id = relativePath.replace(/\.md$/i, "");
    return this.getPage(id);
  }

  private async savePage(id: string, content: string): Promise<Page> {
    const pages = readPages();
    if (!pages[id]) throw new Error(`Page not found: ${id}`);
    pages[id].content = content;
    pages[id].title = titleFromContent(content, id);
    writePages(pages);
    return pages[id];
  }

  async saveMarkdownFile(relativePath: string, content: string): Promise<Page> {
    const id = relativePath.replace(/\.md$/i, "");
    return this.savePage(id, content);
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
    const assets = readAssets();
    const markdownPath = nextAssetPath(assets, file.name);
    const dataUrl = await fileToDataUrl(file);

    assets[markdownPath] = {
      path: markdownPath,
      dataUrl,
      mimeType: file.type || "application/octet-stream",
    };
    writeAssets(assets);

    return {
      markdownPath,
      previewUrl: dataUrl,
      mimeType: file.type || "application/octet-stream",
    };
  }

  resolveFileUrl(path: string): string | null {
    const assets = readAssets();
    const normalized = normalizeAssetPath(path);
    return assets[normalized]?.dataUrl ?? null;
  }

  async openProject(_path: string): Promise<void> {
    throw new Error(
      "Local file access is unavailable in browser storage mode.",
    );
  }
}
