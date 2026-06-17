import { handleSessionExpiry } from "./session-expiry";

/**
 * Runs an async action and reports any failure instead of letting it escape as
 * an unhandled rejection. Callers fire these handlers as `void runWithError…()`
 * from click handlers, so a thrown error would otherwise vanish silently and
 * leave the UI looking dead. This never rethrows.
 *
 * @param action   The work to run.
 * @param report   Called with a human-readable message when `action` throws.
 * @param fallback Message used when the thrown value is not an `Error` (or has
 *                 an empty message).
 */
export async function runWithErrorFeedback(
  action: () => Promise<void> | void,
  report: (message: string) => void,
  fallback: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    // An expired session boots the user back to sign-in instead of surfacing a
    // raw `… failed (401)`; nothing left to report once that's underway.
    if (handleSessionExpiry(error)) return;
    report(error instanceof Error && error.message ? error.message : fallback);
  }
}
