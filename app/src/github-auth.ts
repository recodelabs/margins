const TOKEN_KEY = "margins.gh.token";
const STATE_KEY = "margins.gh.state";
const RETURN_KEY = "margins.gh.returnTo";

/** Current location as a same-origin relative path (pathname + search + hash). */
function currentRelativePath(): string {
  return (
    window.location.pathname + window.location.search + window.location.hash
  );
}

/**
 * Only same-origin relative paths are safe to redirect to. Rejecting absolute
 * (`https://…`) and protocol-relative (`//host/…`) values keeps a poisoned
 * `returnTo` from turning login into an open redirect.
 */
function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * After a successful login, send the user back to the URL they originally
 * requested (saved by `login()`), then drop it. Lands them on the shared doc
 * instead of the repo picker at `/`.
 */
function redirectToReturnTo(): void {
  const returnTo = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  if (!returnTo || !isSafeReturnPath(returnTo)) return;
  if (returnTo === currentRelativePath()) return; // already here — no reload
  window.location.replace(returnTo);
}

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
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.hash,
  );
  if (!expectedState || returnedState !== expectedState) {
    sessionStorage.removeItem(RETURN_KEY); // don't honor a returnTo from an unverified callback
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
  redirectToReturnTo();
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
  // Remember where we are so the callback — which always lands on `/` — can send
  // the user back to the doc they requested. Survives the trip to github.com and
  // back like STATE_KEY (same tab → sessionStorage persists across navigations).
  sessionStorage.setItem(RETURN_KEY, currentRelativePath());
  window.location.assign(`/api/auth/login?state=${encodeURIComponent(state)}`);
}

/** Fetch the authenticated user's login for comment attribution. */
export async function fetchLogin(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub /user failed (${res.status})`);
  const json = (await res.json()) as { login: string };
  return json.login;
}
