# Public Sharing — Phase 1A: Server public-read API (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a gated server endpoint `GET /api/public/doc` that serves a single markdown file from a private repo to a logged-out visitor **only** when the file's own frontmatter says `public: true`, returning a clean (comment-stripped) body.

**Architecture:** A Cloudflare Pages Function (`functions/api/public/doc.ts`) delegates to framework-free, unit-tested modules under a new top-level `lib/` dir: a GitHub-App **installation-token** minter (Web Crypto RS256 JWT → installation token, in-memory cached), a **sharing-flags** frontmatter parser, and a **CriticMarkup stripper**. Gating is fail-closed: anything not explicitly `public: true` on the default branch returns `404`.

**Tech Stack:** TypeScript, Cloudflare Pages Functions (Workers runtime), Web Crypto (`crypto.subtle`, RSASSA-PKCS1-v1_5 / SHA-256), vitest (run from `app/`), GitHub REST API.

**Conventions grounded in the repo:**
- Functions handler shape: `export const onRequestGet: (ctx: { request: Request; env: Env }) => Promise<Response>` (see `functions/api/auth/[[route]].ts`).
- Shared, framework-free logic lives in a top-level dir tested via `app/vitest.config.ts` (which already includes `../auth/**/*.test.ts`); we add `lib/` the same way. Functions import it by relative path (e.g. `../../../lib/...`), exactly as `[[route]].ts` imports `../../../auth/exchange`.
- `yaml` and `app/src/*` are **NOT** importable from Functions — everything here is dependency-free TS.
- Tests run with: `cd app && npm run test` (vitest). Mock `fetch` via `global.fetch = vi.fn(...)` with `afterEach` restore (see `auth/exchange.test.ts`).

---

### Task 1: Let vitest discover `lib/` tests

**Files:**
- Modify: `app/vitest.config.ts` (the `test.include` array — add a `lib` glob next to the existing `../auth/**/*.test.ts`)

- [ ] **Step 1: Read the current include array**

Run: `sed -n '1,60p' app/vitest.config.ts`
Expected: an `include: [ ... ]` array containing a line like `"../auth/**/*.test.ts"`.

- [ ] **Step 2: Add the `lib` glob**

Add `"../lib/**/*.test.ts"` immediately after the existing `"../auth/**/*.test.ts"` entry, matching its indentation/quote style. Do not change anything else.

- [ ] **Step 3: Create a placeholder test to prove discovery**

Create `lib/_discovery.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

describe("lib test discovery", () => {
  it("runs lib/*.test.ts under app vitest", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 4: Run it**

Run: `cd app && npx vitest run ../lib/_discovery.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Delete the placeholder and commit the config**

```bash
rm lib/_discovery.test.ts
git add app/vitest.config.ts
git commit -m "test: include lib/ in vitest discovery for public-sharing server modules"
```

---

### Task 2: Sharing-flags frontmatter parser

Reads the three boolean flags from a markdown doc's YAML frontmatter without a YAML dependency (Functions can't use `yaml`). Absent/unparseable ⇒ `false` (fail closed). Only recognizes flags inside the leading `---`…`---` block.

**Files:**
- Create: `lib/sharing-flags.ts`
- Test: `lib/sharing-flags.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { readSharingFlags } from "./sharing-flags";

describe("readSharingFlags", () => {
  it("defaults every flag to false when there is no frontmatter", () => {
    expect(readSharingFlags("# Just a body\n")).toEqual({
      public: false,
      comments: false,
      suggestions: false,
    });
  });

  it("reads true flags from the leading frontmatter block", () => {
    const md = "---\npublic: true\ncomments: true\n---\n\n# Body\n";
    expect(readSharingFlags(md)).toEqual({
      public: true,
      comments: true,
      suggestions: false,
    });
  });

  it("treats any non-true value as false", () => {
    const md = "---\npublic: false\ncomments: yes\nsuggestions:\n---\n";
    expect(readSharingFlags(md)).toEqual({
      public: false,
      comments: false,
      suggestions: false,
    });
  });

  it("ignores a 'public: true' that appears only in the body, not frontmatter", () => {
    const md = "# Heading\n\npublic: true\n";
    expect(readSharingFlags(md).public).toBe(false);
  });

  it("is case-insensitive on the value and tolerates trailing spaces/comments", () => {
    const md = "---\npublic:   TRUE  # opt in\n---\n";
    expect(readSharingFlags(md).public).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run ../lib/sharing-flags.test.ts`
