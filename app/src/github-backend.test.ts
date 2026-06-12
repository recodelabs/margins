import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubBackend } from "./github-backend";
import { clearGitHubCache } from "./github-cache";
import {
  FileTooLargeError,
  GitHubRateLimitError,
  MarkdownFileConflictError,
} from "./storage";

const originalFetch = global.fetch;
// Reset the shared ETag cache between cases so a cached entry from one test
// can't add an `If-None-Match` header to another's fetch assertions.
beforeEach(() => {
  clearGitHubCache();
});
afterEach(() => {
  global.fetch = originalFetch;
});

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

function backend() {
  return new GitHubBackend({
    token: "tok",
    owner: "o",
    repo: "r",
    branch: "main",
    login: "octocat",
  });
}
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((byte) => {
    bin += String.fromCharCode(byte);
  });
  return btoa(bin);
};

describe("GitHubBackend", () => {
  it("info reflects repo and login", () => {
    const info = backend().info;
    expect(info.kind).toBe("github");
    expect(info.detail).toBe("o/r@main");
    expect(info.authorLabel).toBe("octocat");
  });

  it("getMarkdownFile decodes content, sets version=sha and a title", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sha: "abc123",
            content: b64("# Hello\n\nbody"),
            encoding: "base64",
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const page = await backend().getMarkdownFile("docs/x.md");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/docs/x.md?ref=main",
      {
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/vnd.github+json",
        },
      },
    );
    expect(page.content).toBe("# Hello\n\nbody");
    expect(page.version).toBe("abc123");
    expect(page.id).toBe("docs/x");
    expect(page.title).toBe("Hello");
  });

  it("saveMarkdownFile PUTs base64 content with the prior sha and returns the new version", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: { sha: "def456" },
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const page = await backend().saveMarkdownFile(
      "docs/x.md",
      "# New\n",
      "abc123",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/docs/x.md",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
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
        return new Response(
          JSON.stringify({
            sha: "server999",
            content: b64("# Server\n"),
            encoding: "base64",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ message: "is at ... but expected ..." }),
        { status: 409 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      await backend().saveMarkdownFile("docs/x.md", "# Mine\n", "abc123");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MarkdownFileConflictError);
      expect((e as MarkdownFileConflictError).current.content).toBe(
        "# Server\n",
      );
      expect((e as MarkdownFileConflictError).current.version).toBe(
        "server999",
      );
    }
  });

  it("listMarkdownPaths returns only .md blob paths from the tree", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tree: [
              { path: "a.md", type: "blob" },
              { path: "docs", type: "tree" },
              { path: "docs/b.md", type: "blob" },
              { path: "img.png", type: "blob" },
            ],
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const paths = await backend().listMarkdownPaths();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/git/trees/main?recursive=1",
      {
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/vnd.github+json",
        },
      },
    );
    expect(paths).toEqual(["a.md", "docs/b.md"]);
  });

  it("round-trips multibyte UTF-8 content (accents, CJK, emoji)", async () => {
    const text = "# Héllo\n\n日本語 🎉\n";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sha: "m1",
            content: b64(text),
            encoding: "base64",
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const page = await backend().getMarkdownFile("u.md");
    expect(page.content).toBe(text);
    expect(page.title).toBe("Héllo");
  });

  it("resolveFileUrl returns a raw URL; saveAsset throws not-supported; openProject is a no-op", async () => {
    const bk = backend();
    expect(bk.resolveFileUrl("img/x.png")).toBe(
      "https://raw.githubusercontent.com/o/r/main/img/x.png",
    );
    await expect(bk.saveAsset(new File(["x"], "x.png"))).rejects.toThrow(
      /not supported/i,
    );
    await expect(bk.openProject("anything")).resolves.toBeUndefined();
  });

  describe("large-file guard", () => {
    it("throws FileTooLargeError when the API returns encoding:none (file over 1 MB)", async () => {
      // GitHub's Contents API omits inline content for files >1 MB, responding
      // with an empty `content` and `encoding: "none"`.
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sha: "big1",
              content: "",
              encoding: "none",
              size: 2_000_000,
            }),
            { status: 200 },
          ),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        backend().getMarkdownFile("docs/huge.md"),
      ).rejects.toBeInstanceOf(FileTooLargeError);
      await expect(backend().getMarkdownFile("docs/huge.md")).rejects.toThrow(
        /too large/i,
      );
    });

    it("throws FileTooLargeError when content is empty but the file size is non-zero", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sha: "big2",
              content: "",
              encoding: "base64",
              size: 1_500_000,
            }),
            { status: 200 },
          ),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const error = await backend()
        .getMarkdownFile("docs/huge.md")
        .catch((e) => e);
      expect(error).toBeInstanceOf(FileTooLargeError);
      expect((error as FileTooLargeError).path).toBe("docs/huge.md");
      expect((error as FileTooLargeError).size).toBe(1_500_000);
    });

    it("still opens a genuinely empty (0-byte) markdown file", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sha: "empty1",
              content: "",
              encoding: "base64",
              size: 0,
            }),
            { status: 200 },
          ),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const page = await backend().getMarkdownFile("docs/empty.md");
      expect(page.content).toBe("");
      expect(page.version).toBe("empty1");
    });
  });

  describe("ETag / conditional-request caching", () => {
    it("first read sends no If-None-Match; a later 304 returns cached content without re-parsing", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sha: "v1",
              content: b64("# A\n"),
              encoding: "base64",
            }),
            { status: 200, headers: { ETag: '"etag-1"' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 304, headers: { ETag: '"etag-1"' } }),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const bk = backend();
      const first = await bk.getMarkdownFile("docs/x.md");
      const second = await bk.getMarkdownFile("docs/x.md");

      expect(
        headersOf(fetchMock.mock.calls[0][1])["If-None-Match"],
      ).toBeUndefined();
      expect(headersOf(fetchMock.mock.calls[1][1])["If-None-Match"]).toBe(
        '"etag-1"',
      );
      // The 304 body is empty — proof we served the cached parse, not res.json().
      expect(second).toEqual(first);
      expect(second.content).toBe("# A\n");
    });

    it("caches the tree listing and serves a 304 from cache", async () => {
      const tree = JSON.stringify({
        tree: [{ path: "a.md", type: "blob" }],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(tree, { status: 200, headers: { ETag: '"tree-1"' } }),
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 304, headers: { ETag: '"tree-1"' } }),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const bk = backend();
      expect(await bk.listMarkdownPaths()).toEqual(["a.md"]);
      expect(await bk.listMarkdownPaths()).toEqual(["a.md"]);
      expect(headersOf(fetchMock.mock.calls[1][1])["If-None-Match"]).toBe(
        '"tree-1"',
      );
    });

    it("invalidates the cached read after a successful save", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sha: "v1",
              content: b64("# A\n"),
              encoding: "base64",
            }),
            { status: 200, headers: { ETag: '"e1"' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: { sha: "v2" } }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sha: "v2",
              content: b64("# B\n"),
              encoding: "base64",
            }),
            { status: 200, headers: { ETag: '"e2"' } },
          ),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const bk = backend();
      await bk.getMarkdownFile("docs/x.md");
      await bk.saveMarkdownFile("docs/x.md", "# B\n", "v1");
      const reread = await bk.getMarkdownFile("docs/x.md");

      // The post-save read must NOT carry the stale ETag.
      expect(
        headersOf(fetchMock.mock.calls[2][1])["If-None-Match"],
      ).toBeUndefined();
      expect(reread.content).toBe("# B\n");
    });
  });

  describe("rate-limit handling", () => {
    it("throws GitHubRateLimitError with a clear message on a 403 with remaining=0 (not the bare tree error)", async () => {
      const reset = Math.floor(Date.now() / 1000) + 600;
      const fetchMock = vi.fn(
        async () =>
          new Response("rate limited", {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(reset),
            },
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const error = await backend()
        .listMarkdownPaths()
        .catch((e) => e);
      expect(error).toBeInstanceOf(GitHubRateLimitError);
      expect(error.message).toMatch(/rate limit/i);
      expect(error.message).not.toMatch(/tree failed/i);
      expect((error as GitHubRateLimitError).resetAt).toBeInstanceOf(Date);
    });

    it("treats a 429 with Retry-After as a rate limit on reads", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response("", { status: 429, headers: { "retry-after": "30" } }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const error = await backend()
        .getMarkdownFile("a.md")
        .catch((e) => e);
      expect(error).toBeInstanceOf(GitHubRateLimitError);
      expect((error as GitHubRateLimitError).retryAfterSeconds).toBe(30);
    });

    it("leaves a plain 403 (no rate-limit headers) as the normal labeled error", async () => {
      const fetchMock = vi.fn(
        async () => new Response("forbidden", { status: 403 }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(backend().listMarkdownPaths()).rejects.toThrow(
        /tree failed \(403\)/i,
      );
    });

    it("backs off once on a short Retry-After and then succeeds", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("", { status: 429, headers: { "retry-after": "0" } }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ tree: [{ path: "a.md", type: "blob" }] }),
            { status: 200 },
          ),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const paths = await backend().listMarkdownPaths();
      expect(paths).toEqual(["a.md"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rate-limits saves too (no silent 403 swallow)", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response("", {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(
        backend().saveMarkdownFile("a.md", "# x\n"),
      ).rejects.toBeInstanceOf(GitHubRateLimitError);
    });
  });

  it("createMarkdownFile PUTs base64 content with NO sha and a Create message", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: { sha: "new1" } }), {
          status: 201,
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const page = await backend().createMarkdownFile(
      "docs/new.md",
      "# Untitled\n",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/o/r/contents/docs/new.md",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer tok",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Create docs/new.md",
          content: b64("# Untitled\n"),
          branch: "main",
        }),
      },
    );
    expect(page?.version).toBe("new1");
    expect(page?.content).toBe("# Untitled\n");
  });

  it("createMarkdownFile maps 422 to an already-exists error", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Invalid request" }), {
          status: 422,
        }),
    ) as unknown as typeof fetch;

    await expect(
      backend().createMarkdownFile("docs/dup.md", "# x\n"),
    ).rejects.toThrow(/already exists/);
  });

  it("createMarkdownFile rejects a non-.md path without calling fetch", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      backend().createMarkdownFile("notes.txt", "x"),
    ).rejects.toThrow(/markdown/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("markdown-only guard", () => {
    it("getMarkdownFile rejects a non-.md path without calling fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(backend().getMarkdownFile("data.csv")).rejects.toThrow(
        "Only markdown (.md) files can be opened in margins",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("saveMarkdownFile rejects a non-.md path without calling fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(
        backend().saveMarkdownFile("config.json", "{}"),
      ).rejects.toThrow("Only markdown (.md) files can be opened in margins");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("getMarkdownFile accepts a .MD (uppercase) path", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sha: "x1",
              content: b64("# Upper\n"),
              encoding: "base64",
            }),
            { status: 200 },
          ),
      );
      global.fetch = fetchMock as unknown as typeof fetch;
      const page = await backend().getMarkdownFile("NOTE.MD");
      expect(page.content).toBe("# Upper\n");
    });
  });
});
