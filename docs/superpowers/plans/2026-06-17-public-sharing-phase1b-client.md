# Public Sharing — Phase 1B: Client public view + Share toggle (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-out visitor opening a normal `…/owner/repo/path.md` link sees the doc **rendered read-only** when it's `public: true` (served by the Phase-1A `/api/public/doc` endpoint); and a logged-in user **with push access** gets a **Share** toggle that flips the doc's `public` frontmatter flag and commits it.

**Architecture:** A new read-only `PublicBackend` (mirrors `PreviewBackend`) fetches the Phase-1A endpoint and rejects writes. `detectBackend()` returns it in GitHub mode when there's no token but the URL names a markdown doc. `resolveAppView()` gains a `publicView` input so a token-less visitor lands on the read-only workspace (not the sign-in picker) when a public doc loaded. Read-only is enforced by forcing `interactionMode = "viewing"` (which already disables the editor, comment-add, and code editing). The Share UI is a Base-UI `Popover` gated on a new `getRepoPermission()` (`permissions.push`) check; toggling edits frontmatter via a new `sharing-frontmatter` helper and commits through the existing `saveMarkdownFile`.

**Tech Stack:** React 19 + TypeScript, Vite, vitest, Base UI (`@base-ui/react`), the `yaml` package, GitHub REST API.

