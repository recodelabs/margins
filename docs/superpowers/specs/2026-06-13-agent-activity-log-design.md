# Agent activity log & remote instruction loop — design

**Date:** 2026-06-13
**Status:** Brainstormed; SP1 pending user review

## Vision

Drive an agent that edits your markdown docs **remotely, from the margins
interface**, instead of going back to a desktop Claude each time. You send an
instruction from the doc ("apply the comments", "rewrite the intro …"); a
strict-mode agent running on your machine picks it up, does it, commits the
result, and the open document updates itself with a toast — no reload. Safe by
construction: the agent can only edit the doc, not run arbitrary commands.

## Architecture (three sub-projects)

```
  ┌─────────────── margins (web, GitHub mode) ───────────────┐
  │  Instruction sender ──append──> .margins/<path>.jsonl    │   SP1 (producer)
  │  Live update  <──poll── GitHub (doc + activity log)      │   SP3 (live update)
  └──────────────────────────┬───────────────────────────────┘
                 commit       │ poll (~5s)
                 to GitHub     v
        ┌──────────── your machine ────────────┐
        │  Runner: poll GitHub → find pending   │              SP2 (runner)
        │  instruction → strict-mode agent edits │
        │  the doc → commit → append agent reply │
        └────────────────────────────────────────┘
```

- **SP1 — Producer (build first):** the activity-log format + the instruction
  sender UI in margins. Self-contained; useful on its own (a committed record of
  instructions) and defines the contract the other two consume.
- **SP2 — Runner:** a local process (extends the `roughneck` CLI) that **polls
  GitHub** for pending instructions, runs a **strict-mode** agent to carry them
  out, commits the edited doc, and appends its reply to the log.
- **SP3 — Live update:** margins polls GitHub for the open doc + its log; when
  the agent's commit lands it **auto-refreshes the doc and toasts** — but only
  when you're not mid-edit (otherwise the existing conflict flow applies).

**Trigger model:** poll GitHub (decided). No inbound connection to your machine;
committing an instruction *is* the trigger; git is the single source of truth.

## The activity log (shared contract)

- **One append-only JSONL file per doc:** `activityLogPath(filePath)` →
  `.margins/<same/relative/path>.activity.jsonl` (mirrors the doc's path under a
  repo-root `.margins/` folder).
- **Append-only conversation.** Two entry roles; nobody rewrites lines.
  - User instruction:
    `{ id, at, by, role: "user", type: "comments"|"rewrite"|"custom", instruction }`
  - Agent reply:
    `{ id, at, by: "agent", role: "agent", replyTo, status: "done"|"error", summary, commit?, error? }`
- **Status is derived,** not stored on the instruction: an instruction is
  `pending` until an agent reply with its `replyTo` exists, then `done`/`error`
  from that reply. The agent's `summary` is the short "what I did" note.
- **Robust parse:** JSONL parsed line-by-line; blank/garbled lines are skipped so
  one bad line can't break the log.

## SP1 — Producer (build-ready detail)

### `src/activity-log.ts` (pure, unit-tested)
- Types: `ActivityEntry` (the `user` and `agent` shapes above), `InstructionType`.
- `activityLogPath(docPath: string): string` → `.margins/<docPath>.activity.jsonl`.
- `parseActivityLog(text: string): ActivityEntry[]` (skips bad lines).
- `appendActivityLine(text: string, entry: ActivityEntry): string` (append one
  JSON line, ensuring a trailing newline).
- `deriveInstructionStatus(entries): Map<instructionId, "pending"|"done"|"error">`
  (or a `ConversationItem[]` builder pairing instructions with their reply) for
  the UI history.
- `createInstructionEntry({ type, instruction, by }): ActivityEntry` (stamps a
  fresh id; the caller supplies `at` so the module stays time-pure/testable).

### Storage — `GitHubBackend`
- `capabilities.activityLog = true` (interface gets `activityLog: boolean`,
  `false` on other backends).
- `readActivityLog(docPath): Promise<ActivityEntry[]>` — GET the `.jsonl`; a 404
  is an empty log.
- `appendActivityEntry(docPath, entry): Promise<void>` — read current text,
  `appendActivityLine`, PUT/commit (message `chore(margins): instruction
  (<type>) on <doc>`). Reuses the existing Contents-API commit path (with sha so
  concurrent appends conflict-detect, then retry the read+append once).
- Non-GitHub backends: `activityLog: false` + rejecting stubs (mirrors how
  `createMarkdownFile`/`saveAsset` are stubbed).

### UI — `InstructionSender` panel (document workspace, near the commit action)
- Presets **Apply comments** / **Rewrite** set `type`; a free-text box adds
  specifics; **Send** builds an entry (`by` = the GitHub login, `at` = now,
  `role: "user"`) → `appendActivityEntry` → commits.
- A compact **history thread** beneath it: each instruction with its derived
  status badge, and the agent's reply (summary + commit link) once it exists.
  Loaded on open and re-read after sending. (All entries stay ⏳ pending until
  SP2 exists.)
- Gated on `capabilities.activityLog` (GitHub only for v1).

### Testing (SP1)
- Unit: `activity-log.ts` (path mapping; parse incl. bad-line tolerance; append;
  status derivation; entry creation).
- `github-backend.test.ts`: `appendActivityEntry` reads+appends+commits with the
  right path/message (mocked fetch, like the `createMarkdownFile` tests);
  `readActivityLog` returns `[]` on 404.
- `InstructionSender` component test (presets set type; Send appends an entry;
  history renders status), `createRoot` pattern.

## SP2 — Runner (outline; its own spec later)

- Lives in the `roughneck` CLI (a `margins agent` / `margins watch` subcommand,
  or a small Node worker it spawns).
- Loop: for each watched repo/file, poll GitHub (or a local clone) for the
  activity log; find instructions with no agent reply; for each, run the agent.
- **Strict-mode agent:** Claude Code headless / Agent SDK with a **deny-all-but**
  toolset — read the target doc (+ its log), edit *only* that markdown file; **no
  Bash, no network beyond the commit, no other files.** This is the safety
  model: destructive actions aren't in the toolset, so a malicious instruction
  can't reach them.
- On success: commit the edited doc, then append an `agent` reply (status, short
  summary, commit). On failure: append an `error` reply with the message.
- Acts on the **committed** doc only — uncommitted in-flight user edits/comments
  aren't visible to it, so it can't delete a comment you're still writing.

## SP3 — Live update (outline; its own spec later)

- Margins (GitHub mode) polls GitHub for the open doc + its activity log.
- When the doc's sha changes (the agent committed) **and the editor is clean**
  (not dirty, no in-flight comment): re-read and apply in place, then toast
  "Updated by the agent · <summary> → <commit>." Reuses `applyDocumentPage` /
  the `documentDiskChangeState` machinery.
- When **dirty / mid-edit:** do **not** clobber — surface the existing
  "changed on disk" notice so you choose (reload / keep editing). Reuses the
  current conflict path (`watchMarkdownFile`, `getReviewWatchStatus`,
  `MarkdownFileConflictError`, the conflict notice).
- The activity-log change also refreshes the history thread (statuses flip to
  ✅ done with the summary).

## Out of scope (for now)

- Push/relay triggering (polling only).
- Multi-agent / queuing beyond one-at-a-time per file.
- Editing non-markdown files via instructions.
- Auth/secrets handling for the runner beyond the user's own GitHub token + a
  Claude API key the user provides locally.

## Delivery

Build order **SP1 → SP2 → SP3**, each its own spec → plan → implementation cycle.
This document is the shared architecture; SP1 above is build-ready and goes to a
plan next.
