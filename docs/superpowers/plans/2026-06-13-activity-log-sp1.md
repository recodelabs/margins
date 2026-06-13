# Activity Log SP1 (Producer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user send instructions ("apply comments", "rewrite …") from the margins doc UI; each is appended to an append-only per-file JSONL activity log and committed to GitHub, with a history thread showing status.

**Architecture:** A pure `activity-log.ts` defines the append-only conversation format + helpers. `GitHubBackend` gains `readActivityLog`/`appendActivityEntry` (reusing the Contents-API commit path). An `InstructionSender` panel in `DocumentWorkspace` (GitHub-only) sends instructions and renders the derived-status history. No runner/agent yet — every instruction stays `pending`.

**Tech Stack:** React + TypeScript, Vite, Vitest (`npm test` in `app/`), Biome, GitHub Contents REST API. All commands run from `app/`.

---

## File Structure

- **Create** `app/src/activity-log.ts` — pure types + format helpers.
- **Create** `app/src/activity-log.test.ts`.
- **Modify** `app/src/storage.ts` — `activityLog` capability + interface methods.
- **Modify** the 4 non-GitHub backends + the demo mock — `activityLog: false` + stubs.
- **Modify** `app/src/github-backend.ts` (+ test) — read/append impl.
- **Create** `app/src/InstructionSender.tsx` (+ test) — the panel.
- **Modify** `app/src/DocumentWorkspace.tsx` — render the panel (GitHub-only).

Branch: `feat/agent-activity-log`.

---

## Task 1: activity-log.ts (pure format module)

**Files:** Create `app/src/activity-log.ts`, `app/src/activity-log.test.ts`.

- [ ] **Step 1: Write the failing test** — `app/src/activity-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  activityLogPath,
  appendActivityLine,
  buildConversation,
  parseActivityLog,
  type ActivityEntry,
} from "./activity-log";

const user = (id: string, instruction: string): ActivityEntry => ({
  id,
  at: "2026-06-13T12:00:00.000Z",
  by: "matt",
  role: "user",
  type: "rewrite",
  instruction,
});
const reply = (
  id: string,
  replyTo: string,
  status: "done" | "error",
): ActivityEntry => ({
  id,
  at: "2026-06-13T12:01:00.000Z",
  by: "agent",
  role: "agent",
  replyTo,
  status,
  summary: status === "done" ? "Tightened the intro." : "",
  ...(status === "error" ? { error: "boom" } : { commit: "6a0ac4b" }),
});

describe("activityLogPath", () => {
  it("mirrors the doc path under .margins with an .activity.jsonl suffix", () => {
    expect(activityLogPath("docs/notes.md")).toBe(
      ".margins/docs/notes.md.activity.jsonl",
    );
  });
});

describe("parseActivityLog", () => {
  it("parses valid lines and skips blank/garbled ones", () => {
    const text = [
      JSON.stringify(user("a1", "tighten")),
      "",
      "not json",
      '{"role":"nope"}',
      JSON.stringify(reply("r1", "a1", "done")),
    ].join("\n");
    const entries = parseActivityLog(text);
    expect(entries.map((e) => e.id)).toEqual(["a1", "r1"]);
  });

  it("returns [] for empty input", () => {
    expect(parseActivityLog("")).toEqual([]);
  });
});

describe("appendActivityLine", () => {
  it("appends one JSON line with a trailing newline", () => {
    const out = appendActivityLine("", user("a1", "x"));
    expect(out).toBe(`${JSON.stringify(user("a1", "x"))}\n`);
  });

  it("adds a missing separating newline before appending", () => {
    const out = appendActivityLine("line1", user("a1", "x"));
    expect(out).toBe(`line1\n${JSON.stringify(user("a1", "x"))}\n`);
  });
});

describe("buildConversation", () => {
  it("pairs instructions with their reply and derives status", () => {
    const convo = buildConversation([
      user("a1", "tighten"),
      reply("r1", "a1", "done"),
      user("a2", "apply"),
    ]);
    expect(convo).toEqual([
      { instruction: user("a1", "tighten"), reply: reply("r1", "a1", "done"), status: "done" },
      { instruction: user("a2", "apply"), reply: null, status: "pending" },
    ]);
  });

  it("marks an instruction errored when its reply is an error", () => {
    const convo = buildConversation([user("a1", "x"), reply("r1", "a1", "error")]);
    expect(convo[0].status).toBe("error");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd app && npx vitest run src/activity-log.test.ts` → cannot find module.