**Depends on:** Phase 1A (branch `feat/public-sharing-phase1a` / PR #57) — the `GET /api/public/doc` endpoint. **Build this branch off `feat/public-sharing-phase1a`** (it calls that endpoint), not off `main`.

**Conventions:**
- New backend mirrors `app/src/preview-backend.ts` (read-only, in-memory shape) and implements `StorageBackend` from `app/src/storage.ts`.
- Tests run with `cd app && npm run test` (vitest), or a single file via `cd app && npx vitest run src/<file>.test.ts`. Mock `fetch` via `global.fetch = vi.fn(...)` + `afterEach` restore. React component tests use the existing Testing Library setup (see any `*.test.tsx` in `app/src`).
- Lint: `cd app && npm run lint` (Biome) — keep new files clean.

---

### Task 1: Widen `BackendInfo.kind` for a public backend

**Files:**
- Modify: `app/src/storage.ts` (the `BackendInfo.kind` union, ~line 117)

- [ ] **Step 1: Read the current union**

Run: `sed -n '116,124p' app/src/storage.ts`
Expected: `kind: "local-files" | "local-storage" | "remote" | "github";`

- [ ] **Step 2: Add `"public"`**

Change that line to:

```typescript
  kind: "local-files" | "local-storage" | "remote" | "github" | "public";
```

- [ ] **Step 3: Type-check**

Run: `cd app && npx tsc -b`
Expected: no new errors (the union is only widened).

- [ ] **Step 4: Commit**

```bash
git add app/src/storage.ts
git commit -m "feat(storage): add 'public' to BackendInfo.kind for the read-only public backend"
```

---

### Task 2: `PublicBackend` — read-only backend over `/api/public/doc`

**Files:**
- Create: `app/src/public-backend.ts`
- Test: `app/src/public-backend.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
        new Response(JSON.stringify({ markdown: "# Hello\n", comments: false, suggestions: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = new PublicBackend({ owner: "o", repo: "r", path: "doc.md" });
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
    global.fetch = vi.fn(async () => new Response("Not found", { status: 404 })) as never;
    const backend = new PublicBackend({ owner: "o", repo: "r", path: "doc.md" });
    await expect(backend.getMarkdownFile("doc.md")).rejects.toBeInstanceOf(PublicDocNotFoundError);
  });

  it("is read-only: saving rejects", async () => {
    const backend = new PublicBackend({ owner: "o", repo: "r", path: "doc.md" });
    await expect(backend.saveMarkdownFile("doc.md", "x")).rejects.toThrow(/read-only/i);
  });

  it("reports a public, no-write capability set", () => {
    const backend = new PublicBackend({ owner: "o", repo: "r", path: "doc.md" });
    expect(backend.info.kind).toBe("public");
    expect(backend.capabilities.manualCommit).toBe(false);
    expect(backend.capabilities.createFile).toBe(false);
    expect(backend.capabilities.activityLog).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/public-backend.test.ts`
Expected: FAIL — cannot find module `./public-backend`.

- [ ] **Step 3: Implement**

```typescript
import type { ActivityEntry } from "./activity-log";
import { titleFromContent } from "./markdown";
import type {
  BackendCapabilities,
  BackendInfo,
  Page,
  StorageBackend,
  StoredAsset,
} from "./storage";

export interface PublicBackendConfig {
  owner: string;
  repo: string;
  path: string;
}

/** Thrown when the public endpoint reports the doc isn't public/available (404). */
export class PublicDocNotFoundError extends Error {
  constructor() {
    super("This document is not publicly shared.");
    this.name = "PublicDocNotFoundError";
  }
}

const READ_ONLY = "This document is read-only (public view).";

/**
 * Read-only backend for logged-out visitors. Fetches a single doc from the
 * Phase-1A `/api/public/doc` endpoint (which serves only `public: true` files,
 * comment-stripped). Every write rejects.
 */
export class PublicBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "public",
    label: "Public",
    detail: "Read-only",
  };
  capabilities: BackendCapabilities = {
    documentPath: false,
    manualCommit: false,
    remoteSession: false,
    createFile: false,
    activityLog: false,
  };
  canManageProjects = false;

  private cfg: PublicBackendConfig;

  constructor(cfg: PublicBackendConfig) {
    this.cfg = cfg;
  }

  async getMarkdownFile(_relativePath: string): Promise<Page> {
    const { owner, repo, path } = this.cfg;
    const url = `/api/public/doc?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url);
    if (res.status === 404) throw new PublicDocNotFoundError();
    if (!res.ok) throw new Error(`Public document load failed (${res.status})`);
    const body = (await res.json()) as { markdown: string };
    return {
      id: path,
      title: titleFromContent(body.markdown, path.split("/").at(-1) || path),
      content: body.markdown,
    };
  }

  saveMarkdownFile(): Promise<Page> {
    return Promise.reject(new Error(READ_ONLY));
  }
  createMarkdownFile(): Promise<Page> {
    return Promise.reject(new Error(READ_ONLY));
  }
  readActivityLog(_docPath: string): Promise<ActivityEntry[]> {
    return Promise.resolve([]);
  }
  appendActivityEntry(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY));
  }
  saveAsset(_file: File): Promise<StoredAsset> {
    return Promise.reject(new Error(READ_ONLY));
  }
  resolveFileUrl(_path: string): string | null {
    return null;
  }
  async openProject(_path: string): Promise<void> {
    return;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/public-backend.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint + commit**

```bash
cd app && npm run lint
git add app/src/public-backend.ts app/src/public-backend.test.ts
git commit -m "feat(app): read-only PublicBackend over /api/public/doc"
```

---

### Task 3: `detectBackend()` returns `PublicBackend` for token-less public reads

**Files:**
- Modify: `app/src/detect-backend.ts` (the `VITE_GITHUB_MODE` branch, ~lines 21–35)
- Test: `app/src/detect-backend.test.ts` (add a case)

- [ ] **Step 1: Write the failing test**

Add to `app/src/detect-backend.test.ts` (read the file first to match its existing mock setup for `import.meta.env`, `completeLoginFromUrl`, and `parseGitHubLocation`; follow whatever pattern is already there). The new case:

```typescript
it("returns a read-only PublicBackend in GitHub mode when there is no token but the URL names a markdown doc", async () => {
  // GITHUB_MODE on; completeLoginFromUrl resolves null (no token);
  // parseGitHubLocation resolves { owner: "o", repo: "r", branch: "main", path: "doc.md" }.
  // (Match the existing test's mocking mechanism for these.)
  const backend = await detectBackend();
  expect(backend.info.kind).toBe("public");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/detect-backend.test.ts`
Expected: FAIL — current code falls through to `LocalStorageBackend` (kind `local-storage`).

- [ ] **Step 3: Implement**

In `app/src/detect-backend.ts`, add the import:

```typescript
import { PublicBackend } from "./public-backend";
```

Then, inside the `if (import.meta.env.VITE_GITHUB_MODE === "1") { … }` block, replace the trailing comment fall-through with a public fallback. The block becomes:

```typescript
  if (import.meta.env.VITE_GITHUB_MODE === "1") {
    const token = await completeLoginFromUrl();
    const loc = parseGitHubLocation();
    if (token && loc.owner && loc.repo) {
      const login = await fetchLogin(token).catch(() => "user");
      return new GitHubBackend({
        token,
        owner: loc.owner,
        repo: loc.repo,
        branch: loc.branch,
        login,
      });
    }
    // No token but the URL names a markdown doc → try the public read path.
    // PublicBackend.getMarkdownFile 404s (caught by App) if it isn't shared.
    if (!token && loc.owner && loc.repo && /\.md$/i.test(loc.path)) {
      return new PublicBackend({ owner: loc.owner, repo: loc.repo, path: loc.path });
    }
    // Otherwise fall through; the picker handles sign-in.
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/detect-backend.test.ts`
Expected: PASS (new case + existing cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/detect-backend.ts app/src/detect-backend.test.ts
git commit -m "feat(app): detectBackend returns PublicBackend for token-less public doc URLs"
```

---

### Task 4: `resolveAppView` — allow the workspace for a loaded public doc

**Files:**
- Modify: `app/src/app-view.ts` (`AppViewParams` + `resolveAppView`)
- Test: `app/src/app-view.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `app/src/app-view.test.ts` (match the existing param-object shape used by other cases; set the new `publicView` field):

```typescript
it("renders the workspace for a token-less visitor when a public doc has loaded", () => {
  expect(
    resolveAppView({
      loading: false,
      isRoughdraftFlavoredMarkdownRoute: false,
      isPreviewRoute: false,
      gitHubMode: true,
      hasToken: false,
      publicView: true,
      githubLocation: { owner: "o", repo: "r", path: "doc.md" },
      loadError: null,
      rawPath: null,
    }),
  ).toBe("document-workspace");
});

it("still shows the picker for a token-less visitor when no public doc loaded", () => {
  expect(
    resolveAppView({
      loading: false,
      isRoughdraftFlavoredMarkdownRoute: false,
      isPreviewRoute: false,
      gitHubMode: true,
      hasToken: false,
      publicView: false,
      githubLocation: { owner: "o", repo: "r", path: "doc.md" },
      loadError: null,
      rawPath: null,
    }),
  ).toBe("github-picker");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/app-view.test.ts`
Expected: FAIL — `publicView` not a known param; the token-less case returns `github-picker`.

- [ ] **Step 3: Implement**

In `app/src/app-view.ts`, add `publicView` to `AppViewParams`:

```typescript
  /** Whether a public (read-only) doc has loaded for a logged-out visitor. */
  publicView: boolean;
```

And change the GitHub-mode gate so a loaded public doc bypasses the sign-in requirement:

```typescript
  if (params.gitHubMode) {
    const { owner, repo, path } = params.githubLocation;
    const validDocUrl = Boolean(owner) && Boolean(repo) && isMarkdownPath(path);
    if (!validDocUrl) return "github-picker";
    if (!params.hasToken && !params.publicView) return "github-picker";
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/app-view.test.ts`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/app-view.ts app/src/app-view.test.ts
git commit -m "feat(app): resolveAppView allows the workspace for a loaded public doc"
```

---

### Task 5: Wire public view into `App.tsx`

Make the GitHub load flow set a `publicView` state: when the detected backend is the `PublicBackend`, a successful load shows the read-only workspace; a `PublicDocNotFoundError` routes to the sign-in picker (not the generic load error).

**Files:**
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Add `publicView` state**

Near the other `useState` declarations in `App` (e.g. by `const [loadError, setLoadError] = useState…`), add:

```typescript
  const [publicView, setPublicView] = useState(false);
```

- [ ] **Step 2: Set it in the GitHub load flow**

In the `initializeGitHub` function (the `useEffect` reacting to `githubLocation`), after `await loadDocument(detectedBackend, path);` succeeds, set the flag from the backend kind:

```typescript
    setLoading(true);
    setLoadError(null);
    await loadDocument(detectedBackend, path);
    if (cancelled) return;
    setPublicView(detectedBackend.info.kind === "public");
    setLoading(false);
```

And at the top of `initializeGitHub`, in the early-return for a non-doc URL, clear it (`setPublicView(false);` alongside the existing `setActiveDocumentPath(null)` / `setDocumentPage(null)`).

- [ ] **Step 3: Route a public 404 to the picker, not load-error**

Import the error at the top of `App.tsx`:

```typescript
import { PublicDocNotFoundError } from "./public-backend";
```

In the `initialize` function's `catch (error) {` block, before the existing `handleSessionExpiry`/load-error handling, add:

```typescript
      if (error instanceof PublicDocNotFoundError) {
        // Not shared (or private): drop to the sign-in picker so the visitor
        // can authenticate to view a private doc.
        setPublicView(false);
        setActiveDocumentPath(null);
        setDocumentPage(null);
        setLoadError(null);
        setLoading(false);
        return;
      }
```

- [ ] **Step 4: Pass `publicView` to `resolveAppView`**

In the `resolveAppView({ … })` call (~line 758), add the field:

```typescript
    hasToken: !!getStoredToken(),
    publicView,
```

- [ ] **Step 5: Verify the app still builds and tests pass**

Run: `cd app && npx tsc -b && npm run test`
Expected: build clean; suite passes (no regressions). Manually reason: a logged-in user is unaffected (`publicView` stays false; `GitHubBackend` kind is `github`).

- [ ] **Step 6: Commit**

```bash
git add app/src/App.tsx
git commit -m "feat(app): wire public read-only view (publicView state, 404→picker)"
```

---

### Task 6: Enforce read-only in `DocumentWorkspace`

When the active backend is read-only (`info.kind === "public"`), force `interactionMode` to `"viewing"` (which already makes the editor non-editable and disables comment-add and code editing — `PageCard.tsx:1019`) and hide the interaction-mode `Select` and the agent/comments toggles so a visitor can't try to edit.

**Files:**
- Modify: `app/src/DocumentWorkspace.tsx`

- [ ] **Step 1: Derive a read-only flag**

Near where `manualCommit` / `backend` are used in `DocumentWorkspace`, add:

```typescript
  const readOnly = backend?.info.kind === "public";
```

- [ ] **Step 2: Force viewing mode when read-only**

Where `documentInteractionMode` is established/managed (the state passed to `PageCard interactionMode={documentInteractionMode}`), compute the effective mode:

```typescript
  const effectiveInteractionMode = readOnly ? "viewing" : documentInteractionMode;
```

Pass `effectiveInteractionMode` to `PageCard` (`interactionMode={effectiveInteractionMode}`) instead of `documentInteractionMode`.

- [ ] **Step 3: Hide edit controls when read-only**

Wrap the right-side control cluster (the `<div className="ml-auto inline-flex …">` containing the agent-box toggle, comments toggle, and the interaction-mode `<Select>`) so it only renders when `!readOnly`:

```tsx
  {readOnly ? (
    <span className="ml-auto font-mono text-[0.7rem] text-stone-400 dark:text-stone-500">
      Public · read-only
    </span>
  ) : (
    <div className="ml-auto inline-flex h-[1.5rem] shrink-0 items-center gap-1">
      {/* …existing agent-box toggle, comments toggle, interaction-mode Select… */}
    </div>
  )}
```

(The commit button is already hidden because `manualCommit` is `false` for `PublicBackend`.)

- [ ] **Step 4: Verify**

Run: `cd app && npx tsc -b && npm run test`
Expected: build clean, suite passes. If a `DocumentWorkspace` test exists, add/extend one asserting that with a `public`-kind backend the mode Select is not rendered (test id `document-mode-trigger` absent) and `PageCard` gets `interactionMode="viewing"`. If no such harness exists, note it and rely on the App-level behavior.

- [ ] **Step 5: Commit**

```bash
git add app/src/DocumentWorkspace.tsx
git commit -m "feat(app): enforce read-only (viewing mode, hidden edit controls) for public backend"
```

---

### Task 7: `getRepoPermission()` on `GitHubBackend` (push access)

**Files:**
- Modify: `app/src/github-backend.ts`
- Test: `app/src/github-backend.test.ts` (add a case; follow the existing fetch-mock pattern in that file)

- [ ] **Step 1: Write the failing test**

Add to `app/src/github-backend.test.ts`:

```typescript
it("getRepoPermission returns true when the repo reports push access", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ permissions: { push: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  const backend = new GitHubBackend({ token: "t", owner: "o", repo: "r", branch: "main", login: "u" });
  expect(await backend.getRepoPermission()).toBe(true);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/repos/o/r");
});

it("getRepoPermission returns false when push is absent or the call fails", async () => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ permissions: { push: false } }), { status: 200 })) as never;
  const backend = new GitHubBackend({ token: "t", owner: "o", repo: "r", branch: "main", login: "u" });
  expect(await backend.getRepoPermission()).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: FAIL — `getRepoPermission` not a function.

