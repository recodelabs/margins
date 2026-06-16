import { afterEach, describe, expect, it, vi } from "vitest";
import { listAccessibleRepos, listBranches } from "./github-repos";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

/** Build a JSON `Response`, optionally with a GitHub-style `Link` header. */
function jsonRes(
  body: unknown,
  opts: { link?: string; status?: number } = {},
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.link) headers.Link = opts.link;
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers,
  });
}

/** Route fetches by URL; each route may be a single Response or a queue. */
function routeFetch(routes: Record<string, Response | Response[]>) {
  const seen: Record<string, number> = {};
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (Array.isArray(route)) {
      const i = seen[url] ?? 0;
      seen[url] = i + 1;
      return route[Math.min(i, route.length - 1)];
    }
    return route;
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe("listAccessibleRepos", () => {
  it("lists repos across all installations, de-duped and newest-pushed first", async () => {
    routeFetch({
      "https://api.github.com/user/installations?per_page=100": jsonRes({
        installations: [{ id: 11 }, { id: 22 }],
      }),
      "https://api.github.com/user/installations/11/repositories?per_page=100":
        jsonRes({
          repositories: [
            {
              full_name: "me/old",
              default_branch: "main",
              pushed_at: "2026-01-01T00:00:00Z",
            },
            {
              full_name: "me/new",
              default_branch: "dev",
              pushed_at: "2026-06-01T00:00:00Z",
            },
          ],
        }),
      "https://api.github.com/user/installations/22/repositories?per_page=100":
        jsonRes({
          repositories: [
            // duplicate of me/new (shared across installs) — must not appear twice
            {
              full_name: "me/new",
              default_branch: "dev",
              pushed_at: "2026-06-01T00:00:00Z",
            },
            {
              full_name: "org/mid",
              default_branch: "trunk",
              pushed_at: "2026-03-01T00:00:00Z",
            },
          ],
        }),
    });

    const repos = await listAccessibleRepos("tok");

    expect(repos).toEqual([
      { fullName: "me/new", defaultBranch: "dev" },
      { fullName: "org/mid", defaultBranch: "trunk" },
      { fullName: "me/old", defaultBranch: "main" },
    ]);
  });

  it("follows Link-header pagination for an installation's repositories", async () => {
    routeFetch({
      "https://api.github.com/user/installations?per_page=100": jsonRes({
        installations: [{ id: 7 }],
      }),
      "https://api.github.com/user/installations/7/repositories?per_page=100":
        jsonRes(
          {
            repositories: [
              {
                full_name: "a/one",
                default_branch: "main",
                pushed_at: "2026-02-02T00:00:00Z",
              },
            ],
          },
          {
            link: '<https://api.github.com/user/installations/7/repositories?per_page=100&page=2>; rel="next"',
          },
        ),
      "https://api.github.com/user/installations/7/repositories?per_page=100&page=2":
        jsonRes({
          repositories: [
            {
              full_name: "a/two",
              default_branch: "main",
              pushed_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
    });

    const repos = await listAccessibleRepos("tok");

    expect(repos.map((r) => r.fullName)).toEqual(["a/one", "a/two"]);
  });

  it("returns an empty list when the app has no installations", async () => {
    routeFetch({
      "https://api.github.com/user/installations?per_page=100": jsonRes({
        installations: [],
      }),
    });

    expect(await listAccessibleRepos("tok")).toEqual([]);
  });

  it("throws on a non-OK response so the caller can fall back", async () => {
    routeFetch({
      "https://api.github.com/user/installations?per_page=100": jsonRes(
        "boom",
        { status: 500 },
      ),
    });

    await expect(listAccessibleRepos("tok")).rejects.toThrow();
  });
});

describe("listBranches", () => {
  it("returns branch names, following pagination", async () => {
    routeFetch({
      "https://api.github.com/repos/me/proj/branches?per_page=100": jsonRes(
        [{ name: "main" }, { name: "dev" }],
        {
          link: '<https://api.github.com/repos/me/proj/branches?per_page=100&page=2>; rel="next"',
        },
      ),
      "https://api.github.com/repos/me/proj/branches?per_page=100&page=2":
        jsonRes([{ name: "feature/x" }]),
    });

    expect(await listBranches("tok", "me", "proj")).toEqual([
      "main",
      "dev",
      "feature/x",
    ]);
  });

  it("URL-encodes owner and repo", async () => {
    const mock = routeFetch({
      "https://api.github.com/repos/my%20org/my%20repo/branches?per_page=100":
        jsonRes([{ name: "main" }]),
    });

    await listBranches("tok", "my org", "my repo");

    expect(mock).toHaveBeenCalledWith(
      "https://api.github.com/repos/my%20org/my%20repo/branches?per_page=100",
      expect.anything(),
    );
  });

  it("throws on a non-OK response", async () => {
    routeFetch({
      "https://api.github.com/repos/me/proj/branches?per_page=100": jsonRes(
        "nope",
        { status: 404 },
      ),
    });

    await expect(listBranches("tok", "me", "proj")).rejects.toThrow();
  });
});