Expected: FAIL — cannot find module `./sharing-flags`.

- [ ] **Step 3: Implement**

```typescript
export interface SharingFlags {
  public: boolean;
  comments: boolean;
  suggestions: boolean;
}

const FLAG_KEYS = ["public", "comments", "suggestions"] as const;

/** Extract the raw text inside the leading `---`…`---` frontmatter block, or null. */
function frontmatterBlock(markdown: string): string | null {
  const match = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? match[1] : null;
}

/**
 * Read the public/comments/suggestions booleans from a doc's frontmatter.
 * Absent, non-`true`, or unparseable ⇒ false (fail closed). A `key: true` that
 * only appears in the body (not the frontmatter block) is ignored.
 */
export function readSharingFlags(markdown: string): SharingFlags {
  const block = frontmatterBlock(markdown);
  const flags: SharingFlags = {
    public: false,
    comments: false,
    suggestions: false,
  };
  if (!block) return flags;
  for (const key of FLAG_KEYS) {
    // `key:` then a value; capture the first token before any `#` comment.
    const re = new RegExp(`^${key}:[ \\t]*([^\\r\\n#]*)`, "im");
    const m = block.match(re);
    if (m && m[1].trim().toLowerCase() === "true") flags[key] = true;
  }
  return flags;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run ../lib/sharing-flags.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/sharing-flags.ts lib/sharing-flags.test.ts
git commit -m "feat(lib): framework-free sharing-flags frontmatter parser (fail closed)"
```

---

### Task 3: CriticMarkup stripper (clean public body)

Produces the clean "current" text for a public read: removes comment markup entirely, unwraps highlights, and rejects suggestions (so internal review data never reaches the public payload). Framework-free — the editor's `critic-markup/index.ts` is coupled to TipTap/marked and is not reusable server-side.

**Files:**
- Create: `lib/strip-critic-markup.ts`
- Test: `lib/strip-critic-markup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { stripCriticMarkup } from "./strip-critic-markup";

