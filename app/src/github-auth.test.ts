import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { completeLoginFromUrl, getStoredToken, clearToken } from "./github-auth";

const originalFetch = global.fetch;

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => {
  global.fetch = originalFetch;
  window.history.replaceState(null, "", "/");
});

/** Put `?code=…&state=…` in the URL the way the auth callback redirect would. */
function setCallbackUrl(query: string) {
  window.history.replaceState(null, "", `/${query}`);
}

describe("github-auth code exchange", () => {
  it("exchanges the code for a token when the returned state matches", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    setCallbackUrl("?code=oauthcode&state=st-1");
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ access_token: "gho_abc" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await completeLoginFromUrl();

    expect(token).toBe("gho_abc");
    expect(getStoredToken()).toBe("gho_abc");
    // token came from the POST body, not the URL
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/token");
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({ code: "oauthcode" });
    // code/state stripped from the URL, and the token never appears in it
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("gho_abc");
    expect(sessionStorage.getItem("margins.gh.state")).toBeNull(); // consumed
  });

  it("rejects the callback (no exchange) when state does not match (CSRF guard)", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    setCallbackUrl("?code=evilcode&state=wrong");
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await completeLoginFromUrl();

    expect(token).toBeNull();
    expect(getStoredToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe(""); // stripped regardless
  });

  it("returns the stored token without exchanging when no code is present", async () => {
    sessionStorage.setItem("margins.gh.token", "gho_stored");
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await completeLoginFromUrl()).toBe("gho_stored");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the stored token if the token endpoint fails", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    sessionStorage.setItem("margins.gh.token", "gho_old");
    setCallbackUrl("?code=oauthcode&state=st-1");
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;

    expect(await completeLoginFromUrl()).toBe("gho_old");
  });

  it("clearToken removes it", () => {
    sessionStorage.setItem("margins.gh.token", "x");
    clearToken();
    expect(getStoredToken()).toBeNull();
  });
});
