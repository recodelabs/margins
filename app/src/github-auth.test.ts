import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureTokenFromUrl, clearToken, getStoredToken } from "./github-auth";

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  window.location.hash = "";
});

describe("github-auth token capture", () => {
  it("captures a token when the returned state matches the stored state", () => {
    sessionStorage.setItem("roughneck.gh.state", "st-1");
    window.location.hash = "#token=gho_abc&state=st-1";
    const token = captureTokenFromUrl();
    expect(token).toBe("gho_abc");
    expect(getStoredToken()).toBe("gho_abc");
    expect(window.location.hash).toBe("");
    expect(sessionStorage.getItem("roughneck.gh.state")).toBeNull(); // consumed
  });

  it("rejects a token whose state does not match (CSRF guard)", () => {
    sessionStorage.setItem("roughneck.gh.state", "st-1");
    window.location.hash = "#token=evil&state=wrong";
    const token = captureTokenFromUrl();
    expect(token).toBeNull();
    expect(getStoredToken()).toBeNull();
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
