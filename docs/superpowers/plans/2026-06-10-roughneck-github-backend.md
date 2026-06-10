# roughneck GitHub-Backed Web Reviewer — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A roughneck web app (in the `recodelabs/roughneck` repo, runs locally or hosted) where you log in with GitHub, pick a repo/branch, browse + edit + comment markdown in the Roughdraft editor, and a commit button writes back to GitHub authored as you — with no backend storage.

**Architecture:** Vendor the MIT Roughdraft frontend (`Lex-Inc/roughdraft` `packages/app`) into `app/`. Add a new `GitHubBackend` implementing Roughdraft's existing `StorageBackend` interface (so the editor/CriticMarkup UI is reused unchanged). The browser talks directly to GitHub's REST API for all reads/writes; the only server-side piece is one stateless token-exchange function (shared logic, two thin adapters: a Vite dev middleware for local, a Cloudflare Pages Function for hosted).

**Tech Stack:** Vite 6, React 19, Tiptap 3, TypeScript, Vitest 4 (jsdom), GitHub REST API, GitHub App OAuth, Cloudflare Pages + Functions (hosting).

**Spec:** `docs/superpowers/specs/2026-06-10-roughneck-github-backend-design.md`
**Upstream source reference (already cloned):** `/tmp/rd-src/packages/app`

---

## File Structure