- [ ] **Step 3: Implement** — `app/src/activity-log.ts`:

```ts
export type InstructionType = "comments" | "rewrite" | "custom";

export interface UserInstructionEntry {
  id: string;
  at: string;
  by: string;
  role: "user";
  type: InstructionType;
  instruction: string;
}

export interface AgentReplyEntry {
  id: string;
  at: string;
  by: string;
  role: "agent";
  replyTo: string;
  status: "done" | "error";
  summary: string;
  commit?: string;
  error?: string;
}

export type ActivityEntry = UserInstructionEntry | AgentReplyEntry;

export type InstructionStatus = "pending" | "done" | "error";

export interface ConversationItem {
  instruction: UserInstructionEntry;
  reply: AgentReplyEntry | null;
  status: InstructionStatus;
}

/** Per-doc append-only log: `.margins/<docPath>.activity.jsonl`. */
export function activityLogPath(docPath: string): string {
  return `.margins/${docPath}.activity.jsonl`;
}

function isEntry(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  return v.role === "user" || v.role === "agent";
}

/** Parse JSONL, skipping blank or malformed lines so one bad line can't break the log. */
export function parseActivityLog(text: string): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isEntry(parsed)) entries.push(parsed);
    } catch {
      // skip garbled line
    }
  }
  return entries;
}

/** Append one entry as a JSON line, ensuring exactly one trailing newline. */
export function appendActivityLine(text: string, entry: ActivityEntry): string {
  const base = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
  return `${base}${JSON.stringify(entry)}\n`;
}

/** Pair each user instruction with its agent reply (latest wins) and derive status. */
export function buildConversation(entries: ActivityEntry[]): ConversationItem[] {
  const replies = new Map<string, AgentReplyEntry>();
  for (const entry of entries) {
    if (entry.role === "agent") replies.set(entry.replyTo, entry);
  }
  return entries
    .filter((e): e is UserInstructionEntry => e.role === "user")
    .map((instruction) => {
      const reply = replies.get(instruction.id) ?? null;
      return {
        instruction,
        reply,
        status: reply ? reply.status : ("pending" as InstructionStatus),
      };
    });
}
```

- [ ] **Step 4: Run, expect PASS** — `cd app && npx vitest run src/activity-log.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/src/activity-log.ts app/src/activity-log.test.ts
git commit -m "feat: add activity-log format module (append-only conversation)"
```

---

## Task 2: Backend capability + interface + non-GitHub stubs

**Files:** Modify `app/src/storage.ts`, the 4 backends, and `app/src/RoughdraftFormatDemo.tsx`.

- [ ] **Step 1: Capability + interface** — In `app/src/storage.ts`, add to `BackendCapabilities` (after `createFile`):

```ts
  /** Supports reading/appending a per-file agent activity log. */
  activityLog: boolean;
```

Add an import of the activity type at the top of `storage.ts`:

```ts
import type { ActivityEntry } from "./activity-log";
```

Add to `interface StorageBackend` (below `createMarkdownFile`):

```ts
  /**
   * Reads the per-file agent activity log (empty when absent). Present when
   * `capabilities.activityLog`.
   */
  readActivityLog(docPath: string): Promise<ActivityEntry[]>;
  /**
   * Appends one entry to the per-file activity log and commits it. Present when
   * `capabilities.activityLog`.
   */
  appendActivityEntry(docPath: string, entry: ActivityEntry): Promise<void>;
```

- [ ] **Step 2: Stub the 5 non-GitHub backends** — In EACH of `local-storage-backend.ts`, `preview-backend.ts`, `remote-backend.ts`, `api-backend.ts`, and `RoughdraftFormatDemo.tsx`:

(a) add `activityLog: false,` to the `capabilities` object.
(b) add these two methods next to the existing `createMarkdownFile` stub (`ActivityEntry` is imported via `./storage` types where needed — add it to the import if missing):

```ts
  readActivityLog(_docPath: string): Promise<import("./activity-log").ActivityEntry[]> {
    return Promise.resolve([]);
  }
  appendActivityEntry(
    _docPath: string,
    _entry: import("./activity-log").ActivityEntry,
  ): Promise<void> {
    return Promise.reject(
      new Error("Activity log is not supported in this backend"),
    );
  }
```

