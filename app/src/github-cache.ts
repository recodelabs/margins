/**
 * In-memory ETag cache for GitHub GET reads, shared across every
 * `GitHubBackend` instance (the picker and the document workspace each build
 * their own). Keyed by request URL; stores the response ETag alongside the
 * already-parsed result so a `304 Not Modified` can be served without
 * re-parsing — and, importantly, without spending GitHub rate-limit budget.
 *
 * Lifetime is the page session: it is not persisted, so a hard reload starts
 * cold. Conditional requests still keep cross-navigation reads cheap.
 */

export interface CacheEntry<T> {
  etag: string;
  data: T;
}

const store = new Map<string, CacheEntry<unknown>>();

export function getCachedEntry<T>(url: string): CacheEntry<T> | undefined {
  return store.get(url) as CacheEntry<T> | undefined;
}

export function setCachedEntry<T>(url: string, etag: string, data: T): void {
  store.set(url, { etag, data });
}

export function invalidateCachedUrl(url: string): void {
  store.delete(url);
}

/** Test helper — drop everything so cases don't leak ETags into each other. */
export function clearGitHubCache(): void {
  store.clear();
}
