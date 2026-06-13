# Live update & toast (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the SP2 runner commits a doc edit and appends its agent reply, the open margins document live-updates in place with a toast (and the instruction history flips to Done), never clobbering an in-flight edit or comment.

**Architecture:** A single GitHub poller on the doc's **activity log** is the live signal. `GitHubBackend.watchActivityLog` polls `readActivityLog` every ~10s; App diffs for newly-arrived agent replies and, for a `done` reply, either auto-applies the fresh doc + toasts (editor idle) or shows the existing conflict notice (editor busy). Reuses the existing `applyDocumentPage` / `DocumentDiskChangeState` machinery; adds a minimal `Toast` and a `composingComment` busy signal.

**Tech Stack:** React + TypeScript + Vite, Vitest (`cd app && npx vitest run <file>`), Biome (2-space, double quotes, trailing commas, run `npx biome check --write <files>` before committing). Builds with `npm run build` (tsc -b catches type errors vitest misses).

---

## Background the engineer needs

- **SP1 shipped the contract** (`app/src/activity-log.ts`): `ActivityEntry =
  UserInstructionEntry | AgentReplyEntry`. An `AgentReplyEntry` is
  `{ id, at, by, role:"agent", replyTo, status:"done"|"error", summary, commit?, error? }`.
  `buildConversation(entries)` derives per-instruction status.
- **The existing watch effect** (`App.tsx` ~518–574) already auto-applies a
  changed file when the editor is clean and shows a conflict notice when dirty —
  but it only runs if `backend.watchMarkdownFile` exists. **`GitHubBackend` does
  not implement `watchMarkdownFile`**, so hosted mode has no live update today.
  SP3 adds a parallel, activity-log-driven path for GitHub mode; it does not
  touch the existing effect.
- **`documentSession`** (`document-session.ts`) is created in `App` (`App.tsx:96`)
  and passed to `DocumentWorkspace`, which bridges editor facts back into it
  (e.g. `DocumentWorkspace.tsx:1135` `onDirtyStateChange={documentSession.setDirty}`).
  App reads `documentSession.getSnapshot()` for `dirty`/`saveState`. SP3 adds a
  `composingComment` field the same way.
- **GitHub `version` = the file blob sha** (`github-backend.ts` returns
  `version: json.content.sha`). The agent reply's `commit` is the **commit** sha
  (good for a "view commit" link, not for the version compare).
- **No toast component exists** — Task 3 adds a minimal one.
- Biome/`tsc` gotcha: run `npm run build` once at the end; `tsc -b` catches type
  errors esbuild-based vitest does not.

## File structure

| File | Responsibility |
|---|---|
| `src/activity-live.ts` (new) | Pure helpers: new-reply diff, change-check serialize, busy + action decision. |
| `src/activity-live.test.ts` (new) | Unit tests for the above. |
| `src/Toast.tsx` (new) | Minimal auto-dismissing toast component. |
| `src/Toast.test.tsx` (new) | Toast render/dismiss tests. |
| `src/document-session.ts` (modify) | Add `composingComment` to the snapshot + `setComposingComment`. |
| `src/document-session.test.ts` (modify or new) | Cover the new field. |
| `src/storage.ts` (modify) | Add optional `watchActivityLog?` + `commitUrl?` to the interface. |
| `src/github-backend.ts` (modify) | Implement `watchActivityLog` + `commitUrl`; `ACTIVITY_POLL_MS`. |
| `src/github-backend.test.ts` (modify) | Test `watchActivityLog` poll/change/unsubscribe. |
| `src/CommentEditorList.tsx` (modify) | Emit `onComposingChange(editingCommentIds.length > 0)`. |
| `src/PageCard.tsx` (modify) | Thread `onComposingCommentChange` (mirror `onDirtyStateChange`). |
| `src/DocumentWorkspace.tsx` (modify) | Wire `onComposingCommentChange={documentSession.setComposingComment}`; pass `liveActivityEntries` to `InstructionSender`. |
| `src/InstructionSender.tsx` (modify) | Prefer a `liveEntries` prop for the history thread. |
| `src/App.tsx` (modify) | Subscribe to `watchActivityLog`; apply-or-conflict + toast; hold `liveActivityEntries`; render `<Toast>`. |