- [ ] **Step 3: Build + full suite** — `cd app && VITE_GITHUB_MODE=1 npm run build` then `cd app && npm test`. Expected: green, no type errors. (If a file lacks the `ActivityEntry` import and the inline `import(...)` type is rejected by Biome, add `import type { ActivityEntry } from "./activity-log";` to that file and use the bare name.)

- [ ] **Step 4: Commit**

```bash
git add app/src/storage.ts app/src/local-storage-backend.ts app/src/preview-backend.ts app/src/remote-backend.ts app/src/api-backend.ts app/src/RoughdraftFormatDemo.tsx
git commit -m "feat: add activityLog capability + interface + non-GitHub stubs"
```

---

## Task 3: GitHubBackend read/append

**Files:** Modify `app/src/github-backend.ts`, `app/src/github-backend.test.ts`.

Context: `github-backend.ts` has `githubFetch`, `encodeBase64`, `decodeBase64`, `invalidateCachedUrl`, `this.headers`, `this.contentsUrl`, `this.cfg`, and the `API` constant. Mirror `createMarkdownFile`/`saveMarkdownFile`.

- [ ] **Step 1: Write the failing tests** — In `app/src/github-backend.test.ts`, add inside `describe("GitHubBackend", …)`:

```ts
  describe("activity log", () => {
    it("readActivityLog returns [] when the log file is absent (404)", async () => {
      global.fetch = vi.fn(
        async () => new Response("not found", { status: 404 }),
      ) as unknown as typeof fetch;
      await expect(backend().readActivityLog("docs/x.md")).resolves.toEqual([]);
    });

    it("readActivityLog parses the JSONL content", async () => {
      const line = JSON.stringify({
        id: "a1",
        at: "2026-06-13T12:00:00.000Z",
        by: "octocat",
        role: "user",
        type: "rewrite",
        instruction: "tighten",
      });
      global.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ sha: "s1", content: b64(`${line}\n`), encoding: "base64" }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;
      const entries = await backend().readActivityLog("docs/x.md");
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe("a1");
    });

    it("appendActivityEntry reads, appends and PUTs with the prior sha", async () => {
      const existing = JSON.stringify({
        id: "a0",
        at: "2026-06-13T11:00:00.000Z",
        by: "octocat",
        role: "user",
        type: "comments",
        instruction: "apply",
      });
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (!init || init.method !== "PUT") {
          return new Response(
            JSON.stringify({ sha: "log-sha", content: b64(`${existing}\n`), encoding: "base64" }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ content: { sha: "new" } }), {
          status: 200,
        });
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const entry = {
        id: "a1",
        at: "2026-06-13T12:00:00.000Z",
        by: "octocat",
        role: "user" as const,
        type: "rewrite" as const,
        instruction: "tighten",
      };
      await backend().appendActivityEntry("docs/x.md", entry);

      const putCall = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit)?.method === "PUT",
      );
      expect(putCall?.[0]).toBe(
        "https://api.github.com/repos/o/r/contents/.margins/docs/x.md.activity.jsonl",
      );
      const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
      expect(body.sha).toBe("log-sha");
      expect(decodeURIComponent(escape(atob(body.content)))).toBe(
        `${existing}\n${JSON.stringify(entry)}\n`,
      );
    });
  });
```

- [ ] **Step 2: Run, expect FAIL** — `cd app && npx vitest run src/github-backend.test.ts`.

- [ ] **Step 3: Implement** — In `app/src/github-backend.ts`: add the import at the top:

```ts
import {
  type ActivityEntry,
  activityLogPath,
  appendActivityLine,
  parseActivityLog,
} from "./activity-log";
```

Set `capabilities.activityLog = true` (add the key to the `capabilities` object). Add these methods (next to `createMarkdownFile`):

```ts
  private async readActivityRaw(
    path: string,
  ): Promise<{ text: string; sha: string } | null> {
    const res = await githubFetch(this.contentsUrl(path), this.headers());
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub activity read failed (${res.status})`);
    const json = (await res.json()) as { sha: string; content: string };
    return { text: decodeBase64(json.content), sha: json.sha };
  }

  async readActivityLog(docPath: string): Promise<ActivityEntry[]> {
    const raw = await this.readActivityRaw(activityLogPath(docPath));
    return raw ? parseActivityLog(raw.text) : [];
  }

  async appendActivityEntry(
    docPath: string,
    entry: ActivityEntry,
  ): Promise<void> {
    const { owner, repo, branch } = this.cfg;
    const path = activityLogPath(docPath);
    const existing = await this.readActivityRaw(path);
    const nextText = appendActivityLine(existing?.text ?? "", entry);
    const res = await githubFetch(
      `${API}/repos/${owner}/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: `chore(margins): activity (${entry.role}) on ${docPath}`,
          content: encodeBase64(nextText),
          sha: existing?.sha,
          branch,
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub activity append failed (${res.status})`);
    }
    invalidateCachedUrl(this.contentsUrl(path));
  }