- `app/` — vendored Roughdraft frontend (Vite project). Most files unchanged.
- `app/src/storage.ts` — **modify**: add `"github"` to `BackendInfo.kind`; add optional `authorLabel?: string`.
- `app/src/github-backend.ts` — **create**: `GitHubBackend implements StorageBackend` + a `listMarkdownPaths()` helper. The core new logic.
- `app/src/github-backend.test.ts` — **create**: unit tests (mocked `fetch`).
- `app/src/github-auth.ts` — **create**: browser auth client (login redirect, token storage in `sessionStorage`, `GET /user`).
- `app/src/detect-backend.ts` — **modify**: return `GitHubBackend` in GitHub mode.
- `app/src/GitHubPicker.tsx` — **create**: minimal repo/branch/file gate view.
- `app/src/PageCard.tsx` — **modify**: pass `backend.info.authorLabel` as comment `authorId`.
- `app/src/App.tsx` — **modify**: gate the `/api/open-requests` SSE on backend kind; render `GitHubPicker` when in GitHub mode with no document path.
- `auth/exchange.ts` — **create**: shared, framework-free `exchangeCodeForToken()`.
- `auth/exchange.test.ts` — **create**: unit tests.
- `app/vite.config.ts` — **modify**: add a dev-only middleware plugin serving `/api/auth/*` locally.
- `functions/api/auth/[[route]].ts` — **create**: Cloudflare Pages Function adapter (hosted).
- `app/.env.example` — **create**: documents `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `VITE_GITHUB_MODE`.

---

## Task 1: Vendor the Roughdraft app and get it building/running standalone

**Goal:** prove the vendored app builds, tests pass, and runs locally with its existing `LocalStorageBackend` — before any GitHub code. This retires the integration risk first.

**Files:**
- Create: `app/**` (copied from `/tmp/rd-src/packages/app`)

- [ ] **Step 1: Copy the app package in**

```bash
cd /Users/claudius/github/roughneck
mkdir -p app
cp -R /tmp/rd-src/packages/app/. app/
rm -rf app/node_modules app/dist
```

- [ ] **Step 2: Detect workspace/monorepo coupling**

```bash
cd /Users/claudius/github/roughneck/app
grep -nE '"workspace:|\.\./\.\.' package.json || echo "no workspace deps in package.json"
grep -rnE "from \"@roughdraft/|from \"\.\./\.\./packages" src | head || echo "no cross-package imports in src"
```
Expected: ideally both report none (the app's `src` is self-contained — `storage.ts`, backends, etc. all live in `app/src`). If a `workspace:*` dep or `packages/server` import appears, STOP and report it (status NEEDS_CONTEXT) — we'd need to vendor or inline that too.

- [ ] **Step 3: Trim the monorepo-only build step**

The upstream `build` script is `tsc -b && vite build && node ../../scripts/copy-app-spec.mjs`. That last script is monorepo-only. Edit `app/package.json` so `scripts.build` is:

```json
"build": "tsc -b && vite build",
```

- [ ] **Step 4: Install and verify the existing test suite passes**

```bash
cd /Users/claudius/github/roughneck/app
npm install
npm test
```
Expected: Vitest runs the existing tests (`detect-backend.test.ts`, `remote-backend.test.ts`, `markdown.test.ts`, etc.) and they PASS. If any fail purely due to the vendoring (missing config), fix the config, not the tests; if a test needs the server package, report it.

- [ ] **Step 5: Verify a production build succeeds**

```bash
npm run build
```
Expected: `tsc -b` and `vite build` both succeed; `app/dist/` is produced. (Do not commit `dist/`.)

- [ ] **Step 6: Add a .gitignore for build artifacts**

Create `app/.gitignore`:
```
node_modules
dist
.env
.env.local
```

- [ ] **Step 7: Commit**

```bash
cd /Users/claudius/github/roughneck
git add app .gitignore 2>/dev/null; git add app
git commit --no-gpg-sign -m "chore: vendor Roughdraft frontend into app/ (builds + tests pass standalone)"
```

---

## Task 2: Extend the backend types for GitHub

**Files:**
- Modify: `app/src/storage.ts`

- [ ] **Step 1: Write a failing type/behavior test**

Create `app/src/github-types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { BackendInfo } from "./storage";

describe("BackendInfo github kind", () => {
  it("accepts kind 'github' and an authorLabel", () => {
    const info: BackendInfo = {
      kind: "github",
      label: "GitHub",
      detail: "owner/repo@main",
      authorLabel: "octocat",
    };
    expect(info.kind).toBe("github");
    expect(info.authorLabel).toBe("octocat");
  });
});
```

- [ ] **Step 2: Run it, expect a TYPE error / fail**

Run: `cd app && npx tsc --noEmit`
Expected: TS error — `"github"` not assignable to `kind`, and `authorLabel` does not exist on `BackendInfo`.

- [ ] **Step 3: Extend `BackendInfo`**

In `app/src/storage.ts`, change the `BackendInfo` interface:
```ts
export interface BackendInfo {
  kind: "local-files" | "local-storage" | "remote" | "github";
  label: string;
  detail: string;
  projectPath?: string;
  sessionId?: string;
  originPath?: string;
  authorLabel?: string;
}
```

- [ ] **Step 4: Verify types pass and the test runs**

Run: `cd app && npx tsc --noEmit && npx vitest run src/github-types.test.ts`
Expected: no TS errors; test PASSES.

- [ ] **Step 5: Commit**

```bash
git add app/src/storage.ts app/src/github-types.test.ts
git commit --no-gpg-sign -m "feat: add 'github' backend kind + authorLabel to BackendInfo"
```

---

## Task 3: The GitHub backend (`github-backend.ts`)

**Files:**
- Create: `app/src/github-backend.ts`, `app/src/github-backend.test.ts`

This mirrors `app/src/api-backend.ts` (read it for the pattern) but talks to GitHub's REST API. Constructor config: `{ token, owner, repo, branch, login }`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/github-backend.test.ts`:
```ts
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
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("?ref=")) {
        return new Response(JSON.stringify({ sha: "server999", content: b64("# Server\n"), encoding: "base64" }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "is at ... but expected ..." }), { status: 409 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(backend().saveMarkdownFile("docs/x.md", "# Mine\n", "abc123"))
      .rejects.toMatchObject({ name: "MarkdownFileConflictError" });
    try {
      await backend().saveMarkdownFile("docs/x.md", "# Mine\n", "abc123");
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
```

- [ ] **Step 2: Run the tests, expect failure (module missing)**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: FAIL — cannot find `./github-backend`.

- [ ] **Step 3: Implement `github-backend.ts`**

Create `app/src/github-backend.ts`:
```ts
import {
  type StorageBackend,
  type BackendInfo,
  type Page,
  type StoredAsset,
  MarkdownFileConflictError,
} from "./storage";

export interface GitHubBackendConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  login: string;
}

const API = "https://api.github.com";

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}
function pageId(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "");
}
function decodeBase64(b64: string): string {
  // GitHub returns base64 that may contain newlines.
  const clean = b64.replace(/\n/g, "");
  if (typeof atob === "function") {
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(clean, "base64").toString("utf8");
}
function encodeBase64(text: string): string {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach((byte) => { bin += String.fromCharCode(byte); });
    return btoa(bin);
  }
  return Buffer.from(text, "utf8").toString("base64");
}

export class GitHubBackend implements StorageBackend {
  info: BackendInfo;
  canManageProjects = false;
  private cfg: GitHubBackendConfig;

  constructor(cfg: GitHubBackendConfig) {
    this.cfg = cfg;
    this.info = {
      kind: "github",
      label: "GitHub",
      detail: `${cfg.owner}/${cfg.repo}@${cfg.branch}`,
      authorLabel: cfg.login,
    };
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: "application/vnd.github+json",
      ...extra,
    };
  }

  private async readFile(relativePath: string): Promise<Page> {
    const { owner, repo, branch } = this.cfg;
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/contents/${relativePath}?ref=${branch}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    const json = (await res.json()) as { sha: string; content: string };
    const content = decodeBase64(json.content);
    return {
      id: pageId(relativePath),
      title: titleFromContent(content, relativePath.split("/").at(-1) || relativePath),
      content,
      version: json.sha,
    };
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    return this.readFile(relativePath);
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page | undefined> {
    const { owner, repo, branch } = this.cfg;
    const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${relativePath}`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: `Update ${relativePath}`,
        content: encodeBase64(content),
        sha: expectedVersion,
        branch,
      }),
    });
    if (res.status === 409 || res.status === 422) {
      // SHA moved — fetch current and surface a conflict the UI understands.
      const current = await this.readFile(relativePath);
      throw new MarkdownFileConflictError(current);
    }
    if (!res.ok) throw new Error(`GitHub save failed (${res.status})`);
    const json = (await res.json()) as { content: { sha: string } };
    return {
      id: pageId(relativePath),
      title: titleFromContent(content, relativePath.split("/").at(-1) || relativePath),
      content,
      version: json.content.sha,
    };
  }

  async listMarkdownPaths(): Promise<string[]> {
    const { owner, repo, branch } = this.cfg;
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GitHub tree failed (${res.status})`);
    const json = (await res.json()) as { tree: Array<{ path: string; type: string }> };
    return json.tree
      .filter((e) => e.type === "blob" && /\.md$/i.test(e.path))
      .map((e) => e.path);
  }

  saveAsset(_file: File): Promise<StoredAsset> {
    return Promise.reject(new Error("Asset upload is not supported yet in GitHub mode"));
  }

  resolveFileUrl(path: string): string | null {
    const { owner, repo, branch } = this.cfg;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }

  async openProject(_path: string): Promise<void> {
    // no-op: repo/branch are fixed at construction
  }
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/github-backend.ts app/src/github-backend.test.ts
git commit --no-gpg-sign -m "feat: GitHubBackend (read/save/list, blob-SHA conflict handling)"
```

---

## Task 4: Shared OAuth token-exchange logic

**Files:**
- Create: `auth/exchange.ts`, `auth/exchange.test.ts`

Framework-free so both the local Vite middleware and the hosted Pages Function reuse it.

- [ ] **Step 1: Write failing tests**

Create `auth/exchange.test.ts`:
```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { exchangeCodeForToken } from "./exchange";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

describe("exchangeCodeForToken", () => {
  it("posts code+credentials to GitHub and returns the access token", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ access_token: "gho_xyz", token_type: "bearer" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await exchangeCodeForToken("the-code", {
      clientId: "cid", clientSecret: "secret",
    });

    expect(token).toBe("gho_xyz");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({ client_id: "cid", client_secret: "secret", code: "the-code" });
  });

  it("rejects a blank code without calling GitHub", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(exchangeCodeForToken("", { clientId: "c", clientSecret: "s" }))
      .rejects.toThrow(/code/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws if GitHub returns an error payload", async () => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: "bad_verification_code" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;
    await expect(exchangeCodeForToken("x", { clientId: "c", clientSecret: "s" }))
      .rejects.toThrow(/bad_verification_code/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd app && npx vitest run ../auth/exchange.test.ts`
(If Vitest's root excludes `../auth`, instead place the test command after Step 4's config note below.)
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `auth/exchange.ts`**

Create `auth/exchange.ts`:
```ts
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/** Exchange an OAuth `code` for a GitHub access token. Framework-free. */
export async function exchangeCodeForToken(
  code: string,
  creds: OAuthCredentials,
): Promise<string> {
  if (!code || !code.trim()) throw new Error("Missing OAuth code");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (json.error) throw new Error(`GitHub OAuth error: ${json.error}`);
  if (!json.access_token) throw new Error("GitHub OAuth: no access_token in response");
  return json.access_token;
}
```

- [ ] **Step 4: Make Vitest see the `auth/` dir**

Edit `app/vite.config.ts` (or `app/vitest.config.ts` if test config is separate) to include the sibling `auth` folder in the test scope. Add to the Vitest config object:
```ts
test: { include: ["src/**/*.test.ts", "../auth/**/*.test.ts"] },
```
(If a separate `vitest.config.ts` exists, add the `test.include` there instead.)

- [ ] **Step 5: Run, expect pass**

Run: `cd app && npx vitest run ../auth/exchange.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add auth/exchange.ts auth/exchange.test.ts app/vite.config.ts
git commit --no-gpg-sign -m "feat: framework-free GitHub OAuth code->token exchange + tests"
```

---

## Task 5: Auth adapters — local Vite middleware + hosted Pages Function

**Files:**
- Modify: `app/vite.config.ts`
- Create: `functions/api/auth/[[route]].ts`, `app/.env.example`

Both adapters serve two routes using the shared `exchangeCodeForToken`:
`GET /api/auth/login` → 302 to GitHub's authorize URL (with `state`);
`GET /api/auth/callback?code=&state=` → exchange, then 302 back to the SPA with the token in the URL fragment (`/#token=...&login=...`) so it never hits server logs as a query.

