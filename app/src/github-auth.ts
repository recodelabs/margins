const TOKEN_KEY = "margins.gh.token";
const STATE_KEY = "margins.gh.state";

/**
 * Complete the OAuth round-trip if the callback forwarded a single-use `code`
 * (in the query string), else return any stored token. The access token is
 * fetched from the same-origin token endpoint and never appears in the URL.
 */
export async function completeLoginFromUrl(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return getStoredToken();

  const returnedState = params.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  // Strip the code/state from the URL regardless, so they don't linger.
  history.replaceState(null, "", window.location.pathname + window.location.hash);
  if (!expectedState || returnedState !== expectedState) {
    return getStoredToken(); // reject unverified callback; fall back to any existing session token
  }
  sessionStorage.removeItem(STATE_KEY);

  const res = await fetch("/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return getStoredToken();
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) return getStoredToken();
  sessionStorage.setItem(TOKEN_KEY, json.access_token);
  return json.access_token;
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