- [ ] **Step 3: Implement**

Add this method to the `GitHubBackend` class (uses the existing `API` constant, `this.cfg`, and `this.headers()`):

```typescript
  /**
   * Whether the signed-in user has push (write) access to the repo, read from
   * `GET /repos/{owner}/{repo}`'s `permissions.push`. Returns false on any error
   * (fail safe: hide edit controls rather than offer a commit that 403s).
   */
  async getRepoPermission(): Promise<boolean> {
    const { owner, repo } = this.cfg;
    try {
      const res = await fetch(`${API}/repos/${owner}/${repo}`, {
        headers: this.headers(),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { permissions?: { push?: boolean } };
      return json.permissions?.push === true;
    } catch {
      return false;
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/github-backend.ts app/src/github-backend.test.ts
git commit -m "feat(app): GitHubBackend.getRepoPermission (push access) for Share gating"
```

---

### Task 8: `sharing-frontmatter` helper — read & set flags client-side

Client-side frontmatter read/write (the app *can* use `yaml` + `markdown.ts`, unlike the server). Reads the three flags for toggle state; sets one flag (preserving body + other keys) for the commit.

**Files:**
- Create: `app/src/sharing-frontmatter.ts`
- Test: `app/src/sharing-frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { getSharingFlags, setSharingFlag } from "./sharing-frontmatter";

describe("getSharingFlags", () => {
  it("defaults to all-false with no frontmatter", () => {
    expect(getSharingFlags("# Body\n")).toEqual({ public: false, comments: false, suggestions: false });
  });
  it("reads true flags", () => {
    expect(getSharingFlags("---\npublic: true\n---\n# Body\n").public).toBe(true);
  });
});

describe("setSharingFlag", () => {
  it("adds a frontmatter block when none exists", () => {
    const out = setSharingFlag("# Body\n", "public", true);
    expect(getSharingFlags(out).public).toBe(true);
    expect(out).toContain("# Body");
  });
  it("sets a key without disturbing other keys or the body", () => {
    const md = "---\nversion: 1\ntags: [a]\n---\n\n# Title\n\nText.\n";
    const out = setSharingFlag(md, "public", true);
    expect(getSharingFlags(out).public).toBe(true);
    expect(out).toContain("version: 1");
    expect(out).toContain("# Title");
    expect(out).toContain("Text.");
  });
  it("flips a flag false (removes/sets it) and round-trips", () => {
    const md = "---\npublic: true\n---\n# B\n";
    const off = setSharingFlag(md, "public", false);
    expect(getSharingFlags(off).public).toBe(false);
    const on = setSharingFlag(off, "public", true);
    expect(getSharingFlags(on).public).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/sharing-frontmatter.test.ts`
