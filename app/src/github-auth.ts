const TOKEN_KEY = "roughneck.gh.token";
const STATE_KEY = "roughneck.gh.state";

/** Pull a token out of the URL fragment (set by the auth callback), else from storage. */
export function captureTokenFromUrl(): string | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const fromUrl = params.get("token");
  if (fromUrl) {
    const returnedState = params.get("state");
    const expectedState = sessionStorage.getItem(STATE_KEY);
    // Strip the fragment regardless, so a bad token doesn't linger in the URL.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!expectedState || returnedState !== expectedState) {
      return getStoredToken(); // reject the unverified token; fall back to any existing session token
    }
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl;
  }
  return getStoredToken();
}

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Begin the OAuth round-trip. */
export function login(): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  window.location.assign(`/api/auth/login?state=${encodeURIComponent(state)}`);
}

/** Fetch the authenticated user's login for comment attribution. */
export async function fetchLogin(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub /user failed (${res.status})`);
  const json = (await res.json()) as { login: string };
  return json.login;
}
