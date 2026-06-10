import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { captureTokenFromUrl, getStoredToken, clearToken } from "./github-auth";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { window.location.hash = ""; });

describe("github-auth token capture", () => {
  it("captures a token from the URL fragment and stores it in sessionStorage", () => {
    window.location.hash = "#token=gho_abc";
    const token = captureTokenFromUrl();
    expect(token).toBe("gho_abc");
    expect(getStoredToken()).toBe("gho_abc");
    expect(window.location.hash).toBe(""); // fragment cleared after capture
  });

  it("returns the stored token when no fragment is present", () => {
    sessionStorage.setItem("roughneck.gh.token", "gho_stored");
    expect(captureTokenFromUrl()).toBe("gho_stored");
  });

  it("clearToken removes it", () => {
    sessionStorage.setItem("roughneck.gh.token", "x");
    clearToken();
    expect(getStoredToken()).toBeNull();
  });
});
