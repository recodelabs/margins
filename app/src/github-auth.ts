const TOKEN_KEY = "roughneck.gh.token";

/** Pull a token out of the URL fragment (set by the auth callback), else from storage. */
export function captureTokenFromUrl(): string | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const fromUrl = params.get("token");
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    // Strip the fragment so the token doesn't linger in the address bar.
    history.replaceState(null, "", window.location.pathname + window.location.search);
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
  sessionStorage.setItem("roughneck.gh.state", state);
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
