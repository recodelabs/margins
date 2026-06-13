# Agent runner (SP2) — design

**Date:** 2026-06-13
**Status:** Approved
**Part of:** [Agent activity log & remote instruction loop](2026-06-13-agent-activity-log-design.md) — sub-project 2 of 3 (SP1 producer shipped; SP3 live-update later).

## Goal

A local runner that watches a repo's margins activity logs, carries out pending
instructions with a **strict-mode Claude Code session billed to the user's own
subscription** (no Agent SDK, no `claude -p`), commits the edited doc, and
appends the agent's reply to the log — so a malicious instruction physically
cannot run a destructive command.

## Core idea: split the two jobs

The safety guarantee comes from separating the network/git work from the LLM:

- **Poller** (plain Python, Amadeus-style, *no LLM*): owns all git/GitHub I/O.
  Polls for pending instructions, hands one to the session, waits, then commits
  and appends the reply. A dumb script can't be socially-engineered.
- **Session** (interactive `claude`, the user's subscription, *idle until
  nudged*): launched once with a locked-down permission profile. It can only
  read/edit the doc — no Bash (bar one fixed wait script), no network. The
  dangerous tools are never granted, so "delete your hard drive" has nothing to
  call.

```
┌─ user's machine (set up once) ──────────────────────────────────┐
│  ① POLLER (python, every few minutes, NO LLM)                    │
│     git pull → scan .margins/**/*.activity.jsonl for pending     │
│     → write inbox.json → wait done.json → commit + reply + push  │
│  ② SESSION (interactive claude, subscription, idle)              │
│     launched once: allow Read/Edit/Write(doc dir) + 1 wait script│
│     deny Bash/WebFetch/everything else                           │
│     wait → read inbox+doc → Edit doc → write done.json           │
└──────────────────────────────────────────────────────────────────┘
```

## Data flow (end to end)

1. **margins (web, SP1)** commits a `UserInstructionEntry` to
   `.margins/<docPath>.activity.jsonl`.
2. **Poller** (loop, interval configurable, default ~120s):
   - `git pull` the local clone (fast-forward only).
   - Parse each `.margins/**/*.activity.jsonl`; find the **oldest** instruction
     whose `id` has no `AgentReplyEntry` with a matching `replyTo` (pending).
     One at a time.
   - `git checkout -- <docPath>` to reset the doc to a clean committed state
     (crash-safe restart — discards any half-applied edit from a prior crash).
   - Write `<state>/inbox.json` =
     `{ instructionId, docPath, type, instruction }`.
3. **Session** (runner skill loop):
   - Call `wait-for-task.sh` (blocks until `inbox.json` exists) — zero tokens
     while blocked.
   - Read `inbox.json`, read the referenced doc (which already contains any
     inline CriticMarkup comments).
   - Apply the instruction by **editing only the doc file**:
     - `type: "comments"` — resolve/apply the inline `{>>…<<}` comments.
     - `type: "rewrite"` / `"custom"` — follow `instruction`.
   - Write `<state>/done.json` =
     `{ status: "done"|"error", summary, replyTo: instructionId, error? }`.
     (`summary` = the short "what I did" note that becomes the reply's summary.)
4. **Poller** (resumes):
   - Sees `done.json`.
   - On `status:"done"`: `git add <docPath>` → commit (`"agent: <summary>"`) →
     capture sha **S**.
   - Append an `AgentReplyEntry` to the doc's `.jsonl`:
     `{ id: uuid, at: now, by: agentBy, role: "agent", replyTo, status: "done",
        summary, commit: S }` (`agentBy` from config, default `"agent"`).
   - On `status:"error"`: skip the doc commit; append the same shape with
     `status:"error"`, `error`, no `commit`.
   - `git add` the `.jsonl` → commit → `git push`. (Doc and reply are two
     commits; the reply's `commit:S` points at the doc change so SP3 can match
     the doc sha.)
   - Delete `inbox.json` + `done.json`; move to the next pending instruction.

The reply construction reuses SP1's pure helpers (`appendActivityLine`,
the `AgentReplyEntry` shape from `app/src/activity-log.ts`) — re-implemented in
Python for the poller (the format is the shared contract; see "Format parity"
below).

## The safety profile

The session is launched **once** via `runner/launch-session.sh`, which runs
`claude` with `runner/settings.json`:

