/**
 * Agent instruction box visibility is a personal view preference — the box that
 * sends instructions to the margins runner. It is persisted across sessions in
 * localStorage rather than per-document, defaulting to shown.
 */

export const AGENT_BOX_HIDDEN_STORAGE_KEY = "margins:agent-box-hidden";

/** Read the persisted "agent box hidden" preference, defaulting to shown. */
export function readStoredAgentBoxHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AGENT_BOX_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    // Storage can be disabled (private mode) or throw on quota — fall back to
    // the default rather than crashing the workspace.
    return false;
  }
}

/** Persist the "agent box hidden" preference. Failures are swallowed. */
export function writeStoredAgentBoxHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AGENT_BOX_HIDDEN_STORAGE_KEY,
      hidden ? "1" : "0",
    );
  } catch {
    // Ignore persistence failures (e.g. storage disabled / quota exceeded).
  }
}
