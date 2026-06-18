# Public Comments (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let logged-out visitors see and add comments (new anchored comments + replies) on a doc whose frontmatter says `public: true` and `comments: true`.

**Architecture:** A new framework-free `lib/insert-public-comment.ts` splices a guest comment into markdown as CriticMarkup; `lib/public-doc.ts` stops stripping when `comments:true`; a gated `POST /api/public/comment` (`lib/public-comment.ts` + `functions/api/public/comment.ts`) re-gates, validates, inserts, and commits as `margins[bot]` via the existing installation token; the client gains `PublicBackend.addComment`, guest-name capture, a guest-aware comment parse, and a Share **Comments** toggle. The browser never sends file content — the server is the only writer.

**Tech Stack:** TypeScript, Vite/React SPA (`app/`), Cloudflare Pages Functions (`functions/`), framework-free server modules (`lib/`), vitest, biome.

## Global Constraints

- TypeScript strict; lint with `npx biome check .` (0 errors) — run from `app/`.
- Server modules under `lib/` and `functions/` are **framework-free** (no React/editor imports) and run in CI's Node 20. Their test files MUST start with `// @vitest-environment node` (Web Crypto + cross-realm ArrayBuffer; jsdom breaks on Node 20).
- Tests run via `npx vitest run` from `app/` (config discovers `../lib/**/*.test.ts`).
- Fail closed: not-allowed/not-found ⇒ 404 (no existence leak); see error table below.
- Comment markup format (must match the client parser exactly): a thread is `{==anchor==}` then one or more `{>>content<<}{id="…" by="…" at="<ISO>" …}` blocks; reply blocks add `re="<parentId>"`. Guest blocks add `guest="true"`. Attribute values escape `"`→`\"` and `\`→`\\`.
- Limits: `MAX_COMMENT_LEN = 2000`, `MAX_NAME_LEN = 60`.
- Commit early and often (one commit per task minimum).

Error/status contract for `/api/public/comment`:

| Condition | Status |
|---|---|
| Malformed body / over-length / bad path | 400 (no-store) |
| App not installed / token fail / missing file / not public | 404 |
| `public:true` but `comments:false` | 403 |
| Anchor not found / overlaps markup / parent missing | 409 |
| sha conflict after one retry | 409 |
| Success | 200 (no-store) |

---

## File Structure

- Create `lib/insert-public-comment.ts` (+ `.test.ts`) — pure CriticMarkup insertion (new + reply).
- Modify `lib/public-doc.ts` (+ `.test.ts`) — serve CriticMarkup when `comments:true`.
- Create `lib/public-comment.ts` (+ `.test.ts`) — `handlePublicComment` (validate → token → re-gate → insert → commit).
- Create `functions/api/public/comment.ts` — thin POST wrapper.
- Modify `app/src/public-backend.ts` (+ `.test.ts`) — `addComment`.
- Create `app/src/guest-identity.ts` (+ `.test.ts`) — localStorage guest-name get/set.
- Modify `app/src/critic-markup/comment-threads.ts` + the parse in `app/src/critic-markup/index.ts` (+ tests) — add `guest` flag.
- Modify `app/src/SharePopover.tsx` (+ `.test.tsx`) — Comments toggle.
- Modify `app/src/DocumentWorkspace.tsx` — wire guest add/reply in the read-only public rail.
- Modify `docs/deploy-cloudflare.md` — document the Cloudflare rate-limit rule.

---

## Task 1: `insertPublicComment` — new anchored comment

**Files:**
- Create: `lib/insert-public-comment.ts`
- Test: `lib/insert-public-comment.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NewCommentInput {
    mode: "new";
    quote: string;        // exact selected text
    occurrence: number;   // 1-based: which plain-text match of quote in the body
    text: string; authorName: string; id: string; atIso: string;
  }
  export interface ReplyCommentInput {
    mode: "reply";
    parentId: string;
    text: string; authorName: string; id: string; atIso: string;
  }
  export type InsertInput = NewCommentInput | ReplyCommentInput;
  export class AnchorError extends Error {}
  export function insertPublicComment(markdown: string, input: InsertInput): string;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AnchorError, insertPublicComment } from "./insert-public-comment";

const base = (body: string) => `---\npublic: true\ncomments: true\n---\n${body}`;