**Run a single test file:** `cd app && npx vitest run src/<file>.test.tsx`
**Full app suite:** `cd app && npx vitest run`

---

### Task 1: Pure live-update helpers (`src/activity-live.ts`)

**Files:**
- Create: `app/src/activity-live.ts`
- Test: `app/src/activity-live.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/activity-live.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity-log";
import {
  editorBusy,
  findNewAgentReplies,
  liveUpdateActionFor,
  serializeForChangeCheck,
} from "./activity-live";

const userEntry = (id: string): ActivityEntry => ({
  id,
  at: "t",
  by: "u",
  role: "user",
  type: "custom",
  instruction: "x",
});
const agentEntry = (
  id: string,
  replyTo: string,
  status: "done" | "error" = "done",
  commit?: string,
): ActivityEntry => ({
  id,
  at: "t",
  by: "agent",
  role: "agent",
  replyTo,
  status,
  summary: "did it",
  ...(commit ? { commit } : {}),
});

describe("findNewAgentReplies", () => {
  it("returns agent replies present in next but not prev", () => {
    const prev = [userEntry("i1")];
    const next = [userEntry("i1"), agentEntry("a1", "i1")];
    expect(findNewAgentReplies(prev, next).map((r) => r.id)).toEqual(["a1"]);
  });

  it("ignores already-seen replies and user entries", () => {
    const prev = [userEntry("i1"), agentEntry("a1", "i1")];
    const next = [userEntry("i1"), agentEntry("a1", "i1"), userEntry("i2")];
    expect(findNewAgentReplies(prev, next)).toEqual([]);
  });

  it("returns multiple new replies", () => {
    const prev: ActivityEntry[] = [];
    const next = [agentEntry("a1", "i1"), agentEntry("a2", "i2")];
    expect(findNewAgentReplies(prev, next).map((r) => r.id)).toEqual([
      "a1",
      "a2",
    ]);
  });
});

describe("serializeForChangeCheck", () => {
  it("is stable for the same entries and changes when a reply is appended", () => {
    const a = [userEntry("i1")];
    const b = [userEntry("i1")];
    const c = [userEntry("i1"), agentEntry("a1", "i1")];
    expect(serializeForChangeCheck(a)).toBe(serializeForChangeCheck(b));
    expect(serializeForChangeCheck(a)).not.toBe(serializeForChangeCheck(c));
  });
});

describe("editorBusy", () => {
  it("is false only when clean, saved and not composing", () => {
    expect(
      editorBusy({ dirty: false, saveState: "saved", composingComment: false }),
    ).toBe(false);
    expect(
      editorBusy({ dirty: true, saveState: "saved", composingComment: false }),
    ).toBe(true);
    expect(
      editorBusy({ dirty: false, saveState: "saving", composingComment: false }),
    ).toBe(true);
    expect(
      editorBusy({ dirty: false, saveState: "saved", composingComment: true }),
    ).toBe(true);
  });
});

describe("liveUpdateActionFor", () => {
  it("applies a done reply with a commit when idle", () => {
    expect(liveUpdateActionFor(agentEntry("a1", "i1", "done", "sha"), false)).toBe(
      "apply",
    );
  });
  it("conflicts a done reply when busy", () => {
    expect(liveUpdateActionFor(agentEntry("a1", "i1", "done", "sha"), true)).toBe(
      "conflict",
    );
  });
  it("does nothing for an error reply", () => {
    expect(liveUpdateActionFor(agentEntry("a1", "i1", "error"), false)).toBe(
      "none",
    );
  });
  it("does nothing for a done reply with no commit", () => {
    expect(liveUpdateActionFor(agentEntry("a1", "i1", "done"), false)).toBe(
      "none",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/activity-live.test.ts`
Expected: FAIL — cannot resolve `./activity-live`.

- [ ] **Step 3: Implement**

Create `app/src/activity-live.ts`:

