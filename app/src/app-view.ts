import { isSupportedPath } from "./github-route";

/** The distinct top-level screens App can render, decided by `resolveAppView`. */
export type AppView =
  | "loading"
  | "roughdraft-flavored-markdown"
  | "preview"
  | "github-picker"
  | "load-error"
  | "homepage"
  | "document-workspace";

export interface AppViewParams {
  loading: boolean;
  isRoughdraftFlavoredMarkdownRoute: boolean;
  isPreviewRoute: boolean;
  /** Build-time GitHub mode (import.meta.env.VITE_GITHUB_MODE === "1"). */
  gitHubMode: boolean;
  /** Whether a GitHub token is stored for the session. */
  hasToken: boolean;
  /** Whether a public (read-only) doc has loaded for a logged-out visitor. */
  publicView?: boolean;
  githubLocation: { owner: string; repo: string; path: string };
  loadError: string | null;
  /** The local-mode requested path, captured once at mount. */
  rawPath: string | null;
}

/**
 * Pure decision for which top-level screen to render. Extracted from App's JSX
 * so the gating can be unit-tested and can't silently regress.
 *
 * Important invariant: the Homepage is a LOCAL-mode landing page and must never
 * render in GitHub mode. `rawPath` is captured once at mount, so after the OAuth
 * flow lands at the repo-less root ("/") and the user opens a document via SPA
 * navigation, `rawPath` is still null while `githubLocation` points at the file.
 * Gating the Homepage on GitHub mode (not just `rawPath`) keeps that case on the
 * document workspace instead of flashing the landing page.
 */
export function resolveAppView(params: AppViewParams): AppView {
  if (params.loading) return "loading";
  if (params.isRoughdraftFlavoredMarkdownRoute) {
    return "roughdraft-flavored-markdown";
  }
  if (params.isPreviewRoute) return "preview";

  if (params.gitHubMode) {
    const { owner, repo, path } = params.githubLocation;
    const validDocUrl =
      Boolean(owner) && Boolean(repo) && isSupportedPath(path);
    if (!validDocUrl) return "github-picker";
    if (!params.hasToken && !params.publicView) return "github-picker";
  }

  if (params.loadError) return "load-error";

  // The Homepage is the local-files landing page — never show it in GitHub mode.
  if (!params.gitHubMode && !params.rawPath) return "homepage";

  return "document-workspace";
}