- [ ] **Step 1: Add `.env.example`**

Create `app/.env.example`:
```
# GitHub App OAuth credentials (the auth function reads these; never commit real values)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
# Turn on GitHub mode in the SPA build/dev
VITE_GITHUB_MODE=1
```

- [ ] **Step 2: Add the dev middleware plugin to `vite.config.ts`**

In `app/vite.config.ts`, add a plugin (alongside `react()`/`tailwindcss()`). It loads env via Vite's `loadEnv` and serves the two routes in dev only:
```ts
import { exchangeCodeForToken } from "../auth/exchange";

function authDevPlugin(env: Record<string, string>) {
  return {
    name: "roughneck-auth-dev",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "", "http://localhost");
        if (url.pathname === "/api/auth/login") {
          const redirectUri = `${url.origin}/api/auth/callback`;
          const authorize = new URL("https://github.com/login/oauth/authorize");
          authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
          authorize.searchParams.set("redirect_uri", redirectUri);
          authorize.searchParams.set("state", url.searchParams.get("state") || "");
          res.statusCode = 302; res.setHeader("Location", authorize.toString()); res.end();
          return;
        }
        if (url.pathname === "/api/auth/callback") {
          try {
            const token = await exchangeCodeForToken(url.searchParams.get("code") || "", {
              clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET,
            });
            res.statusCode = 302;
            res.setHeader("Location", `/#token=${encodeURIComponent(token)}`);
            res.end();
          } catch (e) {
            res.statusCode = 500; res.end(String(e instanceof Error ? e.message : e));
          }
          return;
        }
        next();
      });
    },
  };
}
```
Wire it: in `defineConfig(() => { ... })`, compute `const env = loadEnv(mode, process.cwd(), "");` (add `mode` to the config callback signature and import `loadEnv` from `vite`) and add `authDevPlugin(env)` to `plugins`.

- [ ] **Step 3: Create the hosted Cloudflare Pages Function**

Create `functions/api/auth/[[route]].ts`:
```ts
import { exchangeCodeForToken } from "../../../auth/exchange";