Expected: FAIL — cannot find module `./sharing-frontmatter`.

- [ ] **Step 3: Implement**

Uses `splitYamlFrontmatter` + `prependYamlFrontmatter` from `markdown.ts` and `yaml`. (First read `app/src/markdown.ts` to confirm those exports and the `frontmatter` string shape — it includes the `---` fences and a trailing blank line.)

```typescript
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { prependYamlFrontmatter, splitYamlFrontmatter } from "./markdown";

export type SharingFlagKey = "public" | "comments" | "suggestions";
export interface SharingFlags {
  public: boolean;
  comments: boolean;
  suggestions: boolean;
}

function parseFrontmatterObject(frontmatter: string | null): Record<string, unknown> {
  if (!frontmatter) return {};
  // Strip the leading `---\n` and trailing `---\n…` fences before YAML-parsing.
  const inner = frontmatter.replace(/^---[ \t]*\r?\n/, "").replace(/\r?\n---[ \t]*\r?\n?\s*$/, "\n");
  try {
    const parsed = parseYaml(inner);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getSharingFlags(markdown: string): SharingFlags {
  const { frontmatter } = splitYamlFrontmatter(markdown);
  const obj = parseFrontmatterObject(frontmatter);
  return {
    public: obj.public === true,
    comments: obj.comments === true,
    suggestions: obj.suggestions === true,
  };
}

/**
 * Set (or clear) one sharing flag, preserving the body and all other frontmatter
 * keys. `value === true` writes `key: true`; `value === false` removes the key
 * (absent ⇒ false is the documented default).
 */
export function setSharingFlag(markdown: string, key: SharingFlagKey, value: boolean): string {
  const { frontmatter, body } = splitYamlFrontmatter(markdown);
  const obj = parseFrontmatterObject(frontmatter);
  if (value) obj[key] = true;
  else delete obj[key];

  if (Object.keys(obj).length === 0) return body; // no keys left → no frontmatter block
  const yamlText = stringifyYaml(obj).replace(/\n$/, "");
  return prependYamlFrontmatter(body, `---\n${yamlText}\n---\n\n`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/sharing-frontmatter.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint + commit**

```bash
cd app && npm run lint
git add app/src/sharing-frontmatter.ts app/src/sharing-frontmatter.test.ts
git commit -m "feat(app): client-side sharing-frontmatter get/set helper"
```

---

### Task 9: Share popover (Public toggle + copy link)

A `SharePopover` component: shows the current `public` state from the doc content, lets a push-access user flip it (edits frontmatter, commits via `saveMarkdownFile`, reloads), and exposes a copy-link button. Rendered in the `DocumentWorkspace` toolbar for logged-in users (never in read-only/public view).

**Files:**
- Create: `app/src/SharePopover.tsx`
- Test: `app/src/SharePopover.test.tsx`
- Modify: `app/src/DocumentWorkspace.tsx` (render it in the toolbar)

- [ ] **Step 1: Write the failing component test**

(Follow the render/util pattern of an existing `*.test.tsx` in `app/src` — same testing-library imports and setup.)

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharePopover } from "./SharePopover";

afterEach(() => vi.restoreAllMocks());

const baseProps = {
  canEdit: true,
  shareUrl: "https://marginsmd.pages.dev/o/r/doc.md",
  content: "# Doc\n",
  onSetPublic: vi.fn(async () => {}),
};

describe("SharePopover", () => {
  it("shows the Public toggle reflecting the doc's current flag", async () => {
    render(<SharePopover {...baseProps} content={"---\npublic: true\n---\n# Doc\n"} />);
    fireEvent.click(screen.getByTestId("share-trigger"));
    const toggle = await screen.findByTestId("share-public-toggle");
    expect(toggle).toBeChecked();
  });

  it("calls onSetPublic(true) when toggled on", async () => {
    const onSetPublic = vi.fn(async () => {});
    render(<SharePopover {...baseProps} content={"# Doc\n"} onSetPublic={onSetPublic} />);
    fireEvent.click(screen.getByTestId("share-trigger"));
    fireEvent.click(await screen.findByTestId("share-public-toggle"));
    await waitFor(() => expect(onSetPublic).toHaveBeenCalledWith(true));
  });

  it("disables the toggle for users without edit access", async () => {
    render(<SharePopover {...baseProps} canEdit={false} />);
    fireEvent.click(screen.getByTestId("share-trigger"));
    expect(await screen.findByTestId("share-public-toggle")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/SharePopover.test.tsx`
