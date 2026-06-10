import { describe, it, expect, afterEach, vi } from "vitest";
import { GitHubBackend } from "./github-backend";
import { MarkdownFileConflictError } from "./storage";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function backend() {
  return new GitHubBackend({
    token: "tok", owner: "o", repo: "r", branch: "main", login: "octocat",
  });
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("GitHubBackend", () => {
  it("info reflects repo and login", () => {
    const info = backend().info;
    expect(info.kind).toBe("github");
    expect(info.detail).toBe("o/r@main");
    expect(info.authorLabel).toBe("octocat");
  });

  it("getMarkdownFile decodes content, sets version=sha and a title", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sha: "abc123", content: b64("# Hello\n\nbody"), encoding: "base64",
    }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const page = await backend().getMarkdownFile("docs/x.md");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/docs/x.md?ref=main",
      { headers: { Authorization: "Bearer tok", Accept: "application/vnd.github+json" } },
    );
    expect(page.content).toBe("# Hello\n\nbody");
    expect(page.version).toBe("abc123");
    expect(page.id).toBe("docs/x");
    expect(page.title).toBe("Hello");
  });

  it("saveMarkdownFile PUTs base64 content with the prior sha and returns the new version", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: { sha: "def456" },
    }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const page = await backend().saveMarkdownFile("docs/x.md", "# New\n", "abc123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/docs/x.md",
      {
        method: "PUT",
        headers: { Authorization: "Bearer tok", Accept: "application/vnd.github+json",
          "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Update docs/x.md",
          content: b64("# New\n"),
          sha: "abc123",
          branch: "main",
        }),
      },
    );
    expect(page?.version).toBe("def456");
    expect(page?.content).toBe("# New\n");
  });

  it("saveMarkdownFile throws MarkdownFileConflictError on 409, carrying current content", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("?ref=")) {
        return new Response(JSON.stringify({ sha: "server999", content: b64("# Server\n"), encoding: "base64" }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "is at ... but expected ..." }), { status: 409 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      await backend().saveMarkdownFile("docs/x.md", "# Mine\n", "abc123");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MarkdownFileConflictError);
      expect((e as MarkdownFileConflictError).current.content).toBe("# Server\n");
      expect((e as MarkdownFileConflictError).current.version).toBe("server999");
    }
  });

  it("listMarkdownPaths returns only .md blob paths from the tree", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      tree: [
        { path: "a.md", type: "blob" },
        { path: "docs", type: "tree" },
        { path: "docs/b.md", type: "blob" },
        { path: "img.png", type: "blob" },
      ],
    }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const paths = await backend().listMarkdownPaths();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/git/trees/main?recursive=1",
      { headers: { Authorization: "Bearer tok", Accept: "application/vnd.github+json" } },
    );
    expect(paths).toEqual(["a.md", "docs/b.md"]);
  });

  it("resolveFileUrl returns a raw URL; saveAsset throws not-supported; openProject is a no-op", async () => {
    const bk = backend();
    expect(bk.resolveFileUrl("img/x.png"))
      .toBe("https://raw.githubusercontent.com/o/r/main/img/x.png");
    await expect(bk.saveAsset(new File(["x"], "x.png"))).rejects.toThrow(/not supported/i);
    await expect(bk.openProject("anything")).resolves.toBeUndefined();
  });
});
