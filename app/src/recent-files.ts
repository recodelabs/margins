/**
 * Recent and pinned files are a personal navigation aid for the workspace
 * file-tree sidebar: they let a reader jump back to files they were just in (or
 * deliberately kept around) without walking the tree again. Both lists are
 * persisted in localStorage, scoped per repository (`owner/repo`) so switching
 * repos shows the right shortcuts, and survive across navigation and reloads.
 */

/** Most recent first. Capped so the sidebar's "Recent" section stays short. */
export const RECENT_FILES_LIMIT = 8;

const RECENT_FILES_STORAGE_KEY = "margins:recent-files";
const PINNED_FILES_STORAGE_KEY = "margins:pinned-files";

/** The localStorage key scoping shortcuts to a single repo. */
export function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

type Store = Record<string, string[]>;

function readStore(storageKey: string): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    // Keep only well-formed `string[]` buckets; drop anything unexpected so one
    // corrupt entry can't poison the whole store.
    const out: Store = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        out[key] = value as string[];
      }
    }
    return out;
  } catch {
    // Malformed JSON, disabled storage, etc. — fall back to empty.
    return {};
  }
}

function writeStore(storageKey: string, store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    // Ignore persistence failures (storage disabled / quota exceeded).
  }
}

/** Read the recent files for a repo, most-recently-opened first. */
export function readRecentFiles(key: string): string[] {
  return readStore(RECENT_FILES_STORAGE_KEY)[key] ?? [];
}

/**
 * Record `path` as the most-recently-opened file in `key`'s repo and return the
 * updated list. Moves an already-present path to the front (dedupe) and caps
 * the list at {@link RECENT_FILES_LIMIT}.
 */
export function recordRecentFile(key: string, path: string): string[] {
  const store = readStore(RECENT_FILES_STORAGE_KEY);
  const existing = store[key] ?? [];
  const next = [path, ...existing.filter((p) => p !== path)].slice(
    0,
    RECENT_FILES_LIMIT,
  );
  store[key] = next;
  writeStore(RECENT_FILES_STORAGE_KEY, store);
  return next;
}

/** Read the pinned files for a repo (insertion order). */
export function readPinnedFiles(key: string): string[] {
  return readStore(PINNED_FILES_STORAGE_KEY)[key] ?? [];
}

/**
 * Toggle `path`'s pinned state in `key`'s repo and return the updated list.
 * Newly-pinned paths are appended so the list stays in pin order.
 */
export function togglePinnedFile(key: string, path: string): string[] {
  const store = readStore(PINNED_FILES_STORAGE_KEY);
  const existing = store[key] ?? [];
  const next = existing.includes(path)
    ? existing.filter((p) => p !== path)
    : [...existing, path];
  store[key] = next;
  writeStore(PINNED_FILES_STORAGE_KEY, store);
  return next;
}
