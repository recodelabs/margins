export interface GitHubLocation {
  owner: string;
  repo: string;
  branch: string;
  /** repo-relative path: a file (ends .md), a folder, or "" for repo root. */
  path: string;
}

/** Parse window.location (pathname + ?branch) into a GitHubLocation. owner/repo may be "". */
export function parseGitHubLocation(): GitHubLocation {
  const segments = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const branch =
    new URLSearchParams(window.location.search).get("branch")?.trim() || "main";
  return {
    owner: segments[0] ?? "",
    repo: segments[1] ?? "",
    branch,
    path: segments.slice(2).join("/"),
  };
}

/** Build a path-based href for the given target. */
export function gitHubHref(target: {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
}): string {
  const segs = [target.owner, target.repo];
  if (target.path) segs.push(...target.path.split("/"));
  const encoded = segs.filter(Boolean).map(encodeURIComponent).join("/");
  const branch = target.branch && target.branch.length ? target.branch : "main";
  // Omit ?branch= for the default branch so URLs stay clean and the query is
  // optional — parseGitHubLocation() defaults a missing branch back to "main".
  const qs = branch === "main" ? "" : `?branch=${encodeURIComponent(branch)}`;
  return `/${encoded}${qs}`;
}

// File-type predicates live in `file-types.ts` (the single source of truth).
// Re-exported here so existing routing callers keep importing from one place:
//   - isSupportedPath — can the app open this path at all (listing/routing)?
//   - isMarkdownPath  — does it get the rich-text editor + comment rail?
export { isMarkdownPath, isSupportedPath } from "./file-types";

/**
 * Single SPA-navigation primitive. Pushes `href` onto the history stack, then
 * dispatches a synthetic `popstate` so same-document listeners react the same
 * way they do for browser Back/Forward.
 *
 * `history.pushState` deliberately does NOT fire `popstate` on its own, so
 * without this dispatch an in-app navigation would change the URL without
 * notifying anyone. Routing every programmatic navigation through here means
 * `popstate` is the one channel every listener (App's reactive location,
 * GitHubPicker's folder sync) needs to watch — resolving the ARCH-6 finding
 * that two routing schemes interleaved and `App` had no `popstate` handler.
 */
export function navigate(href: string): void {
  if (
    href ===
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  ) {
    return;
  }
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
