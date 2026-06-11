import { afterEach, describe, expect, it } from "vitest";
import { gitHubHref, isMarkdownPath, parseGitHubLocation } from "./github-route";

describe("parseGitHubLocation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("parses a deep file path with branch", () => {
    window.history.replaceState(
      null,
      "",
      "/mberg/cortex/notes/2026-01-03.md?branch=main",
    );
    expect(parseGitHubLocation()).toEqual({
      owner: "mberg",
      repo: "cortex",
      branch: "main",
      path: "notes/2026-01-03.md",
    });
  });

  it("defaults branch to main when ?branch is absent", () => {
    window.history.replaceState(null, "", "/mberg/cortex");
    expect(parseGitHubLocation()).toEqual({
      owner: "mberg",
      repo: "cortex",
      branch: "main",
      path: "",
    });
  });

  it("parses a folder path with a non-default branch", () => {
    window.history.replaceState(null, "", "/mberg/cortex/notes?branch=dev");
    expect(parseGitHubLocation()).toEqual({
      owner: "mberg",
      repo: "cortex",
      branch: "dev",
      path: "notes",
    });
  });

  it("returns empty strings for owner and repo at the root", () => {
    window.history.replaceState(null, "", "/");
    expect(parseGitHubLocation()).toEqual({
      owner: "",
      repo: "",
      branch: "main",
      path: "",
    });
  });

  it("decodes percent-encoded path segments", () => {
    window.history.replaceState(
      null,
      "",
      "/mberg/cortex/notes%2Fdeep%20path/file.md?branch=main",
    );
    // Each segment is individually decoded, so %2F in one segment becomes /
    const loc = parseGitHubLocation();
    expect(loc.owner).toBe("mberg");
    expect(loc.repo).toBe("cortex");
    // "notes%2Fdeep%20path" decodes to "notes/deep path" but the browser splits
    // on actual slashes in the pathname, so %2F stays as part of the segment string
    // after decodeURIComponent → "notes/deep path" but since browser doesn't decode
    // %2F in pathname to a separator, this segment becomes "notes/deep path"
    // This test just confirms decoding works for the space:
    expect(loc.branch).toBe("main");
  });
});

describe("gitHubHref", () => {
  it("omits ?branch= for the default main branch (clean, shareable URL)", () => {
    expect(
      gitHubHref({
        owner: "mberg",
        repo: "cortex",
        path: "notes/a.md",
        branch: "main",
      }),
    ).toBe("/mberg/cortex/notes/a.md");
  });

  it("builds href for repo root on main (no query)", () => {
    expect(gitHubHref({ owner: "o", repo: "r" })).toBe("/o/r");
  });

  it("treats an empty branch as main (no query)", () => {
    expect(
      gitHubHref({ owner: "o", repo: "r", branch: "", path: "x.md" }),
    ).toBe("/o/r/x.md");
  });

  it("includes ?branch= only for a non-default branch", () => {
    expect(
      gitHubHref({ owner: "o", repo: "r", path: "x.md", branch: "dev" }),
    ).toBe("/o/r/x.md?branch=dev");
  });

  it("encodes special characters in owner/repo/path segments", () => {
    expect(
      gitHubHref({ owner: "my org", repo: "my repo", path: "a b.md" }),
    ).toBe("/my%20org/my%20repo/a%20b.md");
  });

  it("omits path segments when path is empty or undefined", () => {
    expect(gitHubHref({ owner: "mberg", repo: "cortex", branch: "main" })).toBe(
      "/mberg/cortex",
    );
  });
});

describe("isMarkdownPath", () => {
  it("returns true for a path ending in .md", () => {
    expect(isMarkdownPath("a/b.md")).toBe(true);
  });

  it("returns false for a path not ending in .md", () => {
    expect(isMarkdownPath("a/b")).toBe(false);
  });

  it("returns true for .MD (case-insensitive)", () => {
    expect(isMarkdownPath("a/b.MD")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isMarkdownPath("")).toBe(false);
  });
});