describe("stripCriticMarkup", () => {
  it("removes standalone comments and their id metadata block", () => {
    const md = 'Hello {>>internal note<<}{id="c1" by="mberg" at="x"} world';
    expect(stripCriticMarkup(md)).toBe("Hello  world");
  });

  it("unwraps a highlighted anchor and drops its attached comment", () => {
    const md = '{==target phrase==}{>>why?<<}{id="c2" by="mberg" at="x"} stays';
    expect(stripCriticMarkup(md)).toBe("target phrase stays");
  });

  it("rejects suggestions: additions removed, deletions removed, substitutions keep the original", () => {
    expect(stripCriticMarkup("a{++ added++}b")).toBe("ab");
    expect(stripCriticMarkup("a{-- removed--}b")).toBe("ab");
    expect(stripCriticMarkup("say {~~hi~>hello~~} there")).toBe("say hi there");
  });

  it("leaves plain markdown untouched", () => {
    const md = "# Title\n\nA normal paragraph with no markup.\n";
    expect(stripCriticMarkup(md)).toBe(md);
  });

  it("removes a comment id block only when it immediately follows a comment", () => {
    // A standalone `{id=...}`-shaped block in prose must NOT be eaten.
    expect(stripCriticMarkup("plain {id=\"x\"} text")).toBe('plain {id="x"} text');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run ../lib/strip-critic-markup.test.ts`
Expected: FAIL — cannot find module `./strip-critic-markup`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Return the clean "current" text of a CriticMarkup document for a public read:
 *  - comments `{>>…<<}` are removed, along with an id/metadata block `{…}` that
 *    immediately follows them;
 *  - highlights `{==text==}` are unwrapped to `text` (and a trailing comment removed);
 *  - suggestions are rejected: additions `{++…++}` and deletions `{--…--}` removed,
 *    substitutions `{~~old~>new~~}` collapse to `old`.
 * Order matters: resolve comment+metadata first, then highlights, then suggestions.
 */
export function stripCriticMarkup(markdown: string): string {
  let out = markdown;
  // Comment followed by an optional metadata block: `{>>…<<}` then optional `{…}`.
  out = out.replace(/\{>>[\s\S]*?<<\}(\{[^{}]*\})?/g, "");
  // Highlight: `{==text==}` -> `text` (any trailing comment was already removed above).
  out = out.replace(/\{==([\s\S]*?)==\}/g, "$1");
  // Substitution: `{~~old~>new~~}` -> `old`.
  out = out.replace(/\{~~([\s\S]*?)~>[\s\S]*?~~\}/g, "$1");
  // Addition / deletion: drop the marked span entirely.
  out = out.replace(/\{\+\+[\s\S]*?\+\+\}/g, "");
  out = out.replace(/\{--[\s\S]*?--\}/g, "");
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run ../lib/strip-critic-markup.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/strip-critic-markup.ts lib/strip-critic-markup.test.ts
git commit -m "feat(lib): framework-free CriticMarkup stripper for clean public reads"
```

---

### Task 4: GitHub App JWT signer (Web Crypto RS256)

Mints the short-lived app JWT used to call the GitHub App endpoints. Uses `crypto.subtle` (available in both the Workers runtime and Node 20 under vitest). **The private key must be PKCS#8** (`-----BEGIN PRIVATE KEY-----`); GitHub issues PKCS#1 (`BEGIN RSA PRIVATE KEY`), so the deploy secret must be converted once (documented in Task 7).

**Files:**
- Create: `lib/app-jwt.ts`
- Test: `lib/app-jwt.test.ts`

- [ ] **Step 1: Write the failing test**

The test generates a real RSA keypair, exports the private key as PKCS#8 PEM, signs a JWT, and verifies the signature + claims with the public key — exercising the real signing path.

```typescript
import { describe, expect, it } from "vitest";
import { createAppJwt } from "./app-jwt";

function pemFromDer(der: ArrayBuffer, label: string): string {
  const b64 = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

async function genKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return { privateKeyPem: pemFromDer(pkcs8, "PRIVATE KEY"), publicKey: pair.publicKey };
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

describe("createAppJwt", () => {
  it("produces a verifiable RS256 JWT with iss/iat/exp", async () => {
    const { privateKeyPem, publicKey } = await genKeys();
    const jwt = await createAppJwt("123456", privateKeyPem);

    const [h, p, s] = jwt.split(".");
    const header = JSON.parse(Buffer.from(b64urlToBytes(h)).toString("utf8"));
    const payload = JSON.parse(Buffer.from(b64urlToBytes(p)).toString("utf8"));
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("123456");
    expect(payload.exp).toBeGreaterThan(payload.iat);

    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run ../lib/app-jwt.test.ts`
Expected: FAIL — cannot find module `./app-jwt`.

- [ ] **Step 3: Implement**

```typescript
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** Decode a PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`) to its DER bytes. */
function pkcs8DerFromPem(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer;
}

/**
 * Create a short-lived GitHub App JWT (RS256). `privateKeyPem` MUST be PKCS#8.
 * Clock is skewed back 60s per GitHub's guidance; expires in 9 minutes.
 */
export async function createAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8DerFromPem(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run ../lib/app-jwt.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add lib/app-jwt.ts lib/app-jwt.test.ts
git commit -m "feat(lib): GitHub App RS256 JWT signer via Web Crypto"
```

---

### Task 5: Installation-token minter (with in-memory cache)

Resolves the App's installation on `owner/repo`, mints an installation access token, and caches it per repo until shortly before expiry.

**Files:**
- Create: `lib/installation-token.ts`
- Test: `lib/installation-token.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetTokenCacheForTest, getInstallationToken } from "./installation-token";

vi.mock("./app-jwt", () => ({ createAppJwt: async () => "test.jwt.sig" }));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  __resetTokenCacheForTest();
});

const env = { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "pk" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getInstallationToken", () => {
  it("resolves the installation then mints a token", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 42 })) // GET .../installation
      .mockResolvedValueOnce(jsonResponse({ token: "ghs_abc", expires_at: future })); // POST access_tokens
    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await getInstallationToken(env, "o", "r");
    expect(token).toBe("ghs_abc");
    expect(fetchMock.mock.calls[0][0]).toContain("/repos/o/r/installation");
    expect(fetchMock.mock.calls[1][0]).toContain("/app/installations/42/access_tokens");
  });

  it("caches the token for the same repo (no second mint)", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 42 }))
      .mockResolvedValueOnce(jsonResponse({ token: "ghs_abc", expires_at: future }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await getInstallationToken(env, "o", "r");
    const again = await getInstallationToken(env, "o", "r");
    expect(again).toBe("ghs_abc");
    expect(fetchMock).toHaveBeenCalledTimes(2); // not 4
  });

  it("throws when the app is not installed on the repo (404)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({}, 404)) as unknown as typeof fetch;
    await expect(getInstallationToken(env, "o", "r")).rejects.toThrow(/not installed/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run ../lib/installation-token.test.ts`
Expected: FAIL — cannot find module `./installation-token`.

- [ ] **Step 3: Implement**

```typescript
import { createAppJwt } from "./app-jwt";

export interface AppEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

const API = "https://api.github.com";
const SKEW_MS = 60_000; // refresh a minute before expiry

interface CacheEntry {
  token: string;
  expiresAtMs: number;
}
const cache = new Map<string, CacheEntry>();

/** Test-only: clear the module-level token cache between cases. */
export function __resetTokenCacheForTest(): void {
  cache.clear();
}

function appHeaders(jwt: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "marginsmd",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Return a (cached) installation access token for the App on `owner/repo`.
 * Throws "App not installed" on a 404 from the installation lookup so the
 * caller can fail closed (→ 404 to the client).
 */
export async function getInstallationToken(
  env: AppEnv,
  owner: string,
  repo: string,
): Promise<string> {
  const key = `${owner}/${repo}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAtMs - SKEW_MS > Date.now()) return hit.token;

  const jwt = await createAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);

  const instRes = await fetch(`${API}/repos/${owner}/${repo}/installation`, {
    headers: appHeaders(jwt),
  });
  if (instRes.status === 404) throw new Error("App not installed on repo");
  if (!instRes.ok) throw new Error(`installation lookup failed (${instRes.status})`);
  const installation = (await instRes.json()) as { id: number };

  const tokRes = await fetch(`${API}/app/installations/${installation.id}/access_tokens`, {
    method: "POST",
    headers: appHeaders(jwt),
  });
  if (!tokRes.ok) throw new Error(`installation token mint failed (${tokRes.status})`);
  const minted = (await tokRes.json()) as { token: string; expires_at: string };

  cache.set(key, { token: minted.token, expiresAtMs: Date.parse(minted.expires_at) });
  return minted.token;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run ../lib/installation-token.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/installation-token.ts lib/installation-token.test.ts
git commit -m "feat(lib): cached GitHub App installation-token minter"
```

---

### Task 6: Public-doc handler (gating + clean body) — framework-free core

The decision logic, separated from the Pages-Function wrapper so it's unit-testable (mirrors how `auth/exchange.ts` is split from `[[route]].ts`).

**Files:**
- Create: `lib/public-doc.ts`
- Test: `lib/public-doc.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
    JSON.stringify({ content: Buffer.from(markdown, "utf8").toString("base64"), encoding: "base64" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("handlePublicDoc", () => {
  it("404s when public is not true (no existence leak)", async () => {
    global.fetch = vi.fn(async () => contentsResponse("---\npublic: false\n---\nsecret")) as never;
    const res = await handlePublicDoc(env, { owner: "o", repo: "r", path: "d.md" });
    expect(res.status).toBe(404);
  });

  it("404s when the file does not exist", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 404 })) as never;
    const res = await handlePublicDoc(env, { owner: "o", repo: "r", path: "missing.md" });
    expect(res.status).toBe(404);
  });

  it("404s when the app is not installed (getInstallationToken throws)", async () => {
    const mod = await import("./installation-token");
    vi.spyOn(mod, "getInstallationToken").mockRejectedValueOnce(new Error("App not installed on repo"));
    const res = await handlePublicDoc(env, { owner: "o", repo: "r", path: "d.md" });
    expect(res.status).toBe(404);
  });

  it("serves a clean, comment-stripped body when public:true", async () => {
    const md = '---\npublic: true\n---\n# Hi {>>note<<}{id="c1" by="x" at="y"} there\n';
    global.fetch = vi.fn(async () => contentsResponse(md)) as never;
    const res = await handlePublicDoc(env, { owner: "o", repo: "r", path: "d.md" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string; comments: boolean; suggestions: boolean };
    expect(body.comments).toBe(false);
    expect(body.markdown).toContain("# Hi  there");
    expect(body.markdown).not.toContain("note");
  });

  it("rejects a path traversal attempt with 400", async () => {
    const res = await handlePublicDoc(env, { owner: "o", repo: "r", path: "../etc/passwd" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run ../lib/public-doc.test.ts`
Expected: FAIL — cannot find module `./public-doc`.

- [ ] **Step 3: Implement**

```typescript
import { type AppEnv, getInstallationToken } from "./installation-token";
import { readSharingFlags } from "./sharing-flags";
import { stripCriticMarkup } from "./strip-critic-markup";

const API = "https://api.github.com";

export interface PublicDocParams {
  owner: string;
  repo: string;
  path: string;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });

const notFound = (): Response =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });

/** A path must be a relative markdown path — no traversal, no leading slash. */
function isSafeMarkdownPath(path: string): boolean {
  if (!path || path.startsWith("/")) return false;
  if (path.split("/").some((seg) => seg === "..")) return false;
  return /\.md$/i.test(path);
}

/**
 * Resolve a public read. Fail closed: any not-allowed/not-found/error condition
 * collapses to 404 so a private file is indistinguishable from a missing one.
 * Returns 400 only for a malformed request path.
 */
export async function handlePublicDoc(env: AppEnv, params: PublicDocParams): Promise<Response> {
  const { owner, repo, path } = params;
  if (!owner || !repo || !isSafeMarkdownPath(path)) {
    return new Response("Bad request", { status: 400 });
  }

  let token: string;
  try {
    token = await getInstallationToken(env, owner, repo);
  } catch {
    return notFound(); // app not installed / lookup failure → indistinguishable
  }

  // Default branch (no `ref`): the contents API serves the repo's default branch.
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "marginsmd",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return notFound();

  const file = (await res.json()) as { content?: string; encoding?: string };
  if (!file.content || file.encoding !== "base64") return notFound();
  const markdown = new TextDecoder().decode(
    Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
  );

  const flags = readSharingFlags(markdown);
  if (!flags.public) return notFound();

  // Phase 1A: comments not yet shipped → always serve the clean, stripped body.
  return json(
    { markdown: stripCriticMarkup(markdown), comments: false, suggestions: false },
    200,
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run ../lib/public-doc.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/public-doc.ts lib/public-doc.test.ts
git commit -m "feat(lib): gated public-doc handler (fail closed, clean body)"
```

---

### Task 7: Pages Function route + env wiring

The thin Cloudflare Pages Function that exposes `GET /api/public/doc`, plus the secret/permission setup notes.

**Files:**
- Create: `functions/api/public/doc.ts`
- Modify: `docs/deploy-cloudflare.md` (add the new secrets + App-permission note)

- [ ] **Step 1: Create the Function**

`functions/api/public/doc.ts` (file-based routing → `/api/public/doc`):

```typescript
import { handlePublicDoc } from "../../../lib/public-doc";

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

export const onRequestGet: (ctx: {
  request: Request;
  env: Env;
}) => Promise<Response> = async ({ request, env }) => {
  const url = new URL(request.url);
  return handlePublicDoc(env, {
    owner: url.searchParams.get("owner") || "",
    repo: url.searchParams.get("repo") || "",
    path: url.searchParams.get("path") || "",
  });
};
```

- [ ] **Step 2: Type-check the build**

Run: `cd app && npm run build`
Expected: the Vite/tsc build for the SPA still succeeds (the Function compiles under Wrangler at deploy; the import path `../../../lib/public-doc` resolves at the repo root, matching how `[[route]].ts` imports `../../../auth/exchange`).

- [ ] **Step 3: Document the new secrets and App permission**

In `docs/deploy-cloudflare.md`, under the env-vars section, add:

```markdown
### Public sharing (Phase 1A) — additional secrets

The public-read endpoint (`/api/public/doc`) acts as the GitHub **App** (not the
viewer) so it can serve `public: true` docs to logged-out visitors. Set:

- `GITHUB_APP_ID` — the App's numeric App ID (App settings → "About").
- `GITHUB_APP_PRIVATE_KEY` — the App's private key in **PKCS#8** PEM. GitHub issues
  PKCS#1 (`BEGIN RSA PRIVATE KEY`); convert once:
  `openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app.pkcs8.pem`
  then paste the `BEGIN PRIVATE KEY` contents as the secret.

```bash
wrangler pages secret put GITHUB_APP_ID --project-name marginsmd
wrangler pages secret put GITHUB_APP_PRIVATE_KEY --project-name marginsmd
```

App **installation permission** required: **Contents: Read-only** (Phase 1A view).
The App must be installed on any repo whose docs are shared.
```

- [ ] **Step 4: Commit**

```bash
git add functions/api/public/doc.ts docs/deploy-cloudflare.md
git commit -m "feat(functions): GET /api/public/doc public-read endpoint + deploy notes"
```

---

### Task 8: Full suite + manual smoke

- [ ] **Step 1: Run the whole test suite**

Run: `cd app && npm run test`
Expected: PASS, including the new `lib/*.test.ts` files. No regressions.

- [ ] **Step 2: Lint**

Run: `cd app && npm run lint`
Expected: clean (Biome). Fix any findings in the new `lib/` files.

- [ ] **Step 3: Manual smoke (after deploy, optional but recommended)**

With the secrets set and the App installed on a test repo containing a doc with `public: true` frontmatter on the default branch:

```bash
curl -i "https://marginsmd.pages.dev/api/public/doc?owner=<o>&repo=<r>&path=<path>.md"
# Expect 200 + JSON { markdown, comments:false, suggestions:false }, comment markup stripped.
curl -i "https://marginsmd.pages.dev/api/public/doc?owner=<o>&repo=<r>&path=<a-private-doc>.md"
# Expect 404 (no leak).
```

- [ ] **Step 4: Final commit (if lint produced fixes)**

```bash
git add -A
git commit -m "chore: lint fixes for public-sharing server modules"
```

---

## Self-review notes (coverage against the spec)

- **Server-side installation token (private key → JWT → token, cached):** Tasks 4–5. ✓
- **`GET /api/public/doc` + fail-closed gating (non-public/missing/not-installed/traversal → 404/400, default branch, single file):** Tasks 6–7. ✓
- **Clean body / no comment leak in Phase 1:** Task 3 (stripper) + Task 6 (always-clean in 1A). ✓
- **`yaml`/`app/src` not importable server-side:** all logic is dependency-free under `lib/`. ✓
- **Secrets + App permission (Contents: read), PKCS#8 caveat:** Task 7. ✓
- **Edge cache (short TTL):** `Cache-Control: public, max-age=60` on responses (Task 6). ✓
- **Out of scope here (Plan 1B):** client logged-out detection, read-only render, the Share UI, push-permission detection, the frontmatter *setter*. These consume this API.
