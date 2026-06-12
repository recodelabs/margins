# New Markdown File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create a new blank `.md` file in the current folder of a GitHub repo from the margins picker, committing it to GitHub immediately and opening it for editing.

**Architecture:** A `+ New file` button in `GitHubPicker.tsx` opens a small dialog that prompts for a filename. On submit it calls a new `GitHubBackend.createMarkdownFile()` — a Contents-API `PUT` with **no `sha`** (which GitHub treats as a create) and a `Create <path>` commit message — then SPA-navigates into the existing `DocumentWorkspace`, where all further edits use the normal manual-commit flow.

**Tech Stack:** React + TypeScript, Vite, Vitest (run via `npm test` in `app/`), Biome lint, GitHub Contents REST API. All commands run from the `app/` directory.

---

## File Structure

- **Create** `app/src/new-file-name.ts` — pure, React-free filename validation helper.
- **Create** `app/src/new-file-name.test.ts` — unit tests for the helper.
- **Modify** `app/src/storage.ts` — add `createFile` capability + `createMarkdownFile` to the `StorageBackend` interface.
- **Modify** `app/src/github-backend.ts` — implement `createMarkdownFile`; set `capabilities.createFile = true`.
- **Modify** `app/src/github-backend.test.ts` — tests for `createMarkdownFile`.
- **Modify** `app/src/local-storage-backend.ts`, `app/src/preview-backend.ts`, `app/src/remote-backend.ts`, `app/src/api-backend.ts` — `createFile: false` + rejecting `createMarkdownFile` stub.
- **Modify** `app/src/GitHubPicker.tsx` — the button + dialog wiring.
- **Modify** `app/src/GitHubPicker.test.tsx` — button-visibility + create-PUT test.

All work happens on the existing branch `feat/new-markdown-file`.

---

## Task 1: Filename validation helper

**Files:**
- Create: `app/src/new-file-name.ts`
- Test: `app/src/new-file-name.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/new-file-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateNewFileName } from "./new-file-name";

describe("validateNewFileName", () => {
  it("accepts a fresh .md name", () => {
    expect(validateNewFileName("notes.md", [])).toEqual({ ok: true });
  });

  it("rejects an empty name", () => {
    const r = validateNewFileName("   ", []);
    expect(r.ok).toBe(false);
  });

  it("rejects a name without a .md extension", () => {
    const r = validateNewFileName("notes.txt", []);
    expect(r).toEqual({ ok: false, error: "File name must end in .md" });
  });

  it("rejects a name containing a slash", () => {
    const r = validateNewFileName("sub/notes.md", []);
    expect(r).toEqual({ ok: false, error: "File name can't contain '/'" });
  });

  it("rejects a name that already exists (case-insensitive)", () => {
    const r = validateNewFileName("Notes.md", ["notes.md"]);
    expect(r).toEqual({
      ok: false,
      error: "A file with that name already exists here",
    });
  });

  it("accepts .MD uppercase extension", () => {
    expect(validateNewFileName("README.MD", [])).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/new-file-name.test.ts`
Expected: FAIL — cannot find module `./new-file-name`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/new-file-name.ts`:

```ts
export type NameValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validates a proposed new markdown file name for the current folder.
 * Pure and React-free so it can be unit-tested and reused. `existingNamesInDir`
 * is the list of file names (not full paths) already present in the folder the
 * file would be created in.
 */
