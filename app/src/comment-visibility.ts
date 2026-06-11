/**
 * Comment visibility is a personal view preference — used e.g. to hide the
 * review annotations while presenting a file. It is persisted across sessions
 * in localStorage rather than per-document, and is independent of the
 * editing / suggesting / viewing interaction mode.
 */

export const COMMENTS_HIDDEN_STORAGE_KEY = "margins:comments-hidden";

/** Read the persisted "comments hidden" preference, defaulting to shown. */
export function readStoredCommentsHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COMMENTS_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    // Storage can be disabled (private mode) or throw on quota — fall back to
    // the default rather than crashing the workspace.
    return false;
  }
}

/** Persist the "comments hidden" preference. Failures are swallowed. */
export function writeStoredCommentsHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COMMENTS_HIDDEN_STORAGE_KEY,
      hidden ? "1" : "0",
    );
  } catch {
    // Ignore persistence failures (e.g. storage disabled / quota exceeded).
  }
}

/**
 * Whether the document's review rail (comments + suggestions) should be shown.
 * The rail only appears when the document actually has annotations AND the
 * reader has not hidden comments.
 */
export function shouldShowReviewRail(
  commentCount: number,
  suggestionCount: number,
  commentsHidden: boolean,
): boolean {
  return !commentsHidden && (commentCount > 0 || suggestionCount > 0);
}
