import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicBackend, PublicDocNotFoundError } from "./public-backend";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("PublicBackend", () => {
  it("fetches the public endpoint and returns a Page", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            markdown: "# Hello\n",
            comments: false,
            suggestions: false,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = new PublicBackend({
      owner: "o",
      repo: "r",
      path: "doc.md",
    });
    const page = await backend.getMarkdownFile("doc.md");

    expect(page.content).toBe("# Hello\n");
    expect(page.version).toBeUndefined();
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/api/public/doc?");
    expect(calledUrl).toContain("owner=o");
    expect(calledUrl).toContain("repo=r");
    expect(calledUrl).toContain("path=doc.md");
  });

  it("throws PublicDocNotFoundError on 404", async () => {
    global.fetch = vi.fn(
      async () => new Response("Not found", { status: 404 }),
    ) as never;
    const backend = new PublicBackend({
      owner: "o",
      repo: "r",
      path: "doc.md",
    });
    await expect(backend.getMarkdownFile("doc.md")).rejects.toBeInstanceOf(
      PublicDocNotFoundError,
    );
  });

  it("is read-only: saving rejects", async () => {
    const backend = new PublicBackend({
      owner: "o",
      repo: "r",
      path: "doc.md",
    });
    await expect(backend.saveMarkdownFile("doc.md", "x")).rejects.toThrow(
      /read-only/i,
    );
  });

  it("reports a public, no-write capability set", () => {
    const backend = new PublicBackend({
      owner: "o",
      repo: "r",
      path: "doc.md",
    });
    expect(backend.info.kind).toBe("public");
    expect(backend.capabilities.manualCommit).toBe(false);
    expect(backend.capabilities.createFile).toBe(false);
    expect(backend.capabilities.activityLog).toBe(false);
  });
});
