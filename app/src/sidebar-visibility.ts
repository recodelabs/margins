/**
 * The workspace file-tree sidebar can be collapsed to a thin rail when the
 * reader wants more room for the document. That preference is personal and
 * persisted across sessions in localStorage, mirroring the comment / agent-box
 * visibility toggles.
 */

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "margins:sidebar-collapsed";

/** Read the persisted "sidebar collapsed" preference, defaulting to expanded. */
export function readStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    // Storage can be disabled (private mode) or throw on quota — fall back to
    // the default rather than crashing the workspace.
    return false;
  }
}

/** Persist the "sidebar collapsed" preference. Failures are swallowed. */
export function writeStoredSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    // Ignore persistence failures (e.g. storage disabled / quota exceeded).
  }
}
