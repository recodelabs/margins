/**
 * Graceful logout when a GitHub session expires. Any authenticated GitHub
 * request that comes back `401` throws {@link SessionExpiredError} (see
 * `github-fetch.ts`); the catch sites that would otherwise show a raw
 * `… failed (401)` instead funnel the error through {@link handleSessionExpiry},
 * which clears the dead token and reloads to the sign-in screen. The reason is
 * stashed so the sign-in screen can explain why the user was booted out.
 */
import { clearToken } from "./github-auth";
import { SessionExpiredError } from "./storage";

const SIGNED_OUT_REASON_KEY = "margins.signedOutReason";

export type SignedOutReason = "expired";

/**
 * If `error` signals an expired/invalid GitHub session, boot the user out:
 * clear the stored token, record why (so the sign-in screen can explain), and
 * reload to the sign-in screen. Returns `true` when it handled the error — the
 * caller should stop, since a redirect is underway — and `false` otherwise so
 * the caller can fall back to its normal error reporting.
 */
export function handleSessionExpiry(error: unknown): boolean {
  if (!(error instanceof SessionExpiredError)) return false;
  clearToken();
  try {
    sessionStorage.setItem(SIGNED_OUT_REASON_KEY, "expired");
  } catch {
    // sessionStorage unavailable — proceed with the redirect regardless.
  }
  // Reload to the root sign-in screen, mirroring the manual "Sign out" flow.
  window.location.assign("/");
  return true;
}

/**
 * Read and clear the one-shot reason recorded by {@link handleSessionExpiry}.
 * Returns `null` when the user signed out normally (or never did).
 */
export function takeSignedOutReason(): SignedOutReason | null {
  let reason: string | null = null;
  try {
    reason = sessionStorage.getItem(SIGNED_OUT_REASON_KEY);
    if (reason) sessionStorage.removeItem(SIGNED_OUT_REASON_KEY);
  } catch {
    return null;
  }
  return reason === "expired" ? "expired" : null;
}