describe("insertPublicComment — new", () => {
  it("wraps the chosen occurrence in a guest comment thread", () => {
    const md = base("The cat sat. The cat ran.\n");
    const out = insertPublicComment(md, {
      mode: "new", quote: "cat", occurrence: 2,
      text: "which one?", authorName: 'Jane "JD"', id: "g1", atIso: "2026-06-18T00:00:00.000Z",
    });
    expect(out).toContain('The cat sat. The {==cat==}{>>which one?<<}{id="g1" by="Jane \\"JD\\"" at="2026-06-18T00:00:00.000Z" guest="true"} ran.');
  });

  it("ignores matches inside the frontmatter block", () => {
    const md = base("public mention of cat\n"); // 'public' also in frontmatter
    const out = insertPublicComment(md, {
      mode: "new", quote: "public", occurrence: 1,
      text: "x", authorName: "A", id: "g2", atIso: "2026-06-18T00:00:00.000Z",
    });
    expect(out).toContain("{==public==}"); // the body occurrence, not the frontmatter key
    expect(out.split("---")[1]).not.toContain("{==");
  });

  it("throws AnchorError when the occurrence does not exist", () => {
    expect(() => insertPublicComment(base("hello\n"), {
      mode: "new", quote: "cat", occurrence: 1, text: "x", authorName: "A", id: "g3", atIso: "t",
    })).toThrow(AnchorError);
  });

  it("throws AnchorError when the match overlaps existing critic markup", () => {
    const md = base("a {==cat==}{>>note<<}{id=\"x\" by=\"y\" at=\"t\"} b\n");
    expect(() => insertPublicComment(md, {
      mode: "new", quote: "cat", occurrence: 1, text: "x", authorName: "A", id: "g4", atIso: "t",
    })).toThrow(AnchorError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `app/`): `npx vitest run ../lib/insert-public-comment.test.ts`
Expected: FAIL ("Cannot find module './insert-public-comment'").

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/insert-public-comment.ts
export interface NewCommentInput {
  mode: "new";
  quote: string;
  occurrence: number;
  text: string; authorName: string; id: string; atIso: string;
}
export interface ReplyCommentInput {
  mode: "reply";
  parentId: string;
  text: string; authorName: string; id: string; atIso: string;
}
export type InsertInput = NewCommentInput | ReplyCommentInput;

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorError";
  }
}

const escapeAttr = (v: string): string => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function frontmatterEnd(markdown: string): number {
  const m = markdown.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? m[0].length : 0;
}

function metaBlock(id: string, by: string, atIso: string, parentId?: string): string {
  let s = `{id="${escapeAttr(id)}" by="${escapeAttr(by)}" at="${escapeAttr(atIso)}"`;
  if (parentId) s += ` re="${escapeAttr(parentId)}"`;
  s += ` guest="true"}`;
  return s;
}

function commentBlock(text: string, id: string, by: string, atIso: string, parentId?: string): string {
  return `{>>${text}<<}${metaBlock(id, by, atIso, parentId)}`;
}

export function insertPublicComment(markdown: string, input: InsertInput): string {
  if (input.mode === "new") {
    const bodyStart = frontmatterEnd(markdown);
    // find the occurrence-th match of quote within the body, not inside critic markup
    let from = bodyStart;
    let count = 0;
    let at = -1;
    while (count < input.occurrence) {
      const idx = markdown.indexOf(input.quote, from);
      if (idx === -1) throw new AnchorError("quote occurrence not found");
      count++;
      at = idx;
      from = idx + input.quote.length;
    }
    // reject if the match overlaps an existing {== … ==} or {>> … <<} region
    const before = markdown.slice(bodyStart, at);
    if (/\{==|\{>>/.test(before.slice(before.lastIndexOf("}") + 1))) {
      throw new AnchorError("match overlaps existing critic markup");
    }
    const end = at + input.quote.length;
    const wrapped = `{==${input.quote}==}${commentBlock(input.text, input.id, input.authorName, input.atIso)}`;
    return markdown.slice(0, at) + wrapped + markdown.slice(end);
  }

  // reply: insert a block immediately after the parent's metadata block
  const parentMeta = new RegExp(`\\{id="${input.parentId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"[^}]*\\}`);
  const m = markdown.match(parentMeta);
  if (!m || m.index === undefined) throw new AnchorError("parent comment not found");
  const insertAt = m.index + m[0].length;
  const block = commentBlock(input.text, input.id, input.authorName, input.atIso, input.parentId);
  return markdown.slice(0, insertAt) + block + markdown.slice(insertAt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run ../lib/insert-public-comment.test.ts`
Expected: PASS (4 tests). If the overlap heuristic misfires, tighten `before` scan to the current line.

- [ ] **Step 5: Commit**

```bash
git add lib/insert-public-comment.ts lib/insert-public-comment.test.ts
git commit -m "feat(lib): framework-free guest-comment inserter (new-anchor mode)"
```

---

## Task 2: `insertPublicComment` — reply mode

**Files:**
- Modify: `lib/insert-public-comment.test.ts`
- (Implementation already added in Task 1; this task locks reply behavior with tests and fixes any gaps.)

**Interfaces:**
- Consumes: `insertPublicComment(markdown, ReplyCommentInput)` from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
describe("insertPublicComment — reply", () => {
  const thread = (body: string) => `---\npublic: true\ncomments: true\n---\n${body}`;
  const doc = thread('See {==here==}{>>first<<}{id="c1" by="A" at="t1"} now.\n');

  it("appends a reply block carrying re=<parentId> right after the parent block", () => {
    const out = insertPublicComment(doc, {
      mode: "reply", parentId: "c1", text: "agreed",
      authorName: "Bob", id: "c2", atIso: "2026-06-18T00:00:00.000Z",
    });
    expect(out).toContain('{id="c1" by="A" at="t1"}{>>agreed<<}{id="c2" by="Bob" at="2026-06-18T00:00:00.000Z" re="c1" guest="true"}');
  });

  it("throws AnchorError when the parent id is absent", () => {
    expect(() => insertPublicComment(doc, {
      mode: "reply", parentId: "nope", text: "x", authorName: "B", id: "c9", atIso: "t",
    })).toThrow(AnchorError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run ../lib/insert-public-comment.test.ts`
Expected: the reply tests PASS if Task 1's reply branch is correct; if the parent-id regex escaping is wrong, FIX `insert-public-comment.ts` until green. (Simplify the escape to: `input.parentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`.)

- [ ] **Step 3: Verify whole file green + lint**

Run: `npx vitest run ../lib/insert-public-comment.test.ts && npx biome check ../lib/insert-public-comment.ts`
Expected: PASS, 0 lint errors.

- [ ] **Step 4: Commit**

```bash
git add lib/insert-public-comment.ts lib/insert-public-comment.test.ts
git commit -m "test(lib): lock guest-comment reply insertion"
```

---

## Task 3: serve CriticMarkup when `comments:true`

**Files:**
- Modify: `lib/public-doc.ts` (the success branch, currently ~lines 86-97)
- Test: `lib/public-doc.test.ts`

**Interfaces:**
- Consumes: `readSharingFlags` (existing), `stripCriticMarkup` (existing).
- Produces: 200 body `{ markdown, comments: boolean, suggestions: boolean }` where `comments` reflects the flag and the markdown is stripped only when `comments` is false.

- [ ] **Step 1: Write the failing test** (append to `lib/public-doc.test.ts`)

```ts
it("keeps CriticMarkup and reports comments:true when public+comments", async () => {
  const md = '---\npublic: true\ncomments: true\n---\n# Hi {==x==}{>>n<<}{id="c" by="A" at="t"}\n';
  global.fetch = vi.fn(async () => contentsResponse(md)) as never;
  const res = await handlePublicDoc(env, { owner: "o", repo: "r", path: "d.md" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { markdown: string; comments: boolean };
  expect(body.comments).toBe(true);
  expect(body.markdown).toContain("{>>n<<}");
});

it("still strips CriticMarkup when comments is absent/false", async () => {
  const md = '---\npublic: true\n---\n# Hi {==x==}{>>n<<}{id="c" by="A" at="t"}\n';
  global.fetch = vi.fn(async () => contentsResponse(md)) as never;
  const res = await handlePublicDoc(env, { owner: "o", repo: "r", path: "d.md" });
  const body = (await res.json()) as { markdown: string; comments: boolean };
  expect(body.comments).toBe(false);
  expect(body.markdown).not.toContain("{>>");
});
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `npx vitest run ../lib/public-doc.test.ts`
Expected: FAIL (today always returns comments:false / stripped).

- [ ] **Step 3: Implement** — replace the success block in `lib/public-doc.ts`:

```ts
  const flags = readSharingFlags(markdown);
  if (!flags.public) return notFound();

  return json(
    {
      markdown: flags.comments ? markdown : stripCriticMarkup(markdown),
      comments: flags.comments,
      suggestions: false, // Phase 3
    },
    200,
  );
```

- [ ] **Step 4: Run tests** — `npx vitest run ../lib/public-doc.test.ts` → all PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add lib/public-doc.ts lib/public-doc.test.ts
git commit -m "feat(lib): serve CriticMarkup intact when comments:true"
```

---

## Task 4: `handlePublicComment` — gated write path

**Files:**
- Create: `lib/public-comment.ts`
- Test: `lib/public-comment.test.ts`

**Interfaces:**
- Consumes: `getInstallationToken` (existing), `readSharingFlags` (existing), `insertPublicComment` + `AnchorError` (Task 1), `isSafeMarkdownPath` (export it from `lib/public-doc.ts`).
- Produces:
  ```ts
  export const MAX_COMMENT_LEN = 2000;
  export const MAX_NAME_LEN = 60;
  export interface CommentRequest {
    owner: string; repo: string; path: string;
    mode: "new" | "reply"; text: string; authorName: string;
    anchor?: { quote: string; occurrence: number }; parentId?: string;
  }
  export function handlePublicComment(env: AppEnv, body: CommentRequest, ids: { id: string; atIso: string }): Promise<Response>;
  ```
  (`ids` is injected so tests are deterministic; the Function generates them.)

- [ ] **Step 0: Export the path guard** — in `lib/public-doc.ts` change `function isSafeMarkdownPath` to `export function isSafeMarkdownPath`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePublicComment } from "./public-comment";

vi.mock("./installation-token", () => ({ getInstallationToken: async () => "ghs_test" }));
const env = { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "pk" };
const ids = { id: "g1", atIso: "2026-06-18T00:00:00.000Z" };
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function fileResponse(markdown: string) {
  return new Response(JSON.stringify({
    content: Buffer.from(markdown, "utf8").toString("base64"),
    encoding: "base64", sha: "abc123",
  }), { status: 200 });
}
const req = (over: Partial<Parameters<typeof handlePublicComment>[1]> = {}) => ({
  owner: "o", repo: "r", path: "d.md", mode: "new" as const,
  text: "hi", authorName: "Jane", anchor: { quote: "cat", occurrence: 1 }, ...over,
});

describe("handlePublicComment", () => {
  it("403 when comments flag is off", async () => {
    global.fetch = vi.fn(async () => fileResponse("---\npublic: true\n---\nThe cat.\n")) as never;
    const res = await handlePublicComment(env, req(), ids);
    expect(res.status).toBe(403);
  });

  it("400 on over-length text", async () => {
    const res = await handlePublicComment(env, req({ text: "x".repeat(2001) }), ids);
    expect(res.status).toBe(400);
  });

  it("409 when the anchor quote is missing", async () => {
    global.fetch = vi.fn(async () => fileResponse("---\npublic: true\ncomments: true\n---\nno match here\n")) as never;
    const res = await handlePublicComment(env, req(), ids);
    expect(res.status).toBe(409);
  });

  it("commits the inserted comment as margins[bot] and returns 200", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (!init || init.method !== "PUT") return fileResponse("---\npublic: true\ncomments: true\n---\nThe cat sat.\n");
      return new Response(JSON.stringify({ commit: { sha: "new" } }), { status: 200 });
    }) as never;
    const res = await handlePublicComment(env, req(), ids);
    expect(res.status).toBe(200);
    const put = calls.find((c) => c.init?.method === "PUT");
    const sent = JSON.parse(String(put?.init?.body));
    const decoded = Buffer.from(sent.content, "base64").toString("utf8");
    expect(decoded).toContain('{==cat==}{>>hi<<}');
    expect(decoded).toContain('guest="true"');
    expect(sent.sha).toBe("abc123");
    expect(sent.author.name).toBe("margins[bot]");
    expect(sent.message).toContain("Public comment by Jane (guest)");
  });

  it("never accepts caller-supplied file content", async () => {
    global.fetch = vi.fn(async () => fileResponse("---\npublic: true\ncomments: true\n---\nThe cat sat.\n")) as never;
    // @ts-expect-error — content is not part of CommentRequest
    const res = await handlePublicComment(env, req({ content: "evil" }), ids);
    expect(res.status).toBe(200); // ignored, normal insert
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run ../lib/public-comment.test.ts`
Expected: FAIL ("Cannot find module './public-comment'").

- [ ] **Step 3: Implement**

```ts
// lib/public-comment.ts
import { type AppEnv, getInstallationToken } from "./installation-token";
import { AnchorError, insertPublicComment } from "./insert-public-comment";
import { isSafeMarkdownPath } from "./public-doc";
import { readSharingFlags } from "./sharing-flags";

const API = "https://api.github.com";
export const MAX_COMMENT_LEN = 2000;
export const MAX_NAME_LEN = 60;

export interface CommentRequest {
  owner: string; repo: string; path: string;
  mode: "new" | "reply"; text: string; authorName: string;
  anchor?: { quote: string; occurrence: number }; parentId?: string;
}

const resp = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const plain = (msg: string, status: number): Response =>
  new Response(msg, { status, headers: { "Cache-Control": "no-store" } });

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
    "User-Agent": "marginsmd", "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Chunked base64 — String.fromCharCode(...bytes) overflows the call stack on
// large docs (a real doc can be 100+ KB).
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function handlePublicComment(
  env: AppEnv, body: CommentRequest, ids: { id: string; atIso: string },
): Promise<Response> {
  const { owner, repo, path, mode, text, authorName } = body;
  if (!owner || !repo || !isSafeMarkdownPath(path)) return plain("Bad request", 400);
  if (mode !== "new" && mode !== "reply") return plain("Bad request", 400);
  if (!text || text.length > MAX_COMMENT_LEN) return plain("Bad request", 400);
  if (!authorName || authorName.trim().length === 0 || authorName.length > MAX_NAME_LEN)
    return plain("Bad request", 400);
  if (mode === "new" && (!body.anchor || !body.anchor.quote)) return plain("Bad request", 400);
  if (mode === "reply" && !body.parentId) return plain("Bad request", 400);

  let token: string;
  try { token = await getInstallationToken(env, owner, repo); }
  catch { return plain("Not found", 404); }

  const contentsUrl = `${API}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;

  const readFile = async (): Promise<{ markdown: string; sha: string } | null> => {
    const res = await fetch(contentsUrl, { headers: ghHeaders(token) });
    if (!res.ok) return null;
    const file = (await res.json()) as { content?: string; encoding?: string; sha?: string };
    if (!file.content || file.encoding !== "base64" || !file.sha) return null;
    const markdown = new TextDecoder().decode(
      Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
    );
    return { markdown, sha: file.sha };
  };

  const commit = async (newMarkdown: string, sha: string): Promise<Response> => {
    const put = await fetch(contentsUrl, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({
        message: `Public comment by ${authorName} (guest) on ${path}`,
        content: toBase64(newMarkdown),
        sha,
        author: { name: "margins[bot]", email: "margins[bot]@users.noreply.github.com" },
        committer: { name: "margins[bot]", email: "margins[bot]@users.noreply.github.com" },
      }),
    });
    return put.ok ? resp({ markdown: newMarkdown, comments: true, suggestions: false }, 200) : put.status === 409 ? plain("Conflict", 409) : plain("Not found", 404);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await readFile();
    if (!file) return plain("Not found", 404);
    const flags = readSharingFlags(file.markdown);
    if (!flags.public) return plain("Not found", 404);
    if (!flags.comments) return plain("Forbidden", 403);

    let next: string;
    try {
      next = insertPublicComment(file.markdown,
        mode === "new"
          ? { mode: "new", quote: body.anchor!.quote, occurrence: body.anchor!.occurrence ?? 1, text, authorName, id: ids.id, atIso: ids.atIso }
          : { mode: "reply", parentId: body.parentId!, text, authorName, id: ids.id, atIso: ids.atIso });
    } catch (e) {
      if (e instanceof AnchorError) return plain("Conflict", 409);
      return plain("Not found", 404);
    }
    const out = await commit(next, file.sha);
    if (out.status !== 409 || attempt === 1) return out;
  }
  return plain("Conflict", 409);
}
```

- [ ] **Step 4: Run tests** — `npx vitest run ../lib/public-comment.test.ts` → PASS (5). Then `npx biome check ../lib/public-comment.ts` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/public-comment.ts lib/public-comment.test.ts lib/public-doc.ts
git commit -m "feat(lib): gated POST handler for guest comments (re-gate, insert, bot-commit)"
```

---

## Task 5: `POST /api/public/comment` Function

**Files:**
- Create: `functions/api/public/comment.ts`

**Interfaces:**
- Consumes: `handlePublicComment` (Task 4).

- [ ] **Step 1: Implement the thin wrapper** (mirrors `functions/api/public/doc.ts`)

```ts
import { type CommentRequest, handlePublicComment } from "../../../lib/public-comment";

interface Env { GITHUB_APP_ID: string; GITHUB_APP_PRIVATE_KEY: string }

export const onRequestPost: (ctx: { request: Request; env: Env }) => Promise<Response> =
  async ({ request, env }) => {
    let body: CommentRequest;
    try { body = (await request.json()) as CommentRequest; }
    catch { return new Response("Bad request", { status: 400, headers: { "Cache-Control": "no-store" } }); }
    const id = crypto.randomUUID();
    const atIso = new Date().toISOString();
    return handlePublicComment(env, body, { id, atIso });
  };
```

- [ ] **Step 2: Typecheck + lint**

Run (from `app/`): `npx tsc -b && npx biome check ../functions/api/public/comment.ts`
Expected: 0 errors. (No unit test for the wrapper; its logic is covered by Task 4.)

- [ ] **Step 3: Commit**

```bash
git add functions/api/public/comment.ts
git commit -m "feat(functions): POST /api/public/comment endpoint"
```

---

## Task 6: guest identity + `PublicBackend.addComment`

**Files:**
- Create: `app/src/guest-identity.ts` (+ `app/src/guest-identity.test.ts`)
- Modify: `app/src/public-backend.ts` (+ `app/src/public-backend.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  // guest-identity.ts
  export function getGuestName(): string;          // "" if unset
  export function setGuestName(name: string): void; // localStorage "margins:guest-name"
  // public-backend.ts
  interface AddCommentInput { mode: "new" | "reply"; text: string; authorName: string;
    anchor?: { quote: string; occurrence: number }; parentId?: string }
  addComment(input: AddCommentInput): Promise<Page>; // returns refreshed doc
  ```

- [ ] **Step 1: Write failing tests**

```ts
// guest-identity.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { getGuestName, setGuestName } from "./guest-identity";
beforeEach(() => localStorage.clear());
describe("guest identity", () => {
  it("returns '' when unset and round-trips a trimmed name", () => {
    expect(getGuestName()).toBe("");
    setGuestName("  Jane  ");
    expect(getGuestName()).toBe("Jane");
  });
});
```
```ts
// add to public-backend.test.ts
it("addComment POSTs to the endpoint and returns the refreshed doc", async () => {
  const fetchMock = vi.fn(async () => new Response(
    JSON.stringify({ markdown: "# Hi {==x==}{>>n<<}{id=\"c\" by=\"Jane\" at=\"t\" guest=\"true\"}", comments: true }),
    { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const be = new PublicBackend({ owner: "o", repo: "r", path: "d.md" });
  const page = await be.addComment({ mode: "new", text: "n", authorName: "Jane", anchor: { quote: "x", occurrence: 1 } });
  expect(fetchMock).toHaveBeenCalledWith("/api/public/comment", expect.objectContaining({ method: "POST" }));
  expect(page.content).toContain("{>>n<<}");
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/guest-identity.test.ts src/public-backend.test.ts` → FAIL.

- [ ] **Step 3: Implement `guest-identity.ts`**

```ts
const KEY = "margins:guest-name";
export function getGuestName(): string {
  try { return localStorage.getItem(KEY)?.trim() ?? ""; } catch { return ""; }
}
export function setGuestName(name: string): void {
  try { localStorage.setItem(KEY, name.trim()); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Implement `addComment`** in `public-backend.ts` (add the input type near the top and the method on the class):

```ts
export interface AddCommentInput {
  mode: "new" | "reply"; text: string; authorName: string;
  anchor?: { quote: string; occurrence: number }; parentId?: string;
}
// ...inside class PublicBackend:
async addComment(input: AddCommentInput): Promise<Page> {
  const { owner, repo, path } = this.cfg;
  const res = await fetch("/api/public/comment", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo, path, ...input }),
  });
  if (res.status === 403) throw new Error("Comments are not enabled on this document.");
  if (res.status === 409) throw new Error("Couldn't place that comment — the text may have changed. Try again.");
  if (res.status === 429) throw new Error("Too many comments too quickly. Please wait a moment.");
  if (!res.ok) throw new Error(`Comment failed (${res.status})`);
  const body = (await res.json()) as { markdown: string };
  return { id: path, title: titleFromContent(body.markdown, path.split("/").at(-1) || path), content: body.markdown };
}
```

- [ ] **Step 5: Run tests + lint** — `npx vitest run src/guest-identity.test.ts src/public-backend.test.ts && npx biome check src/guest-identity.ts src/public-backend.ts` → PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/guest-identity.ts app/src/guest-identity.test.ts app/src/public-backend.ts app/src/public-backend.test.ts
git commit -m "feat(app): guest identity + PublicBackend.addComment"
```

---

## Task 7: guest-aware comment parse + render

**Files:**
- Modify: `app/src/critic-markup/comment-threads.ts` (add `guest?: boolean` to `CriticComment`)
- Modify: `app/src/critic-markup/index.ts` (the metadata parse blocks ~lines 109-116 and 143-148: read `guest`)
- Test: `app/src/critic-markup/comment-threads.test.ts` (create if absent) or an existing critic-markup test

**Interfaces:**
- Produces: `CriticComment.guest?: boolean` set true when the markup carries `guest="true"`.

- [ ] **Step 1: Write the failing test**

```ts
// in an existing critic-markup test (node or jsdom is fine — pure string parse)
it("parses guest=\"true\" into CriticComment.guest", () => {
  const comments = parseCriticComments('{==x==}{>>hi<<}{id="c1" by="Jane" at="t" guest="true"}');
  expect(comments[0].guest).toBe(true);
});
```
(Use the project's actual parse export — find it with `grep -n "export function parse" app/src/critic-markup/index.ts`; wire the test to that name.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run app/src/critic-markup` → FAIL.

- [ ] **Step 3: Implement** — add `guest?: boolean` to `CriticComment` in `comment-threads.ts`, and in each metadata-parse return object in `index.ts` add: `guest: fields.get("guest") === "true",`.

- [ ] **Step 4: Run tests** — `npx vitest run app/src/critic-markup` → PASS. Existing critic-markup tests stay green.

- [ ] **Step 5: Commit**

```bash
git add app/src/critic-markup/
git commit -m "feat(app): parse guest=\"true\" attribution on comments"
```

---

## Task 8: wire guest add/reply into the public read-only rail

**Files:**
- Modify: `app/src/DocumentWorkspace.tsx` (the `readOnly = backend?.info.kind === "public"` path, ~line 331, and the rail render ~lines 1083-1205)

**Interfaces:**
- Consumes: `PublicBackend.addComment` (Task 6), `getGuestName`/`setGuestName` (Task 6), `CriticComment.guest` (Task 7).

This task has no new pure unit; it is integration wiring verified by build + a render test. Keep changes minimal and behind the existing `readOnly` (public) branch so logged-in editing is untouched.

- [ ] **Step 1: Read the rail integration points**

Run: `grep -n "readOnly\|effectiveInteractionMode\|Rail\|onCommentRailPresenceChange\|documentPage" app/src/DocumentWorkspace.tsx`
Understand how the rail receives comments and how `readOnly` currently disables interaction.

- [ ] **Step 2: Add guest comment affordances** in the `readOnly` (public) branch only:
  - When the loaded public doc has `comments` enabled (the rail already shows existing threads because CriticMarkup is now present), render an **"Add comment"** action on a text selection and a **"Reply"** action per thread.
  - On submit: if `getGuestName()` is empty, prompt for a name (inline input) and `setGuestName(...)`; then call `backend.addComment({ mode, text, authorName, anchor|parentId })`. On resolve, replace `documentPage` with the returned refreshed doc so the rail re-renders. On reject, show the thrown message.
  - The selection→anchor maps to `{ quote: selectedText, occurrence: nthMatchInBody(selectedText) }`. Compute `occurrence` by counting matches of `selectedText` in the doc body up to the selection offset.
  - Render guest comments as `"<name> (guest)"` using `CriticComment.guest`.

- [ ] **Step 3: Guard logged-in path** — confirm none of the above renders when `!readOnly`; the editor's own comment flow is unchanged.

- [ ] **Step 4: Verify**

Run (from `app/`): `npx tsc -b && npx vitest run && npx biome check .`
Expected: typecheck clean, full suite PASS, 0 lint errors. Add/adjust a DocumentWorkspace render test if one exists for the public path; otherwise verify manually in Step 5.

- [ ] **Step 5: Manual smoke** — `VITE_GITHUB_MODE=1 npm run dev`, open a `public:true`+`comments:true` doc URL without a session, confirm: existing comments visible, add-comment + reply post and refresh, name prompt appears once.

- [ ] **Step 6: Commit**

```bash
git add app/src/DocumentWorkspace.tsx
git commit -m "feat(app): guest add/reply comments in the public read-only rail"
```

---

## Task 9: Share **Comments** toggle + rate-limit docs

**Files:**
- Modify: `app/src/SharePopover.tsx` (+ `app/src/SharePopover.test.tsx`)
- Modify: `docs/deploy-cloudflare.md`

**Interfaces:**
- Consumes: existing `getSharingFlags` / `onSetPublic` pattern; add a parallel `onSetComments`.

- [ ] **Step 1: Write the failing test** (extend `SharePopover.test.tsx`)

```tsx
it("shows a Comments toggle, disabled until Public is on, and calls onSetComments", async () => {
  const onSetComments = vi.fn(async () => {});
  render(<SharePopover canEdit shareUrl="u" content={"---\npublic: true\n---\n"} onSetPublic={async () => {}} onSetComments={onSetComments} />);
  // open popover (reuse existing test's trigger pattern), then:
  const toggle = await screen.findByTestId("share-comments-toggle");
  expect(toggle).not.toBeDisabled();
  fireEvent.click(toggle);
  expect(onSetComments).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/SharePopover.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — add `onSetComments: (next: boolean) => Promise<void>` to `SharePopoverProps`; read `comments` via `getSharingFlags(content).comments`; render a second checkbox `data-testid="share-comments-toggle"` disabled when `!isPublic || !canEdit || busy`, with label "Comments — anyone with the link can comment" and the warning "Turns the existing comment threads public." Wire its `onChange` to `onSetComments`. In the parent (where `SharePopover` is used and `onSetPublic` is defined), add a sibling `onSetComments` that sets the `comments` frontmatter key via the existing `setSharingFlags`/commit path used by `onSetPublic`.

- [ ] **Step 4: Document the rate-limit rule** — append to `docs/deploy-cloudflare.md` under the Phase 1A secrets section:

```markdown
### Public comments (Phase 2) — rate limit

The guest comment endpoint `POST /api/public/comment` is anonymous. Add a Cloudflare
**Rate limiting rule** (dashboard → the `marginsmd` project's zone → Security → WAF →
Rate limiting rules):
- **If** URI Path equals `/api/public/comment` **and** method is `POST`
- **Then** when more than **5 requests per 1 minute** per client IP → **Block** for 1 minute.

No code or secrets needed; the endpoint itself enforces max length (2000) and a required
name. Tune the threshold to taste.
```

- [ ] **Step 5: Run tests + lint** — `npx vitest run src/SharePopover.test.tsx && npx biome check src/SharePopover.tsx` → PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/SharePopover.tsx app/src/SharePopover.test.tsx docs/deploy-cloudflare.md
git commit -m "feat(app): Share Comments toggle + document CF rate-limit rule"
```

---

## Final verification (after all tasks)

- [ ] From `app/`: `npx biome check . && npx tsc -b && npx vitest run --coverage` → 0 lint errors, typecheck clean, all tests pass, coverage thresholds met.
- [ ] Confirm on Node 20: `nvm use 20 && npx vitest run` (CI parity).
- [ ] Push branch `feat/public-comments-phase2`, open a PR, wait for green CI. Do **not** merge/deploy without explicit approval. Setting the Cloudflare rate-limit rule is a dashboard step the operator does at deploy time.

## Self-review notes (spec coverage)

- Read side (serve CriticMarkup on `comments:true`) → Task 3.
- Insertion boundary (new + reply, framework-free) → Tasks 1-2.
- Gated write path (re-gate, validate, insert, bot-commit, retry-once) → Task 4; Function → Task 5.
- Client add/reply + guest identity → Tasks 6, 8; guest attribution parse/render → Task 7.
- Share Comments toggle → Task 9; abuse guard (CF rule + max-length/validation) → Tasks 4 & 9.
- Error table (400/403/404/409/429/200) → enforced in Task 4, asserted in its tests.
