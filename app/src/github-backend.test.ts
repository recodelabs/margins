import { describe, it, expect, afterEach, vi } from "vitest";
import { GitHubBackend } from "./github-backend";
import { FileTooLargeError, MarkdownFileConflictError } from "./storage";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function backend() {
  return new GitHubBackend({
    token: "tok", owner: "o", repo: "r", branch: "main", login: "octocat",
  });
}
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((byte) => { bin += String.fromCharCode(byte); });
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

  it("round-trips multibyte UTF-8 content (accents, CJK, emoji)", async () => {
    const text = "# Héllo\n\n日本語 🎉\n";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sha: "m1", content: b64(text), encoding: "base64",
    }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const page = await backend().getMarkdownFile("u.md");
    expect(page.content).toBe(text);
    expect(page.title).toBe("Héllo");
  });

  it("resolveFileUrl returns a raw URL; saveAsset throws not-supported; openProject is a no-op", async () => {
    const bk = backend();
    expect(bk.resolveFileUrl("img/x.png"))
      .toBe("https://raw.githubusercontent.com/o/r/main/img/x.png");
    await expect(bk.saveAsset(new File(["x"], "x.png"))).rejects.toThrow(/not supported/i);
    await expect(bk.openProject("anything")).resolves.toBeUndefined();
  });

  describe("large-file guard", () => {
    it("throws FileTooLargeError when the API returns encoding:none (file over 1 MB)", async () => {
      // GitHub's Contents API omits inline content for files >1 MB, responding
      // with an empty `content` and `encoding: "none"`.
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        sha: "big1", content: "", encoding: "none", size: 2_000_000,
      }), { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(backend().getMarkdownFile("docs/huge.md")).rejects.toBeInstanceOf(
        FileTooLargeError,
      );
      await expect(backend().getMarkdownFile("docs/huge.md")).rejects.toThrow(
        /too large/i,
      );
    });

    it("throws FileTooLargeError when content is empty but the file size is non-zero", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        sha: "big2", content: "", encoding: "base64", size: 1_500_000,
      }), { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const error = await backend()
        .getMarkdownFile("docs/huge.md")
        .catch((e) => e);
      expect(error).toBeInstanceOf(FileTooLargeError);
      expect((error as FileTooLargeError).path).toBe("docs/huge.md");
      expect((error as FileTooLargeError).size).toBe(1_500_000);
    });

    it("still opens a genuinely empty (0-byte) markdown file", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        sha: "empty1", content: "", encoding: "base64", size: 0,
      }), { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const page = await backend().getMarkdownFile("docs/empty.md");
      expect(page.content).toBe("");
      expect(page.version).toBe("empty1");
    });
  });

  describe("markdown-only guard", () => {
    it("getMarkdownFile rejects a non-.md path without calling fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(backend().getMarkdownFile("data.csv")).rejects.toThrow(
        "Only markdown (.md) files can be opened in roughneck",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("saveMarkdownFile rejects a non-.md path without calling fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(backend().saveMarkdownFile("config.json", "{}")).rejects.toThrow(
        "Only markdown (.md) files can be opened in roughneck",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("getMarkdownFile accepts a .MD (uppercase) path", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        sha: "x1", content: b64("# Upper\n"), encoding: "base64",
      }), { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;
      const page = await backend().getMarkdownFile("NOTE.MD");
      expect(page.content).toBe("# Upper\n");
    });
  });
});