Expected: FAIL — cannot find module `./SharePopover`.

- [ ] **Step 3: Implement**

Use the repo's `Popover`/`PopoverTrigger`/`PopoverContent` (`./components/ui/popover`) and `getSharingFlags` (Task 8). A native checkbox is fine (test ids drive the tests). Keep it small.

```tsx
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { getSharingFlags } from "./sharing-frontmatter";

export interface SharePopoverProps {
  canEdit: boolean;
  shareUrl: string;
  content: string;
  onSetPublic: (next: boolean) => Promise<void>;
}

export function SharePopover({ canEdit, shareUrl, content, onSetPublic }: SharePopoverProps) {
  const isPublic = getSharingFlags(content).public;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="share-trigger"
            className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 font-mono text-[0.7rem] text-stone-400 outline-none transition hover:bg-[#EEE9E1] hover:text-stone-600 dark:text-stone-500 dark:hover:bg-slate-800 dark:hover:text-stone-300"
            aria-label="Share document"
          >
            Share
          </button>
        }
      />
      <PopoverContent aria-label="Share options" className="w-72 p-3" align="end">
        <label className="flex items-center gap-2 text-[0.8rem] text-stone-700 dark:text-slate-200">
          <input
            type="checkbox"
            data-testid="share-public-toggle"
            checked={isPublic}
            disabled={!canEdit || busy}
            onChange={async (e) => {
              setBusy(true);
              try {
                await onSetPublic(e.target.checked);
              } finally {
                setBusy(false);
              }
            }}
          />
          <span>Public — anyone with the link can view</span>
        </label>
        {!canEdit ? (
          <p className="mt-2 text-[0.7rem] text-stone-400">You need write access to change this.</p>
        ) : null}
        {isPublic ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              data-testid="share-link"
              value={shareUrl}
              className="min-w-0 flex-1 truncate rounded border border-[#DCD6CC] bg-transparent px-2 py-1 text-[0.7rem] text-stone-600 dark:border-slate-700 dark:text-slate-300"
            />
            <button
              type="button"
              data-testid="share-copy"
              className="rounded px-2 py-1 text-[0.7rem] text-stone-500 hover:bg-[#EEE9E1] dark:hover:bg-slate-800"
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/SharePopover.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire into `DocumentWorkspace`**

In `DocumentWorkspace.tsx`, render `<SharePopover>` in the toolbar's right-side cluster (the `!readOnly` branch from Task 6), only for a GitHub backend. Compute its props in `App.tsx` (which owns `backend`, the doc content, and can call `getRepoPermission`) and pass them down, OR compute inside `DocumentWorkspace` if it already has `backend` + `documentPage`. Concretely:
- `canEdit`: call `backend.getRepoPermission()` once when a `github`-kind backend loads a doc (store in state, default false); only `GitHubBackend` has the method — guard with `backend.info.kind === "github"`.
- `shareUrl`: `\`${window.location.origin}/${owner}/${repo}/${path}\`` (+ `?branch=` when not `main`).
- `content`: the current document content.
- `onSetPublic`: `async (next) => { const updated = setSharingFlag(currentContent, "public", next); await backend.saveMarkdownFile(path, updated, version); reload the doc; }` — reuse the existing save + reload path (`handleSaveDocument` / `loadDocument`).

