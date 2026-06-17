import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePublicDoc } from "./public-doc";

vi.mock("./installation-token", () => ({
  getInstallationToken: async () => "ghs_test",
}));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
const env = { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "pk" };

function contentsResponse(markdown: string): Response {
  return new Response(
    JSON.stringify({
      content: Buffer.from(markdown, "utf8").toString("base64"),
      encoding: "base64",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("handlePublicDoc", () => {
  it("404s when public is not true (no existence leak)", async () => {
    global.fetch = vi.fn(async () =>
      contentsResponse("---\npublic: false\n---\nsecret"),
    ) as never;
    const res = await handlePublicDoc(env, {
      owner: "o",
      repo: "r",
      path: "d.md",
    });
    expect(res.status).toBe(404);
  });

  it("404s when the file does not exist", async () => {
    global.fetch = vi.fn(
      async () => new Response("{}", { status: 404 }),
    ) as never;
    const res = await handlePublicDoc(env, {
      owner: "o",
      repo: "r",
      path: "missing.md",
    });
    expect(res.status).toBe(404);
  });

  it("404s when the app is not installed (getInstallationToken throws)", async () => {
    const mod = await import("./installation-token");
    vi.spyOn(mod, "getInstallationToken").mockRejectedValueOnce(
      new Error("App not installed on repo"),
    );
    const res = await handlePublicDoc(env, {
      owner: "o",
      repo: "r",
      path: "d.md",
    });
    expect(res.status).toBe(404);
  });

  it("serves a clean, comment-stripped body when public:true", async () => {
    const md =
      '---\npublic: true\n---\n# Hi {>>note<<}{id="c1" by="x" at="y"} there\n';
    global.fetch = vi.fn(async () => contentsResponse(md)) as never;
    const res = await handlePublicDoc(env, {
      owner: "o",
      repo: "r",
      path: "d.md",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      markdown: string;
      comments: boolean;
      suggestions: boolean;
    };
    expect(body.comments).toBe(false);
    expect(body.markdown).toContain("# Hi  there");
    expect(body.markdown).not.toContain("note");
  });

  it("rejects a path traversal attempt with 400", async () => {
    const res = await handlePublicDoc(env, {
      owner: "o",
      repo: "r",
      path: "../etc/passwd",
    });
    expect(res.status).toBe(400);
  });
});