```

- [ ] **Step 4: Run, expect PASS** — `cd app && npx vitest run src/github-backend.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/src/github-backend.ts app/src/github-backend.test.ts
git commit -m "feat: GitHubBackend readActivityLog + appendActivityEntry"
```

---

## Task 4: InstructionSender component

**Files:** Create `app/src/InstructionSender.tsx`, `app/src/InstructionSender.test.tsx`.

- [ ] **Step 1: Write the failing test** — `app/src/InstructionSender.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstructionSender } from "./InstructionSender";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

describe("InstructionSender", () => {
  it("loads and renders the existing history with derived status", async () => {
    const readActivityLog = vi.fn(async () => [
      { id: "a1", at: "t", by: "matt", role: "user", type: "rewrite", instruction: "tighten" },
    ]);
    await act(async () => {
      root.render(
        <InstructionSender
          docPath="docs/x.md"
          author="matt"
          readActivityLog={readActivityLog}
          appendActivityEntry={vi.fn()}
        />,
      );
    });
    expect(readActivityLog).toHaveBeenCalledWith("docs/x.md");
    expect(container.textContent).toContain("tighten");
    expect(container.textContent).toContain("Pending");
  });

  it("sends a typed instruction as a pending user entry, then reloads", async () => {
    const readActivityLog = vi.fn(async () => []);
    const appendActivityEntry = vi.fn(async () => {});
    await act(async () => {
      root.render(
        <InstructionSender
          docPath="docs/x.md"
          author="matt"
          readActivityLog={readActivityLog}
          appendActivityEntry={appendActivityEntry}
        />,
      );
    });

    const box = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!box) throw new Error("textarea not found");
    await act(async () => {
      buttonByText("Rewrite")?.click();
      typeInto(box, "tighten the intro");
    });
    await act(async () => {
      buttonByText("Send")?.click();
    });

    expect(appendActivityEntry).toHaveBeenCalledTimes(1);
    const [path, entry] = appendActivityEntry.mock.calls[0];
    expect(path).toBe("docs/x.md");
    expect(entry).toMatchObject({
      role: "user",
      type: "rewrite",
      by: "matt",
      instruction: "tighten the intro",
    });
    expect(typeof entry.id).toBe("string");
    expect(readActivityLog).toHaveBeenCalledTimes(2); // initial + after send
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd app && npx vitest run src/InstructionSender.test.tsx`.

- [ ] **Step 3: Implement** — `app/src/InstructionSender.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  type ActivityEntry,
  buildConversation,
  type InstructionType,
} from "./activity-log";
import { Button } from "./components/ui/button";

export interface InstructionSenderProps {
  docPath: string;
  author: string;
  readActivityLog: (docPath: string) => Promise<ActivityEntry[]>;
  appendActivityEntry: (docPath: string, entry: ActivityEntry) => Promise<void>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  done: "Done",
  error: "Error",
};

export function InstructionSender({
  docPath,
  author,
  readActivityLog,
  appendActivityEntry,
}: InstructionSenderProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [type, setType] = useState<InstructionType>("custom");
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    readActivityLog(docPath)
      .then((next) => {
        if (!cancelled) setEntries(next);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [docPath, readActivityLog]);

  useEffect(() => reload(), [reload]);

  const send = async () => {
    const text = instruction.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      by: author,
      role: "user",
      type,
      instruction: text,
    };
    try {
      await appendActivityEntry(docPath, entry);
      setInstruction("");
      setType("custom");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const conversation = buildConversation(entries);

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant={type === "comments" ? "default" : "outline"}
          onClick={() => setType("comments")}
        >
          Apply comments
        </Button>
        <Button
          type="button"
          variant={type === "rewrite" ? "default" : "outline"}
          onClick={() => setType("rewrite")}
        >
          Rewrite
        </Button>
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Instruction for the agent…"
        className="min-h-16 w-full resize-y rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-slate-300/70"
      />
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={send}
          disabled={!instruction.trim() || sending}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
      {conversation.length > 0 ? (
        <ul className="flex flex-col gap-1.5 border-t border-slate-100 dark:border-slate-800 pt-2">
          {conversation.map((item) => (
            <li key={item.instruction.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                  <span className="font-medium">{item.instruction.type}</span>:{" "}
                  {item.instruction.instruction}
                </span>
                <span className="shrink-0 text-stone-500 dark:text-stone-400">
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              {item.reply ? (
                <div className="mt-0.5 text-stone-500 dark:text-stone-400">
                  {item.reply.summary || item.reply.error}
                  {item.reply.commit ? ` · ${item.reply.commit.slice(0, 7)}` : ""}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS** — `cd app && npx vitest run src/InstructionSender.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/src/InstructionSender.tsx app/src/InstructionSender.test.tsx
git commit -m "feat: add InstructionSender panel (send instruction + history thread)"
```

---

## Task 5: Wire InstructionSender into DocumentWorkspace

**Files:** Modify `app/src/DocumentWorkspace.tsx`.

Context: `DocumentWorkspace` already receives `backend: StorageBackend | null` and `activeDocumentPath: string | null`. Render the panel when the backend supports activity logs and there's a path.

- [ ] **Step 1: Add the import** — near the other local imports in `DocumentWorkspace.tsx`:

```tsx
import { InstructionSender } from "./InstructionSender";
```

- [ ] **Step 2: Render the panel** — In the JSX, just before the `<PageCard` element (so it sits above the document), add:

```tsx
{backend?.capabilities.activityLog && activeDocumentPath ? (
  <div className="mb-4">
    <InstructionSender
      docPath={activeDocumentPath}
      author={backend.info.authorLabel ?? "you"}
      readActivityLog={(p) => backend.readActivityLog(p)}
      appendActivityEntry={(p, entry) => backend.appendActivityEntry(p, entry)}
    />
  </div>
) : null}
```

(If `backend.info.authorLabel` isn't on the type, use `backend.info.authorLabel` — it's set by `GitHubBackend` as the login; fall back to `"you"`.)

- [ ] **Step 3: Build + full suite** — `cd app && VITE_GITHUB_MODE=1 npm run build` then `npm test`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add app/src/DocumentWorkspace.tsx
git commit -m "feat: show the InstructionSender in the GitHub document workspace"
```

---

## Task 6: Verification

**Files:** none.

- [ ] **Step 1: Full suite + lint** — `cd app && npm test`; `cd app && npx biome check src/activity-log.ts src/activity-log.test.ts src/InstructionSender.tsx src/InstructionSender.test.tsx src/github-backend.ts src/storage.ts src/DocumentWorkspace.tsx` (run `--write` if formatting flagged; re-commit).

- [ ] **Step 2: Build** — `cd app && VITE_GITHUB_MODE=1 npm run build` → succeeds.

- [ ] **Step 3: Manual smoke (real GitHub repo)** — open a markdown file in margins, send an "Apply comments" and a "Rewrite: …" instruction; confirm a `chore(margins): activity (user) …` commit appears on the branch adding `.margins/<path>.activity.jsonl` with the two JSONL lines, and the history thread shows both as **Pending** with the right type/text.

---

## Self-Review (completed by plan author)

**Spec coverage (SP1 section):**
- Append-only JSONL, per-file `.margins/<path>.activity.jsonl`, robust parse → Task 1.
- Capability + interface + non-GitHub stubs → Task 2.
- GitHub read (404→empty) + append (read→append→commit) → Task 3.
- Instruction sender (presets + free text) + derived-status history → Tasks 4–5.
- All entries stay `pending` (no runner) → buildConversation default; smoke step.
- Tests at each layer → Tasks 1/3/4.

**Placeholder scan:** none; every step shows complete code/commands.

**Type consistency:** `ActivityEntry`, `UserInstructionEntry`, `AgentReplyEntry`, `InstructionType`, `activityLogPath`, `parseActivityLog`, `appendActivityLine`, `buildConversation`, `ConversationItem` are identical across Task 1 (definition), Task 2/3 (backend), and Task 4 (UI). `readActivityLog(docPath): Promise<ActivityEntry[]>` and `appendActivityEntry(docPath, entry): Promise<void>` match across interface (Task 2), GitHub impl (Task 3), stubs (Task 2), and the `InstructionSender` props (Tasks 4–5).