export function validateNewFileName(
  name: string,
  existingNamesInDir: string[],
): NameValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a file name" };
  if (trimmed.includes("/")) {
    return { ok: false, error: "File name can't contain '/'" };
  }
  if (!/\.md$/i.test(trimmed)) {
    return { ok: false, error: "File name must end in .md" };
  }
  const lower = trimmed.toLowerCase();
  if (existingNamesInDir.some((n) => n.toLowerCase() === lower)) {
    return { ok: false, error: "A file with that name already exists here" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/new-file-name.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/new-file-name.ts app/src/new-file-name.test.ts
git commit -m "feat: add new-file-name validation helper"
```

---

## Task 2: Backend interface — capability + create method

This task is type plumbing: extend the `StorageBackend` contract and satisfy it in the four non-GitHub backends with a rejecting stub. The GitHub implementation lands in Task 3. Verification is "the whole test suite still compiles and passes."

**Files:**
- Modify: `app/src/storage.ts`
- Modify: `app/src/local-storage-backend.ts`
- Modify: `app/src/preview-backend.ts`
- Modify: `app/src/remote-backend.ts`
- Modify: `app/src/api-backend.ts`

- [ ] **Step 1: Add the capability flag**

In `app/src/storage.ts`, inside `interface BackendCapabilities` (currently `documentPath`, `manualCommit`, `remoteSession`), add:

```ts
  /** Supports creating a brand-new markdown file via `createMarkdownFile`. */
  createFile: boolean;
```

- [ ] **Step 2: Add the method to the interface**

In `app/src/storage.ts`, inside `interface StorageBackend`, directly below the `saveMarkdownFile(...)` declaration, add:

```ts
  /**
   * Creates a new markdown file at `relativePath` with the given content and
   * commits it. Rejects if the path already exists. Present when
   * `capabilities.createFile`.
   */
  createMarkdownFile(relativePath: string, content: string): Promise<Page>;
```

- [ ] **Step 3: Add `createFile: false` + a rejecting stub to each non-GitHub backend**

In EACH of `app/src/local-storage-backend.ts`, `app/src/preview-backend.ts`, `app/src/remote-backend.ts`, `app/src/api-backend.ts`:

(a) Add `createFile: false,` to the `capabilities` object (which already lists `documentPath`, `manualCommit`, `remoteSession`).

(b) Add this method to the class (place it next to the existing `saveAsset` stub). `Page` is already imported via `./storage` in each of these files — if a file imports types selectively, ensure `Page` is in the import list:

```ts
  createMarkdownFile(_relativePath: string, _content: string): Promise<Page> {
    return Promise.reject(
      new Error("Creating new files is not supported in this backend"),
    );
  }
```

- [ ] **Step 4: Run the full suite to verify everything still compiles and passes**

Run: `cd app && npm test`
Expected: PASS — no type errors, all existing tests green. (If a backend file doesn't yet import `Page`, add it to that file's `import { ... } from "./storage";` line and re-run.)

- [ ] **Step 5: Commit**

```bash
git add app/src/storage.ts app/src/local-storage-backend.ts app/src/preview-backend.ts app/src/remote-backend.ts app/src/api-backend.ts
git commit -m "feat: add createMarkdownFile to StorageBackend interface + non-GitHub stubs"
```

---

## Task 3: GitHubBackend.createMarkdownFile

**Files:**
- Modify: `app/src/github-backend.ts`
- Test: `app/src/github-backend.test.ts`

- [ ] **Step 1: Write the failing tests**

In `app/src/github-backend.test.ts`, add these three cases inside the top-level `describe("GitHubBackend", ...)` block (the `backend()` and `b64()` helpers already exist in this file):

```ts
  it("createMarkdownFile PUTs base64 content with NO sha and a Create message", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: { sha: "new1" } }), {
          status: 201,
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const page = await backend().createMarkdownFile("docs/new.md", "# Untitled\n");

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: FAIL — `createMarkdownFile` is not a function on `GitHubBackend`.

- [ ] **Step 3: Implement the method and flip the capability**

In `app/src/github-backend.ts`:

(a) In the `capabilities` object, change `manualCommit: true,` block to also include the new flag — set `createFile: true,`. The object becomes:

```ts
  capabilities: BackendCapabilities = {
    documentPath: false,
    manualCommit: true,
    remoteSession: false,
    createFile: true,
  };
```

(b) Add this method directly below the existing `saveMarkdownFile` method:

```ts
  async createMarkdownFile(
    relativePath: string,
    content: string,
  ): Promise<Page> {
    if (!/\.md$/i.test(relativePath)) {
      throw new Error("Only markdown (.md) files can be created in margins");
    }
    const { owner, repo, branch } = this.cfg;
    const res = await githubFetch(
      `${API}/repos/${owner}/${repo}/contents/${relativePath}`,
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: `Create ${relativePath}`,
          content: encodeBase64(content),
          branch,
        }),
      },
    );
    // GitHub returns 422 when the path already exists (no sha supplied for an
    // existing file) — surface that as a friendly collision error.
    if (res.status === 422) {
      throw new Error(`A file named "${relativePath}" already exists`);
    }
    if (!res.ok) throw new Error(`GitHub create failed (${res.status})`);
    const json = (await res.json()) as { content: { sha: string } };
    invalidateCachedUrl(this.contentsUrl(relativePath));
    return {
      id: pageId(relativePath),
      title: titleFromContent(
        content,
        relativePath.split("/").at(-1) || relativePath,
      ),
      content,
      version: json.content.sha,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: PASS — all existing GitHub tests plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add app/src/github-backend.ts app/src/github-backend.test.ts
git commit -m "feat: GitHubBackend.createMarkdownFile (PUT without sha, Create message)"
```

---

## Task 4: Picker — "New file" button + dialog

**Files:**
- Modify: `app/src/GitHubPicker.tsx`
- Test: `app/src/GitHubPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

In `app/src/GitHubPicker.test.tsx`, add this `describe` block at the end of the file (the helpers `typeInto`, `container`, `root`, and the `act`/timer setup already exist at the top of this file):

```tsx
describe("GitHubPicker new-file creation", () => {
  async function loadRepo(treePaths: string[]) {
    const treeMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tree: treePaths.map((p) => ({ path: p, type: "blob" })),
          }),
          { status: 200 },
        ),
    );
    global.fetch = treeMock as unknown as typeof fetch;

    vi.useFakeTimers();
    await act(async () => {
      root.render(<GitHubPicker />);
    });
    const input = container.querySelector<HTMLInputElement>("#gh-repo-input");
    if (!input) throw new Error("repo input not found");
    await act(async () => {
      typeInto(input, "own/repo");
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
  }

  function findButtonByText(text: string): HTMLButtonElement | null {
    const all = Array.from(document.querySelectorAll("button"));
    return (all.find((b) => b.textContent?.includes(text)) ??
      null) as HTMLButtonElement | null;
  }

  it("shows a New file button once a repo is loaded and creates a file via PUT", async () => {
    await loadRepo(["docs/existing.md"]);

    const newFileBtn = findButtonByText("New file");
    expect(newFileBtn).not.toBeNull();

    await act(async () => {
      newFileBtn?.click();
    });

    // Dialog renders in a portal on document.body.
    const nameInput = document.body.querySelector<HTMLInputElement>(
      "#new-file-name-input",
    );
    if (!nameInput) throw new Error("new-file name input not found");
    expect(nameInput.value).toBe("untitled.md");

    const putMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: { sha: "created1" } }), {
          status: 201,
        }),
    );
    global.fetch = putMock as unknown as typeof fetch;

    await act(async () => {
      typeInto(nameInput, "my-notes.md");
    });
    const createBtn = findButtonByText("Create file");
    await act(async () => {
      createBtn?.click();
    });

    expect(putMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/own/repo/contents/my-notes.md",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse(
      (putMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.sha).toBeUndefined();
    expect(body.message).toBe("Create my-notes.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/GitHubPicker.test.tsx`
Expected: FAIL — no "New file" button exists yet (`newFileBtn` is null).

- [ ] **Step 3: Add imports**

At the top of `app/src/GitHubPicker.tsx`:

(a) Add `Plus` to the existing `lucide-react` import:

```tsx
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  Plus,
} from "lucide-react";
```

(b) Add these new imports below the existing import block:

```tsx
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { validateNewFileName } from "./new-file-name";
```

- [ ] **Step 4: Add state, derived names, and the create handler**

In `GitHubPicker()`, directly below the existing `const [error, setError] = useState<string | null>(null);` line, add:

```tsx
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("untitled.md");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
```

Then, directly below the existing `const entries = allPaths ? getFolderContents(allPaths, currentDir) : [];` line (near the end, before the `return`), add:

```tsx
  const existingFileNames = entries
    .filter((e) => e.kind === "file")
    .map((e) => e.name);
  const nameCheck = validateNewFileName(newFileName, existingFileNames);

  const openNewFileDialog = () => {
    setNewFileName("untitled.md");
    setCreateError(null);
    setShowNewFile(true);
  };

  const handleCreateFile = async () => {
    const check = validateNewFileName(newFileName, existingFileNames);
    if (!check.ok) {
      setCreateError(check.error);
      return;
    }
    const [owner, name] = repo.split("/");
    if (!token || !owner || !name) return;
    setCreating(true);
    setCreateError(null);
    const backend = new GitHubBackend({
      token,
      owner,
      repo: name,
      branch: ref,
      login: "",
    });
    const newPath = currentDir
      ? `${currentDir}/${newFileName.trim()}`
      : newFileName.trim();
    try {
      await backend.createMarkdownFile(newPath, "# Untitled\n");
      setCreating(false);
      setShowNewFile(false);
      openFile(newPath);
    } catch (e) {
      setCreating(false);
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  };
```

- [ ] **Step 5: Add the button to the repo header**

In `app/src/GitHubPicker.tsx`, the repo header is the `div` with `className="mb-1 flex flex-wrap items-center gap-2"` containing the owner/repo span and the branch chip. Replace that opening `<div>` and its contents' wrapper so the button sits on the right. Change the header `div` to include the button as the last child — insert this block immediately AFTER the branch-chip `<span>...{ref}...</span>` and BEFORE that header `div`'s closing `</div>`:

```tsx
              <button
                type="button"
                onClick={openNewFileDialog}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New file
              </button>
```

(The `ml-auto` pushes it to the right edge of the flex header.)

- [ ] **Step 6: Add the dialog**

In `app/src/GitHubPicker.tsx`, add this dialog just before the final closing `</div>` of the outermost returned element (the `<div className="flex min-h-screen ...">` wrapper's closing tag). It is rendered unconditionally; visibility is controlled by `open`:

```tsx
        <Dialog open={showNewFile} onOpenChange={setShowNewFile}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New markdown file</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="new-file-name-input"
                className="text-xs font-medium text-stone-500 dark:text-stone-400"
              >
                File name {currentDir ? `in ${currentDir}/` : "in repo root"}
              </label>
              <input
                id="new-file-name-input"
                value={newFileName}
                onChange={(e) => {
                  setNewFileName(e.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nameCheck.ok && !creating) {
                    void handleCreateFile();
                  }
                }}
                placeholder="untitled.md"
                className="h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-950 dark:text-slate-50 outline-none focus:ring-2 focus:ring-slate-300/70 dark:focus:ring-slate-600/70 placeholder:text-stone-400"
                spellCheck={false}
                autoCapitalize="none"
                // biome-ignore lint/a11y/noAutofocus: focus the field when the dialog opens
                autoFocus
              />
              {!nameCheck.ok && newFileName.trim() ? (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {nameCheck.error}
                </p>
              ) : null}
              {createError ? (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {createError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={handleCreateFile}
                disabled={!nameCheck.ok || creating}
              >
                {creating ? "Creating…" : "Create file"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
```

- [ ] **Step 7: Run the picker test to verify it passes**

Run: `cd app && npx vitest run src/GitHubPicker.test.tsx`
Expected: PASS — button is found, dialog input pre-fills `untitled.md`, and the create PUT fires with no `sha` and a `Create my-notes.md` message.

- [ ] **Step 8: Commit**

```bash
git add app/src/GitHubPicker.tsx app/src/GitHubPicker.test.tsx
git commit -m "feat: + New file button + dialog in the GitHub picker"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS — entire suite green, including the new `new-file-name`, `github-backend`, and `GitHubPicker` cases.

- [ ] **Step 2: Run the linter**

Run: `cd app && npm run lint`
Expected: No errors. (If Biome reports formatting, run `npx biome check --write src` and re-run; commit any formatting fixes.)

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Run: `cd app && npm run dev`, open the app, sign in, load a repo, drill into a folder, click **+ New file**, enter a name, and confirm: the file is created on GitHub (a `Create <path>` commit appears), the editor opens on `# Untitled`, and editing then committing uses the normal "Commit changes" button.

- [ ] **Step 4: Final commit (if any formatting/cleanup changed files)**

```bash
git add -A
git commit -m "chore: lint/format pass for new-file feature" || echo "nothing to commit"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Entry point button (GitHub-only via `createFile` capability) → Task 4 (button) + Task 2/3 (capability).
- Prompt-for-name dialog, pre-filled `untitled.md`, `.md` enforced, no `/`, collision check → Task 1 (helper) + Task 4 (dialog wiring).
- Immediate commit with `Create <path>` message, no `sha` → Task 3.
- `# Untitled\n` initial content → Task 4 (`handleCreateFile`) + asserted in Task 3 test via base64.
- Hand off to existing manual-commit workspace → Task 4 calls `openFile(newPath)` (existing navigation); no new code needed.
- 422 collision / network errors surfaced inline → Task 3 (mapping) + Task 4 (`createError` display).
- Other backends get `createFile:false` + unsupported stub → Task 2.
- Tests mirroring existing patterns → Tasks 1, 3, 4.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `createMarkdownFile(relativePath, content): Promise<Page>` is identical in the interface (Task 2), the GitHub impl (Task 3), and the stubs (Task 2). `validateNewFileName(name, existingNamesInDir): NameValidationResult` is consistent across Task 1 definition and Task 4 usage. Capability key `createFile` consistent everywhere.