```ts
import type { ActivityEntry, AgentReplyEntry } from "./activity-log";

/** Agent replies present in `next` but not in `prev` (matched by id). */
export function findNewAgentReplies(
  prev: ActivityEntry[],
  next: ActivityEntry[],
): AgentReplyEntry[] {
  const seen = new Set(
    prev.filter((e) => e.role === "agent").map((e) => e.id),
  );
  return next.filter(
    (e): e is AgentReplyEntry => e.role === "agent" && !seen.has(e.id),
  );
}

/** A cheap, stable signature so a poll only fires the callback on real change. */
export function serializeForChangeCheck(entries: ActivityEntry[]): string {
  return entries
    .map((e) => (e.role === "agent" ? `${e.id}:${e.status}` : e.id))
    .join("\n");
}

/** The editor is "busy" if the user might lose work to an auto-apply. */
export function editorBusy(s: {
  dirty: boolean;
  saveState: string;
  composingComment: boolean;
}): boolean {
  return s.dirty || s.saveState !== "saved" || s.composingComment;
}

export type LiveUpdateAction = "apply" | "conflict" | "none";

/** What a freshly-arrived agent reply should trigger, given editor busyness. */
export function liveUpdateActionFor(
  reply: AgentReplyEntry,
  busy: boolean,
): LiveUpdateAction {
  if (reply.status === "done" && reply.commit) {
    return busy ? "conflict" : "apply";
  }
  return "none";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/activity-live.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd app && npx biome check --write src/activity-live.ts src/activity-live.test.ts
cd /Users/claudius/github/roughneck
git add app/src/activity-live.ts app/src/activity-live.test.ts
git commit -m "feat(app): pure live-update helpers (new-reply diff, busy, action)"
```

---

### Task 2: `watchActivityLog` + `commitUrl` on GitHubBackend