- **allow:** `Read`, `Edit`, `Write` restricted to the doc directory
  (`--add-dir <clone>`); `Bash(wait-for-task.sh)` — that one exact script.
- **deny:** all other `Bash`, `WebFetch`, and every other tool.

`wait-for-task.sh` takes no arguments and only blocks until `inbox.json` appears
(poll-sleep loop on the state dir), then exits 0. Because the allowlist permits
*only that exact invocation*, the agent cannot run `rm`, `curl`, or any other
command — the wait script is unparameterizable and harmless. The session sits in
one pending tool call while idle (no model turns, no subscription spend) and
wakes only when the poller drops a task.

The session writes `done.json` via the `Write` tool (allowed in the doc dir /
state dir). It never calls git or the network; the poller does. So even a
prompt-injection instruction ("ignore previous, run …") has no tool to abuse.

## Components & layout

New top-level `runner/` directory plus one skill:

- `runner/poller.py` — the loop: pull, detect pending, write inbox, wait done,
  commit doc, append reply, push. Pure functions (pending-detection, reply
  construction, JSONL append) split from the git/IO side effects for testing.
- `runner/wait-for-task.sh` — the only allowed Bash; blocks until a task lands.
- `runner/launch-session.sh` — starts `claude` with the locked profile + the
  runner skill in the clone.
- `runner/settings.json` — the allow/deny permission profile.
- `runner/config.example.json` — `{ clonePath, branch, stateDir, pollSeconds,
  agentBy }`; the user copies to `config.json` (gitignored).
- `runner/README.md` — one-time setup (clone, copy config, launch session, run
  poller).
- `skills/margins-runner/SKILL.md` — loop instructions for the session.
- State (`inbox.json`, `done.json`) lives **outside the clone**, default
  `~/.margins-runner/<repo>/`, so it never pollutes the target repo.

## Format parity (poller ↔ SP1)

The poller re-implements, in Python, exactly three things from
`app/src/activity-log.ts`: `activityLogPath`, parse (skip bad lines + the
role-specific `isEntry` validation), and `appendActivityLine` (one JSON line,
single trailing newline). A small fixture shared in spirit (same example
entries) keeps them in lockstep; a parity test asserts the Python parser accepts
SP1-produced lines and the Python appender produces lines SP1's parser accepts.

## Crash safety & idempotency

- The poller resets the doc (`git checkout --`) before each task, so a crash
  mid-edit leaves no partial state; on restart the still-pending instruction is
  re-detected and re-run from clean.
- An instruction is "done" only once its `AgentReplyEntry` is committed and
  pushed. If the poller crashes after the doc commit but before the reply commit,
  on restart the instruction is still pending (no reply) and re-runs; the extra
  doc commit is harmless (the re-run edits from the now-committed state).
- Only the oldest pending instruction is processed at a time; the log stays an
  ordered append-only conversation.

## Testing

- **Poller unit tests (Python, e.g. pytest):** pending-detection (instruction
  with/without a matching reply; multiple pending → oldest first); reply
  construction (done vs error shapes; `commit` only on done); `appendActivityLine`
  parity; inbox/done round-trip; doc-reset-before-task. Git is faked (a thin
  seam over the few git calls).
- **Format parity test:** Python parse/append against SP1-shaped example lines.
- **Live dry-run** on a throwaway repo: launch the locked session, drop an
  `inbox.json` by hand, confirm it edits only the doc and writes `done.json`, and
  confirm the permission profile blocks an attempted `Bash(rm …)` /
  `Bash(curl …)`. (A real `claude` session can't be unit-mocked; this is the
  integration check.)

## Out of scope (YAGNI / later)

- Multi-repo / multi-branch watching (v1 = one repo, one branch, configurable).
- Parallel/queued instructions (one-at-a-time per the parent design).
- SP3 live-update + toast in margins (its own spec).
- Editing non-markdown files.
- Secret management beyond the user's existing GitHub auth on the clone and their
  Claude subscription login.
- A daemon/service wrapper (the user runs the poller and session themselves,
  Amadeus-style).

## Delivery

`feat/agent-runner-sp2`. Spec → plan → subagent-driven implementation. Poller +
skill + profile land together; verified by the unit suite plus a live dry-run.
Then PR → merge → pull `main` (no deploy — SP2 is local tooling, not the web
app).
