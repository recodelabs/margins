import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleSessionExpiry,
  takeSignedOutReason,
} from "../src/session-expiry";
import { GitHubRateLimitError, SessionExpiredError } from "../src/storage";

const TOKEN_KEY = "margins.gh.token";
const REASON_KEY = "margins.signedOutReason";

let assign: ReturnType<typeof vi.fn>;
let originalLocation: Location;

beforeEach(() => {
  sessionStorage.clear();
  assign = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  sessionStorage.clear();
});

describe("handleSessionExpiry", () => {
  it("boots out an expired session: clears the token, records the reason, redirects", () => {
    sessionStorage.setItem(TOKEN_KEY, "dead-token");

    const handled = handleSessionExpiry(new SessionExpiredError());

    expect(handled).toBe(true);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith("/");
    expect(takeSignedOutReason()).toBe("expired");
  });

  it("leaves unrelated errors alone (no token clear, no redirect)", () => {
    sessionStorage.setItem(TOKEN_KEY, "live-token");

    expect(handleSessionExpiry(new Error("boom"))).toBe(false);
    expect(handleSessionExpiry(new GitHubRateLimitError({ status: 403 }))).toBe(
      false,
    );

    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("live-token");
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("takeSignedOutReason", () => {
  it("is one-shot: returns the recorded reason once, then null", () => {
    sessionStorage.setItem(REASON_KEY, "expired");

    expect(takeSignedOutReason()).toBe("expired");
    expect(takeSignedOutReason()).toBeNull();
  });

  it("returns null when no reason was recorded", () => {
    expect(takeSignedOutReason()).toBeNull();
  });
});