**Files:**
- Modify: `app/src/storage.ts` (interface — add two optional methods)
- Modify: `app/src/github-backend.ts` (implement)
- Test: `app/src/github-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `app/src/github-backend.test.ts` (inside the existing `describe("GitHubBackend", …)` block):

```ts
  it("watchActivityLog polls, fires on change, and stops on unsubscribe", async () => {
    vi.useFakeTimers();
    const log1 =
      '{"id":"i1","at":"t","by":"u","role":"user","type":"custom","instruction":"x"}\n';
    const log2 =
      log1 +
      '{"id":"a1","at":"t","by":"agent","role":"agent","replyTo":"i1","status":"done","summary":"s","commit":"abc"}\n';
    const bodies = [log1, log1, log2];
    let call = 0;
    global.fetch = vi.fn(async () => {
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return new Response(
        JSON.stringify({ sha: `sha${call}`, content: b64(body), encoding: "base64" }),
        { status: 200 },
      );
    });

    const seen: number[] = [];
    const stop = backend().watchActivityLog("doc.md", (entries) => {
      seen.push(entries.length);
    });

    // Baseline tick (immediate) -> fires once with 1 entry.
    await vi.advanceTimersByTimeAsync(0);
    // Second poll: identical content -> no fire.
    await vi.advanceTimersByTimeAsync(10_000);
    // Third poll: the agent reply appears -> fires with 2 entries.
    await vi.advanceTimersByTimeAsync(10_000);

    stop();
    const callsAfterStop = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(callsAfterStop);

    expect(seen).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it("commitUrl points at the repo commit", () => {
    expect(backend().commitUrl("abc123")).toBe(
      "https://github.com/o/r/commit/abc123",
    );
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: FAIL — `watchActivityLog` / `commitUrl` not a function.

- [ ] **Step 3: Implement the interface additions**

In `app/src/storage.ts`, add to the `StorageBackend` interface (next to the
existing `watchMarkdownFile?` near line 162):

```ts
  /**
   * Poll the doc's activity log; fire `onChange` with the parsed entries
   * whenever the log changes. Present when `capabilities.activityLog`.
   */
  watchActivityLog?(
    docPath: string,
    onChange: (entries: ActivityEntry[]) => void,
  ): () => void;
  /** Absolute URL for a commit sha (for "view commit" links). */
  commitUrl?(sha: string): string;
```

(`ActivityEntry` is already imported in `storage.ts` for `readActivityLog`.)

- [ ] **Step 4: Implement on GitHubBackend**

In `app/src/github-backend.ts`:

1. Add the import (extend the existing import from `./activity-live` — create it
   if not present):

```ts
import { serializeForChangeCheck } from "./activity-live";
```

2. Add the poll-interval constant near the top (beside the other module
   constants, e.g. after `const API = "https://api.github.com";`):

```ts
const ACTIVITY_POLL_MS = 10_000;
```

3. Add the two methods to the `GitHubBackend` class (next to `readActivityLog`):

```ts
  watchActivityLog(
    docPath: string,
    onChange: (entries: ActivityEntry[]) => void,
  ): () => void {
    let disposed = false;
    let lastSig: string | null = null;

    const tick = async () => {
      try {
        const entries = await this.readActivityLog(docPath);
        if (disposed) return;
        const sig = serializeForChangeCheck(entries);
        if (sig !== lastSig) {
          lastSig = sig;
          onChange(entries);
        }
      } catch (error) {
        console.error("activity-log poll failed:", error);
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, ACTIVITY_POLL_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }

  commitUrl(sha: string): string {
    const { owner, repo } = this.cfg;
    return `https://github.com/${owner}/${repo}/commit/${sha}`;
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `cd app && npx vitest run src/github-backend.test.ts`
Expected: PASS (existing tests plus the two new ones).

- [ ] **Step 6: Lint + commit**

```bash
cd app && npx biome check --write src/storage.ts src/github-backend.ts src/github-backend.test.ts
cd /Users/claudius/github/roughneck
git add app/src/storage.ts app/src/github-backend.ts app/src/github-backend.test.ts
git commit -m "feat(app): GitHubBackend.watchActivityLog + commitUrl"
```

---

### Task 3: Minimal toast component (`src/Toast.tsx`)

**Files:**
- Create: `app/src/Toast.tsx`
- Test: `app/src/Toast.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/Toast.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Toast } from "./Toast";

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("renders the message and a commit link", () => {
    const { container, cleanup } = mount(
      <Toast message="Updated by the agent · did it" commitUrl="https://x/commit/abc" onDismiss={() => {}} />,
    );
    expect(container.textContent).toContain("Updated by the agent · did it");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://x/commit/abc");
    cleanup();
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    const { container, cleanup } = mount(
      <Toast message="hi" onDismiss={onDismiss} />,
    );
    const button = container.querySelector("button");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("auto-dismisses after durationMs", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { cleanup } = mount(
      <Toast message="hi" durationMs={6000} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/Toast.test.tsx`
Expected: FAIL — cannot resolve `./Toast`.

- [ ] **Step 3: Implement**

Create `app/src/Toast.tsx`:

```tsx
import { useEffect } from "react";

export interface ToastProps {
  message: string;
  commitUrl?: string;
  durationMs?: number;
  onDismiss: () => void;
}

export function Toast({
  message,
  commitUrl,
  durationMs = 6000,
  onDismiss,
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 shadow-lg"
    >
      <div className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
        {message}
        {commitUrl ? (
          <a
            href={commitUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-2 whitespace-nowrap underline"
          >
            view commit ↗
          </a>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-amber-700 hover:opacity-70 dark:text-amber-300"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/Toast.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd app && npx biome check --write src/Toast.tsx src/Toast.test.tsx
cd /Users/claudius/github/roughneck
git add app/src/Toast.tsx app/src/Toast.test.tsx
git commit -m "feat(app): minimal auto-dismissing Toast component"
```

---

### Task 4: `composingComment` in the document session store

**Files:**
- Modify: `app/src/document-session.ts`
- Test: `app/src/document-session.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or extend `app/src/document-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDocumentSessionStore } from "./document-session";

describe("document session: composingComment", () => {
  it("defaults to false", () => {
    expect(createDocumentSessionStore().getSnapshot().composingComment).toBe(
      false,
    );
  });

  it("setComposingComment updates the snapshot", () => {
    const store = createDocumentSessionStore();
    store.setComposingComment(true);
    expect(store.getSnapshot().composingComment).toBe(true);
  });

  it("reset clears composingComment", () => {
    const store = createDocumentSessionStore();
    store.setComposingComment(true);
    store.reset("new content");
    expect(store.getSnapshot().composingComment).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/document-session.test.ts`
Expected: FAIL — `composingComment` is `undefined` / `setComposingComment` not a function.

- [ ] **Step 3: Implement**

In `app/src/document-session.ts`:

1. Add the field to `DocumentSessionSnapshot`:

```ts
export interface DocumentSessionSnapshot {
  saveState: DocumentSaveState;
  dirty: boolean;
  draftContent: string | null;
  saveController: DocumentSaveController | null;
  composingComment: boolean;
}
```

2. Add the setter to `DocumentSessionStore`:

```ts
  setComposingComment: (composing: boolean) => void;
```

3. Initialise it in `createDocumentSessionStore`'s initial snapshot:

```ts
  let snapshot: DocumentSessionSnapshot = {
    saveState: "saved",
    dirty: false,
    draftContent: initialContent,
    saveController: null,
    composingComment: false,
  };
```

4. Add the setter implementation (next to `setDirty`):

```ts
    setComposingComment: (composingComment) => update({ composingComment }),
```

5. Clear it on `reset`:

```ts
    reset: (content) =>
      update({
        saveState: "saved",
        dirty: false,
        draftContent: content,
        composingComment: false,
      }),
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run src/document-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd app && npx biome check --write src/document-session.ts src/document-session.test.ts
cd /Users/claudius/github/roughneck
git add app/src/document-session.ts app/src/document-session.test.ts
git commit -m "feat(app): track composingComment in the document session"
```

---

### Task 5: Surface "a comment is being composed" up to the session

Mirror the existing `onDirtyStateChange` threading. The signal source is
`CommentEditorList`'s `editingCommentIds`.

**Files:**
- Modify: `app/src/CommentEditorList.tsx`
- Modify: `app/src/PageCard.tsx`
- Modify: `app/src/DocumentWorkspace.tsx`
- Test: `app/src/CommentEditorList.test.tsx` (add a focused test if the file
  exists; otherwise add the assertion to the nearest existing CommentEditorList
  test, or create a minimal one as shown)

- [ ] **Step 1: Write the failing test**

Create `app/src/CommentEditorList.composing.test.tsx` (a focused test that only
exercises the new callback, so it needn't reproduce the full editor harness):

```tsx
import { describe, expect, it, vi } from "vitest";
import { emitComposingState } from "./CommentEditorList";

describe("emitComposingState", () => {
  it("reports true when any comment is being edited", () => {
    const cb = vi.fn();
    emitComposingState(["c1"], cb);
    expect(cb).toHaveBeenCalledWith(true);
  });
  it("reports false when none are being edited", () => {
    const cb = vi.fn();
    emitComposingState([], cb);
    expect(cb).toHaveBeenCalledWith(false);
  });
  it("does nothing when no callback is provided", () => {
    expect(() => emitComposingState(["c1"], undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/CommentEditorList.composing.test.tsx`
Expected: FAIL — `emitComposingState` is not exported.

- [ ] **Step 3: Implement the emitter + wire it in CommentEditorList**

In `app/src/CommentEditorList.tsx`:

1. Export a tiny pure helper (so the logic is unit-testable without the editor):

```ts
/** Notify a listener whether any comment is currently being composed/edited. */
export function emitComposingState(
  editingCommentIds: string[],
  onComposingChange: ((composing: boolean) => void) | undefined,
): void {
  onComposingChange?.(editingCommentIds.length > 0);
}
```

2. Add `onComposingChange?: (composing: boolean) => void` to the component's
   props interface (the top-level `CommentEditorList` props, beside the existing
   callbacks).

3. Inside the component, after `editingCommentIds` is declared (around
   `CommentEditorList.tsx:112`), keep the listener in sync:

```ts
  useEffect(() => {
    emitComposingState(editingCommentIds, onComposingChange);
  }, [editingCommentIds, onComposingChange]);
```

(`useEffect` is already imported in this file; if not, add it to the React
import.)

4. Destructure `onComposingChange` from props where the other props are read.

- [ ] **Step 4: Thread the prop through PageCard (mirror `onDirtyStateChange`)**

In `app/src/PageCard.tsx`, wherever `onDirtyStateChange` appears, add a parallel
`onComposingCommentChange`:

- In **both** props interfaces that declare `onDirtyStateChange?: (isDirty:
  boolean) => void` (around lines 102 and 124), add:

```ts
  onComposingCommentChange?: (composing: boolean) => void;
```

- In the inner editor-surface props interface that re-declares it (around line
  124/2335 region), add the same line.
- Where `onDirtyStateChange` is destructured (around lines 1975 and 2335) add
  `onComposingCommentChange` alongside.
- Where PageCard renders `CommentEditorList`, pass
  `onComposingChange={onComposingCommentChange}`.
- Where the inner surface is rendered with `onDirtyStateChange={onDirtyStateChange}`
  (around line 2358), pass `onComposingCommentChange={onComposingCommentChange}`
  too, so it reaches the surface that renders `CommentEditorList`.

(Follow the exact same plumbing path `onDirtyStateChange` already takes — it is
the template. Don't invent a new path.)

- [ ] **Step 5: Wire DocumentWorkspace → session**

In `app/src/DocumentWorkspace.tsx`, next to the existing
`onDirtyStateChange={documentSession.setDirty}` (line ~1135) on the PageCard
element, add:

```tsx
                onComposingCommentChange={documentSession.setComposingComment}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd app && npx vitest run src/CommentEditorList.composing.test.tsx`
Expected: PASS.

Run: `cd app && npm run build`
Expected: build succeeds (this proves the PageCard/DocumentWorkspace prop wiring
typechecks end to end — the key risk in this task).

- [ ] **Step 7: Lint + commit**

```bash
cd app && npx biome check --write src/CommentEditorList.tsx src/CommentEditorList.composing.test.tsx src/PageCard.tsx src/DocumentWorkspace.tsx
cd /Users/claudius/github/roughneck
git add app/src/CommentEditorList.tsx app/src/CommentEditorList.composing.test.tsx app/src/PageCard.tsx app/src/DocumentWorkspace.tsx
git commit -m "feat(app): surface in-flight comment composition to the session"
```

---

### Task 6: App wiring — live update + toast

**Files:**
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Add toast state, live entries, and the watch effect**

In `app/src/App.tsx`:

1. Imports (add):

```ts
import { Toast } from "./Toast";
import {
  editorBusy,
  findNewAgentReplies,
  liveUpdateActionFor,
} from "./activity-live";
import type { ActivityEntry } from "./activity-log";
```

2. State + refs (near the other document state, around line 110):

```ts
  const [toast, setToast] = useState<{
    message: string;
    commitUrl?: string;
  } | null>(null);
  const [liveActivityEntries, setLiveActivityEntries] = useState<
    ActivityEntry[] | null
  >(null);
  const prevActivityEntriesRef = useRef<ActivityEntry[]>([]);
```

3. The handler + effect (place after the existing `watchMarkdownFile` effect,
   around line 574). It reuses `applyDocumentPage`, `documentSession`,
   `setDocumentDiskChangeState`, and `backend.commitUrl`:

```ts
  useEffect(() => {
    if (!backend?.capabilities.activityLog || !backend.watchActivityLog) return;
    if (!activeDocumentPath) return;

    let disposed = false;
    let seeded = false;
    prevActivityEntriesRef.current = [];

    const stop = backend.watchActivityLog(activeDocumentPath, (entries) => {
      if (disposed) return;
      setLiveActivityEntries(entries);

      // The first callback is the baseline (the log as it is when the doc opens).
      // Seed the diff state but DON'T act on pre-existing replies — otherwise old
      // agent replies would re-apply/toast every time you open the doc.
      if (!seeded) {
        seeded = true;
        prevActivityEntriesRef.current = entries;
        return;
      }

      const fresh = findNewAgentReplies(prevActivityEntriesRef.current, entries);
      prevActivityEntriesRef.current = entries;

      for (const reply of fresh) {
        const snapshot = documentSession.getSnapshot();
        const busy = editorBusy({
          dirty: snapshot.dirty,
          saveState: snapshot.saveState,
          composingComment: snapshot.composingComment,
        });
        const action = liveUpdateActionFor(reply, busy);

        if (action === "conflict") {
          setDocumentDiskChangeState("changed");
          setToast({ message: "The agent updated this doc — reload when ready." });
          continue;
        }
        if (action !== "apply") continue;

        void (async () => {
          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          if (!currentBackend || !currentPath || disposed) return;
          try {
            const nextDocument =
              await currentBackend.getMarkdownFile(currentPath);
            if (disposed) return;
            applyDocumentPage(nextDocument);
            documentSession.setDirty(false);
            setDocumentDiskChangeState("clean");
            setToast({
              message: `Updated by the agent · ${reply.summary}`,
              commitUrl: reply.commit
                ? currentBackend.commitUrl?.(reply.commit)
                : undefined,
            });
          } catch (error) {
            console.error("Failed to apply agent update:", error);
            setToast({
              message: "The agent updated this doc — reload to see it.",
            });
          }
        })();
      }
    });

    return () => {
      disposed = true;
      stop();
      setLiveActivityEntries(null);
    };
  }, [activeDocumentPath, applyDocumentPage, backend, documentSession]);
```

4. Render the toast — near the top level of App's returned JSX (so it overlays
   everything), add:

```tsx
      {toast ? (
        <Toast
          message={toast.message}
          commitUrl={toast.commitUrl}
          onDismiss={() => setToast(null)}
        />
      ) : null}
```

5. Pass `liveActivityEntries` to `DocumentWorkspace` where it is rendered (add the
   prop to the existing `<DocumentWorkspace … />` element):

```tsx
        liveActivityEntries={liveActivityEntries}
```

- [ ] **Step 2: Typecheck/build**

Run: `cd app && npm run build`
Expected: build succeeds. (Fix any prop-type error on `DocumentWorkspace` by
completing Task 7, which adds the prop; if building Task 6 alone, you may
temporarily expect a type error on the new `liveActivityEntries` prop until Task
7 — do Task 7 before the final build.)

- [ ] **Step 3: Run the existing App tests**

Run: `cd app && npx vitest run src/App.test.tsx`
Expected: PASS (existing App tests unaffected; the new effect no-ops without
`capabilities.activityLog`).

- [ ] **Step 4: Lint + commit**

```bash
cd app && npx biome check --write src/App.tsx
cd /Users/claudius/github/roughneck
git add app/src/App.tsx
git commit -m "feat(app): live agent update + toast (apply when idle, conflict when busy)"
```

---

### Task 7: Live history in InstructionSender

**Files:**
- Modify: `app/src/DocumentWorkspace.tsx` (accept + forward `liveActivityEntries`)
- Modify: `app/src/InstructionSender.tsx` (prefer `liveEntries`)
- Test: `app/src/InstructionSender.test.tsx` (add a focused test if the file
  exists; otherwise create the minimal one shown)

- [ ] **Step 1: Write the failing test**

Create `app/src/InstructionSender.live.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ActivityEntry } from "./activity-log";
import { InstructionSender } from "./InstructionSender";

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

const live: ActivityEntry[] = [
  {
    id: "i1",
    at: "t",
    by: "u",
    role: "user",
    type: "comments",
    instruction: "apply the comments",
  },
  {
    id: "a1",
    at: "t",
    by: "agent",
    role: "agent",
    replyTo: "i1",
    status: "done",
    summary: "applied 2 comments",
    commit: "abcdef0",
  },
];

describe("InstructionSender live history", () => {
  it("renders the history from liveEntries (Done status + summary)", () => {
    const { container, cleanup } = mount(
      <InstructionSender
        docPath="doc.md"
        author="me"
        readActivityLog={async () => []}
        appendActivityEntry={async () => {}}
        liveEntries={live}
      />,
    );
    expect(container.textContent).toContain("apply the comments");
    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("applied 2 comments");
    cleanup();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/InstructionSender.live.test.tsx`
Expected: FAIL — `liveEntries` not a prop (the history shows nothing / type error
at runtime ignored by esbuild, so assert it fails on missing "Done").

- [ ] **Step 3: Implement InstructionSender**

In `app/src/InstructionSender.tsx`:

1. Add `liveEntries?: ActivityEntry[]` to `InstructionSenderProps`.
2. Destructure it in the component signature.
3. Prefer it when building the conversation. Replace:

```ts
  const conversation = buildConversation(entries);
```

with:

```ts
  const conversation = buildConversation(liveEntries ?? entries);
```

(The internal `entries`/`reload()` still drive the initial mount and the
instant-after-send refresh; `liveEntries` keeps the thread live between sends.)

- [ ] **Step 4: Forward the prop through DocumentWorkspace**

In `app/src/DocumentWorkspace.tsx`:

1. Add `liveActivityEntries?: ActivityEntry[] | null` to the DocumentWorkspace
   props interface (import the `ActivityEntry` type if not already imported:
   `import type { ActivityEntry } from "./activity-log";`).
2. Destructure `liveActivityEntries` with the other props.
3. On the `<InstructionSender … />` element (around line 1113), pass:

```tsx
                  liveEntries={liveActivityEntries ?? undefined}
```

- [ ] **Step 5: Run tests + build**

Run: `cd app && npx vitest run src/InstructionSender.live.test.tsx`
Expected: PASS.

Run: `cd app && npm run build`
Expected: build succeeds (DocumentWorkspace now accepts `liveActivityEntries`, so
Task 6's App prop typechecks).

- [ ] **Step 6: Lint + commit**

```bash
cd app && npx biome check --write src/InstructionSender.tsx src/InstructionSender.live.test.tsx src/DocumentWorkspace.tsx
cd /Users/claudius/github/roughneck
git add app/src/InstructionSender.tsx app/src/InstructionSender.live.test.tsx app/src/DocumentWorkspace.tsx
git commit -m "feat(app): live instruction history via liveEntries"
```

---

### Task 8: Full suite, build, and live-verification notes

**Files:** none (verification only)

- [ ] **Step 1: Full app test suite**

Run: `cd app && npx vitest run`
Expected: all green (existing suite + the new activity-live, Toast,
document-session, github-backend, InstructionSender, CommentEditorList tests).

- [ ] **Step 2: Production build (catches tsc-only type errors)**

Run: `cd app && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Biome check (no errors)**

Run: `cd app && npx biome check src`
Expected: 0 errors (warnings pre-exist; do not introduce new errors). If the
changed files report a format/lint error, run `npx biome check --write` on them.

- [ ] **Step 4: Record the manual live-verification procedure**

This cannot be unit-tested (needs the real editor + a real commit). In the PR
description, note the procedure to run once a real doc is open in hosted margins:

1. Open a doc in margins (GitHub mode) that has the InstructionSender (a repo
   with `.margins/` + `capabilities.activityLog`).
2. With the editor **idle**, append an agent `done` reply to the doc's
   `.margins/<doc>.activity.jsonl` and commit a doc edit (or run the SP2 runner).
   Within ~10s: the doc content updates in place, a toast "Updated by the agent ·
   <summary>" appears with a "view commit" link, and the history row flips to
   Done.
3. Repeat while **mid-edit** (type in the body, or open a comment reply): the doc
   does **not** change under you; instead the "changed on disk" conflict notice
   appears and a toast says "reload when ready."
4. An agent `error` reply updates the history to Error with no doc change.

- [ ] **Step 5: Final empty commit marker (optional)**

```bash
cd /Users/claudius/github/roughneck
git commit --allow-empty -m "chore(app): SP3 live-update verified (suite + build green)"
```

---

## Delivery

Branch `feat/live-update-sp3`. After all tasks: dispatch a final whole-implementation
review, then **superpowers:finishing-a-development-branch** → push + PR. Because
this was built while the user was away, **stop at the PR for their review/test** —
do not merge or deploy until they confirm. A `wrangler pages deploy` makes it live
only on their explicit ask.
