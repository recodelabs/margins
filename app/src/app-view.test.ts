import { describe, expect, it } from "vitest";
import { resolveAppView } from "./app-view";

/** A baseline params object; each test overrides only what it exercises. */
function params(overrides: Partial<Parameters<typeof resolveAppView>[0]> = {}) {
  return {
    loading: false,
    isRoughdraftFlavoredMarkdownRoute: false,
    isPreviewRoute: false,
    gitHubMode: false,
    hasToken: false,
    githubLocation: { owner: "", repo: "", path: "" },
    loadError: null as string | null,
    rawPath: null as string | null,
    ...overrides,
  };
}

describe("resolveAppView", () => {
  it("shows the loading blank while loading", () => {
    expect(resolveAppView(params({ loading: true }))).toBe("loading");
  });

  it("routes the roughdraft-flavored-markdown path", () => {
    expect(
      resolveAppView(params({ isRoughdraftFlavoredMarkdownRoute: true })),
    ).toBe("roughdraft-flavored-markdown");
  });

  it("routes the preview path", () => {
    expect(resolveAppView(params({ isPreviewRoute: true }))).toBe("preview");
  });

  it("shows the picker in GitHub mode without a token", () => {
    expect(
      resolveAppView(
        params({
          gitHubMode: true,
          hasToken: false,
          githubLocation: { owner: "o", repo: "r", path: "doc.md" },
        }),
      ),
    ).toBe("github-picker");
  });

  it("shows the picker in GitHub mode for a folder (non-markdown) path", () => {
    expect(
      resolveAppView(
        params({
          gitHubMode: true,
          hasToken: true,
          githubLocation: { owner: "o", repo: "r", path: "project" },
        }),
      ),
    ).toBe("github-picker");
  });

  it("shows the document workspace in GitHub mode for a logged-in markdown path even when rawPath is null (regression: was showing the Homepage after SPA navigation from the repo-less root)", () => {
    expect(
      resolveAppView(
        params({
          gitHubMode: true,
          hasToken: true,
          githubLocation: { owner: "o", repo: "r", path: "project/post.md" },
          loadError: null,
          rawPath: null, // frozen null from a mount at the repo-less root "/"
        }),
      ),
    ).toBe("document-workspace");
  });

  it("shows the load error in GitHub mode when a document fails to open", () => {
    expect(
      resolveAppView(
        params({
          gitHubMode: true,
          hasToken: true,
          githubLocation: { owner: "o", repo: "r", path: "project/post.md" },
          loadError: "Could not open that markdown file.",
        }),
      ),
    ).toBe("load-error");
  });

  it("shows the Homepage only in local mode when there is no requested path", () => {
    expect(resolveAppView(params({ gitHubMode: false, rawPath: null }))).toBe(
      "homepage",
    );
  });

  it("shows the document workspace in local mode when a path is requested", () => {
    expect(
      resolveAppView(params({ gitHubMode: false, rawPath: "/notes/todo.md" })),
    ).toBe("document-workspace");
  });

  it("shows the document workspace in GitHub mode on a direct full-load of a markdown URL", () => {
    expect(
      resolveAppView(
        params({
          gitHubMode: true,
          hasToken: true,
          githubLocation: { owner: "o", repo: "r", path: "project/post.md" },
          rawPath: "/o/r/project/post.md",
        }),
      ),
    ).toBe("document-workspace");
  });

  it("renders the workspace for a token-less visitor when a public doc has loaded", () => {
    expect(
      resolveAppView({
        loading: false,
        isRoughdraftFlavoredMarkdownRoute: false,
        isPreviewRoute: false,
        gitHubMode: true,
        hasToken: false,
        publicView: true,
        githubLocation: { owner: "o", repo: "r", path: "doc.md" },
        loadError: null,
        rawPath: null,
      }),
    ).toBe("document-workspace");
  });

  it("still shows the picker for a token-less visitor when no public doc loaded", () => {
    expect(
      resolveAppView({
        loading: false,
        isRoughdraftFlavoredMarkdownRoute: false,
        isPreviewRoute: false,
        gitHubMode: true,
        hasToken: false,
        publicView: false,
        githubLocation: { owner: "o", repo: "r", path: "doc.md" },
        loadError: null,
        rawPath: null,
      }),
    ).toBe("github-picker");
  });
});