interface Env { GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string; }

export const onRequestGet: (ctx: {
  request: Request; env: Env;
}) => Promise<Response> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/login")) {
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", `${url.origin}/api/auth/callback`);
    authorize.searchParams.set("state", url.searchParams.get("state") || "");
    return Response.redirect(authorize.toString(), 302);
  }
  if (url.pathname.endsWith("/callback")) {
    const token = await exchangeCodeForToken(url.searchParams.get("code") || "", {
      clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET,
    });
    return Response.redirect(`${url.origin}/#token=${encodeURIComponent(token)}`, 302);
  }
  return new Response("Not found", { status: 404 });
};
```

- [ ] **Step 4: Verify type-check passes**

Run: `cd app && npx tsc --noEmit`
Expected: no errors. (The Pages Function uses only Web APIs; if `tsc` in `app/` doesn't include `functions/`, that's fine — it's built by the Pages platform. Confirm `vite.config.ts` still type-checks.)

- [ ] **Step 5: Commit**

```bash
git add app/vite.config.ts app/.env.example functions/api/auth/[[route]].ts
git commit --no-gpg-sign -m "feat: local (vite middleware) + hosted (pages function) auth adapters"
```

---

## Task 6: Browser auth client + GitHub-mode backend selection

**Files:**
- Create: `app/src/github-auth.ts`
- Modify: `app/src/detect-backend.ts`, `app/src/App.tsx`

- [ ] **Step 1: Write failing tests for the auth client**

Create `app/src/github-auth.test.ts`:
```ts
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { captureTokenFromUrl, getStoredToken, clearToken } from "./github-auth";

