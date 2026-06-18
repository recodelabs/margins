import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearToken,
  completeLoginFromUrl,
  getStoredToken,
  login,
} from "./github-auth";

const originalFetch = global.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalLocation) {
    Object.defineProperty(window, "location", originalLocation);
  }
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

/** Put `?code=…&state=…` in the URL the way the auth callback redirect would. */
function setCallbackUrl(query: string) {
  window.history.replaceState(null, "", `/${query}`);
}

/**
 * Swap `window.location` for a fake snapshotting the current URL, exposing
 * spyable `assign`/`replace` (jsdom's real ones are non-configurable and also
 * unimplemented). Reads (pathname/search/hash) reflect the URL at call time.
 */
function stubLocation(): {
  assign: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
} {
  const url = new URL(window.location.href);
  const assign = vi.fn();
  const replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return url.href;
      },
      get origin() {
        return url.origin;
      },
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
      get hash() {
        return url.hash;
      },
      assign,
      replace,
    },
  });
  return { assign, replace };
}

describe("github-auth code exchange", () => {
  it("exchanges the code for a token when the returned state matches", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    setCallbackUrl("?code=oauthcode&state=st-1");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "gho_abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await completeLoginFromUrl();

    expect(token).toBe("gho_abc");
    expect(getStoredToken()).toBe("gho_abc");
    // token came from the POST body, not the URL
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/token");
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({
      code: "oauthcode",
    });
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
    global.fetch = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;

    expect(await completeLoginFromUrl()).toBe("gho_old");
  });

  it("clearToken removes it", () => {
    sessionStorage.setItem("margins.gh.token", "x");
    clearToken();
    expect(getStoredToken()).toBeNull();
  });
});

describe("github-auth post-login redirect (returnTo)", () => {
  it("saves the current location as returnTo when login starts", () => {
    window.history.replaceState(
      null,
      "",
      "/ona-health/echis-datafi/ig/fhir-inventory.md?branch=develop#frag",
    );
    const { assign } = stubLocation();

    login();

    expect(sessionStorage.getItem("margins.gh.returnTo")).toBe(
      "/ona-health/echis-datafi/ig/fhir-inventory.md?branch=develop#frag",
    );
    // still kicks off the OAuth round-trip
    expect(assign).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/login?state="),
    );
  });

  it("redirects back to returnTo after a successful exchange", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    sessionStorage.setItem(
      "margins.gh.returnTo",
      "/ona-health/echis-datafi/ig/fhir-inventory.md?branch=develop",
    );
    setCallbackUrl("?code=oauthcode&state=st-1");
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "gho_abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { replace } = stubLocation();

    const token = await completeLoginFromUrl();

    expect(token).toBe("gho_abc");
    expect(replace).toHaveBeenCalledWith(
      "/ona-health/echis-datafi/ig/fhir-inventory.md?branch=develop",
    );
    // consumed so a later in-app login doesn't bounce the user around
    expect(sessionStorage.getItem("margins.gh.returnTo")).toBeNull();
  });

  it("does not redirect when state is rejected (CSRF guard)", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    sessionStorage.setItem("margins.gh.returnTo", "/somewhere/private.md");
    setCallbackUrl("?code=evilcode&state=wrong");
    global.fetch = vi.fn() as unknown as typeof fetch;
    const { replace } = stubLocation();

    await completeLoginFromUrl();

    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("margins.gh.returnTo")).toBeNull(); // cleared regardless
  });

  it("does not redirect when there is no stored returnTo", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    setCallbackUrl("?code=oauthcode&state=st-1");
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "gho_abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { replace } = stubLocation();

    await completeLoginFromUrl();

    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores an absolute/protocol-relative returnTo (open-redirect guard)", async () => {
    sessionStorage.setItem("margins.gh.state", "st-1");
    sessionStorage.setItem("margins.gh.returnTo", "//evil.example.com/phish");
    setCallbackUrl("?code=oauthcode&state=st-1");
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "gho_abc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { replace } = stubLocation();

    await completeLoginFromUrl();

    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("margins.gh.returnTo")).toBeNull();
  });
});