Add the `getRepoPermission` call + `canEdit` state in `App.tsx` after a successful GitHub load (guard on `info.kind === "github"`), and thread `canEdit` + a `onSetPublic` handler into `DocumentWorkspace` → `SharePopover`.

- [ ] **Step 6: Verify the whole app**

Run: `cd app && npx tsc -b && npm run test && npm run lint`
Expected: build clean, suite passes, lint clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/SharePopover.tsx app/src/SharePopover.test.tsx app/src/DocumentWorkspace.tsx app/src/App.tsx
git commit -m "feat(app): Share popover — public toggle + copy link, gated on push access"
```

---

### Task 10: Full suite + manual smoke

- [ ] **Step 1: Full suite + build + lint**

Run: `cd app && npx tsc -b && npm run test && npm run lint`
Expected: all green (lint: no new findings in added files).

- [ ] **Step 2: Manual smoke (after deploying this branch as a preview, with Phase-1A secrets set)**

- Logged **out**, open `…/owner/repo/<a public:true doc>.md` → renders read-only ("Public · read-only", no edit controls, no commit button).
- Logged **out**, open a private doc → sign-in picker (no content shown).
- Logged **in with push**, open a doc → **Share** appears; toggle Public on → commits frontmatter, copy-link shows; reopen logged-out to confirm it now renders.
- Logged **in without push** (a read-only collaborator) → Share toggle disabled, copy-link available if already public.

---

## Self-review notes (coverage against the spec, Phase-1B scope)

- **Logged-out view of a public doc, read-only, same URL (option A):** Tasks 2–6. ✓
- **404 → sign-in (private indistinguishable):** Task 5 (PublicDocNotFoundError → picker). ✓
- **Share UI: Public toggle + copy link, write-vs-read gating, install/permission via `permissions.push`:** Tasks 7–9. ✓
- **Flag edited by committing the file (GitHub enforces permission); frontmatter setter preserves body/other keys:** Task 8 + Task 9 wiring. ✓
- **Clean read (no internal comments):** inherited from Phase-1A (endpoint strips); the client renders whatever the endpoint returns. ✓
- **Out of scope (later phases):** the `comments`/`suggestions` toggles and guest commenting (Phase 2/3) — the helper supports the keys but the UI ships only the **Public** toggle here.