beforeEach(() => { sessionStorage.clear(); });
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; window.location.hash = ""; });

describe("github-auth token capture", () => {
  it("captures a token from the URL fragment and stores it in sessionStorage", () => {
    window.location.hash = "#token=gho_abc";
    const token = captureTokenFromUrl();
    expect(token).toBe("gho_abc");
    expect(getStoredToken()).toBe("gho_abc");
    expect(window.location.hash).toBe(""); // fragment cleared after capture
  });

  it("returns the stored token when no fragment is present", () => {
    sessionStorage.setItem("roughneck.gh.token", "gho_stored");
    expect(captureTokenFromUrl()).toBe("gho_stored");
  });

  it("clearToken removes it", () => {
    sessionStorage.setItem("roughneck.gh.token", "x");
    clearToken();
    expect(getStoredToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd app && npx vitest run src/github-auth.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `github-auth.ts`**

Create `app/src/github-auth.ts`:
```ts
const TOKEN_KEY = "roughneck.gh.token";

/** Pull a token out of the URL fragment (set by the auth callback), else from storage. */
export function captureTokenFromUrl(): string | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const fromUrl = params.get("token");
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    // Strip the fragment so the token doesn't linger in the address bar.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromUrl;
  }
  return getStoredToken();
}

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Begin the OAuth round-trip. */
export function login(): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem("roughneck.gh.state", state);
  window.location.assign(`/api/auth/login?state=${encodeURIComponent(state)}`);
}

/** Fetch the authenticated user's login for comment attribution. */
export async function fetchLogin(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub /user failed (${res.status})`);
  const json = (await res.json()) as { login: string };
  return json.login;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd app && npx vitest run src/github-auth.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Wire GitHub mode into `detect-backend.ts`**

In `app/src/detect-backend.ts`, add imports and an early branch at the TOP of `detectBackend()` (before the `/api/status` fetch). It reads repo/branch from the URL (`?repo=owner/name&ref=branch`):
```ts
import { GitHubBackend } from "./github-backend";
import { captureTokenFromUrl, fetchLogin } from "./github-auth";

// ...inside detectBackend(), before the VITE_PREVIEW_WEB check is fine, but after it is also OK:
if (import.meta.env.VITE_GITHUB_MODE === "1") {
  const token = captureTokenFromUrl();
  const params = new URLSearchParams(window.location.search);
  const repoParam = params.get("repo") || "";
  const [owner, repo] = repoParam.split("/");
  const branch = params.get("ref") || "main";
  if (token && owner && repo) {
    const login = await fetchLogin(token).catch(() => "user");
    return new GitHubBackend({ token, owner, repo, branch, login });
  }
  // Not enough info yet (no token or repo) — fall through; App renders the GitHubPicker.
}
```
Note: when token/repo are missing, `detectBackend` still returns (eventually) a `LocalStorageBackend`; Task 7 makes `App` render the picker instead of trying to load a doc in this state. To make that decision available, ALSO export a helper:
```ts
export function isGitHubMode(): boolean {
  return import.meta.env.VITE_GITHUB_MODE === "1";
}
export function gitHubSelectionFromUrl(): { token: string | null; repo: string; ref: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    token: captureTokenFromUrl(),
    repo: params.get("repo") || "",
    ref: params.get("ref") || "main",
  };
}
```

- [ ] **Step 6: Gate the server-only SSE in `App.tsx`**

In `app/src/App.tsx`, find the effect that opens `new EventSource("/api/open-requests")` (≈ line 1549). Guard it so it does not run in GitHub mode:
```ts
import { isGitHubMode } from "./detect-backend";
// inside the effect, as the first line:
if (isGitHubMode()) return;
```

- [ ] **Step 7: Verify build + tests**

Run: `cd app && npx tsc --noEmit && npm test`
Expected: type-checks clean; all tests (including new ones) PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/github-auth.ts app/src/github-auth.test.ts app/src/detect-backend.ts app/src/App.tsx
git commit --no-gpg-sign -m "feat: browser auth client + GitHub-mode backend selection; gate SSE"
```

---

## Task 7: Minimal repo / branch / file picker

**Files:**
- Create: `app/src/GitHubPicker.tsx`
- Modify: `app/src/App.tsx`

When in GitHub mode and there is no document to load yet (no token, no `?repo`, or no `?path`), render a small gate instead of the editor. It drives everything through URL params (`?repo=&ref=&path=`), reusing the existing `?path=` load flow — no edits to `DocumentWorkspace`.

- [ ] **Step 1: Implement the picker component**

Create `app/src/GitHubPicker.tsx`:
```tsx
import { useEffect, useState } from "react";
import { login, getStoredToken } from "./github-auth";
import { GitHubBackend } from "./github-backend";

export function GitHubPicker() {
  const params = new URLSearchParams(window.location.search);
  const token = getStoredToken();
  const [repo, setRepo] = useState(params.get("repo") || "");
  const [ref, setRef] = useState(params.get("ref") || "main");
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If we have a token + repo but no file chosen, list the markdown files.
  useEffect(() => {
    const [owner, name] = repo.split("/");
    if (!token || !owner || !name) return;
    const backend = new GitHubBackend({ token, owner, repo: name, branch: ref, login: "" });
    backend.listMarkdownPaths()
      .then(setPaths)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [token, repo, ref]);

  if (!token) {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", fontFamily: "system-ui" }}>
        <h1>roughneck</h1>
        <p>Review a GitHub repo's markdown in your browser.</p>
        <button onClick={login}>Login with GitHub</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "64px auto", fontFamily: "system-ui" }}>
      <h1>Pick a repo</h1>
      <label>owner/repo <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="octocat/hello" /></label>
      <label> branch <input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {(paths || []).map((p) => {
          const href = `/?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(p)}`;
          return <li key={p}><a href={href}>{p}</a></li>;
        })}
      </ul>
      {paths && paths.length === 0 && <p>No markdown files found.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Render the picker from `App.tsx` when appropriate**

In `app/src/App.tsx`, near the top of render (where it currently shows a Homepage when `!requestedPathState.rawPath`), add a GitHub-mode branch. Import:
```ts
import { GitHubPicker } from "./GitHubPicker";
import { isGitHubMode, gitHubSelectionFromUrl } from "./detect-backend";
```
Then, in the render path that decides what to show when there is no active document, add:
```tsx
if (isGitHubMode()) {
  const sel = gitHubSelectionFromUrl();
  const params = new URLSearchParams(window.location.search);
  const hasDoc = !!params.get("path");
  if (!sel.token || !sel.repo || !hasDoc) {
    return <GitHubPicker />;
  }
}
```
Place this guard BEFORE the existing "no document → Homepage" return so GitHub mode takes precedence. (Read the surrounding render to position it; it must short-circuit the normal load when the selection is incomplete.)

- [ ] **Step 3: Manual smoke (dev server) — picker renders and lists files**

```bash
cd app
cp .env.example .env   # fill GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET from the registered GitHub App
npm run dev
```
In the browser at the dev URL: you should see "Login with GitHub" → after login, the repo picker → entering a repo lists its `.md` files → clicking one navigates to `/?repo=...&ref=...&path=...`.
Expected: the editor loads the file (proves Task 6's backend selection + load flow). If login can't complete because the GitHub App isn't registered yet, see Task 9 for registration; verify at least that the unauthenticated picker renders.

- [ ] **Step 4: Commit**

```bash
git add app/src/GitHubPicker.tsx app/src/App.tsx
git commit --no-gpg-sign -m "feat: minimal GitHub repo/branch/file picker gate"
```

---

## Task 8: Attribute CriticMarkup comments to the GitHub user

**Files:**
- Modify: `app/src/PageCard.tsx`

Today new comments default to `authorId: "user"` (in `critic-markup/index.ts`'s `createCommentWithContext`, called via `createCriticComment(undefined, ...)` in `PageCard.tsx`). We pass the GitHub login (already on `backend.info.authorLabel`) as the `partial.authorId`.

- [ ] **Step 1: Read the call sites**

Run: `cd app && grep -n "createCriticComment\|createCriticChange" src/PageCard.tsx`
Expected: several calls, each currently passing `undefined` as the first (`partial`) arg.

- [ ] **Step 2: Derive the author from the backend prop**

In `app/src/PageCard.tsx`, where `backend` is in scope (it's a prop), add near the top of the component body:
```ts
const authorId = backend?.info.authorLabel ?? "user";
```

- [ ] **Step 3: Thread it into each comment/change creation**

For each `createCriticComment(undefined, existing)` call, change the first argument from `undefined` to `{ authorId }`. For each `createCriticChange(kind, undefined, existing)` call, change the `undefined` to `{ authorId }`. (Keep the other args unchanged.) Example:
```ts
// before: createCriticComment(undefined, existingComments)
createCriticComment({ authorId }, existingComments)
// before: createCriticChange(kind, undefined, existingComments)
createCriticChange(kind, { authorId }, existingComments)
```

- [ ] **Step 4: Verify build + existing tests still pass**

Run: `cd app && npx tsc --noEmit && npm test`
Expected: clean; all tests PASS (the critic-markup tests still pass because `authorId` defaulting is unchanged when no partial is given).

- [ ] **Step 5: Commit**

```bash
git add app/src/PageCard.tsx
git commit --no-gpg-sign -m "feat: author CriticMarkup comments as the logged-in GitHub user"
```

---

## Task 9: GitHub App registration, local end-to-end, and docs

**Files:**
- Create: `app/README.md`

- [ ] **Step 1: Register the GitHub App (manual, one-time)**

Document the steps and perform them: create a GitHub App (Settings → Developer settings → GitHub Apps → New). Set:
- Callback URL: `http://localhost:5173/api/auth/callback` (local) — add the production URL later.
- Permissions: Repository → Contents: Read and write. Metadata: Read.
- Note the Client ID; generate a Client secret. Put both in `app/.env`.

- [ ] **Step 2: Full local end-to-end**

```bash
cd app && npm run dev
```
Then in the browser:
1. Login with GitHub → authorize the App on a test repo.
2. Pick the repo + branch → see its `.md` files.
3. Open a file → it renders in the editor.
4. Add a CriticMarkup comment → confirm it shows your GitHub username as author.
5. Edit text, hit save (Cmd/Ctrl+S) → confirm a commit appears on GitHub, authored by you, on the chosen branch.
6. Conflict check: edit the same file directly on GitHub, then save again in the app → confirm the conflict state appears (no silent overwrite).

Record the outcomes. All six must pass.

- [ ] **Step 3: Write `app/README.md`**

Create `app/README.md` documenting: what it is, the GitHub App setup, the `.env` vars, `npm run dev` (local) and the hosted deploy outline (Cloudflare Pages: build command `npm run build`, output `app/dist`, Functions in `functions/`, env vars `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, and `VITE_GITHUB_MODE=1` at build). Keep it concise and accurate to what was built.

- [ ] **Step 4: Commit**

```bash
git add app/README.md
git commit --no-gpg-sign -m "docs: GitHub mode setup + local run + hosting outline"
```

---

## Self-Review

**Spec coverage:**
- Browser-only, GitHub-direct reads/writes → Task 3 (`GitHubBackend`). ✓
- Login with GitHub, GitHub App, tiny stateless token function → Tasks 4–6. ✓
- Token only in browser (`sessionStorage`), identity via `GET /user` → Task 6 (`github-auth.ts`). ✓
- Browse repo (Trees API) + pick repo/branch/file → Task 7. ✓
- Open via Contents API, `version`=blob SHA → Task 3. ✓
- Save = commit via Contents API w/ SHA; 409 → `MarkdownFileConflictError` → Task 3. ✓
- Comments authored as GitHub user → Task 8. ✓
- Runs locally AND hosted (shared exchange, two adapters) → Tasks 4, 5, 9. ✓
- No backend storage → only the stateless exchange function exists. ✓
- Reuse Roughdraft editor via `StorageBackend` → Tasks 1–3. ✓
- Out-of-scope items (asset upload, PR button, polling) → `saveAsset` throws; SSE gated; not implemented. ✓

**Placeholder scan:** none — every code/command step has full content. (Task 7 Step 2 and Task 6 Step 5 instruct positioning within `App.tsx`'s existing render/effect; exact code to insert is given, with grep/line guidance to place it — not a placeholder, but the implementer must read the surrounding function. Flagged honestly as the one spot requiring app-shell reading.)

**Type/name consistency:** `BackendInfo.kind` adds `"github"` (Task 2) and is used by `GitHubBackend.info` (Task 3) and the picker/detect (6,7). `authorLabel` defined in Task 2, set in Task 3, consumed in Task 8. `exchangeCodeForToken(code, {clientId, clientSecret})` defined in Task 4, used identically in both adapters (Task 5). `captureTokenFromUrl`/`getStoredToken`/`clearToken`/`login`/`fetchLogin` defined in Task 6 and used by detect-backend + picker. `listMarkdownPaths()` defined in Task 3, used in Task 7. Consistent.

**Known integration risk (carried from spec):** Task 7 Step 2 assumes Roughdraft's `App.tsx` render has a clean "no document yet" branch to intercept. If it resists, the fallback is to intercept earlier (render `GitHubPicker` immediately when `isGitHubMode() && !path`), which needs no `DocumentWorkspace` changes. Retire this in Task 7.
