---
name: margins
description: Use when collaborating on a markdown working doc annotated with roughdraft.md CriticMarkup comments ({==...==}{>>...<<}) — e.g. asked to "do a round of review", reply to or resolve comments, or do a rewrite pass on a working doc.
---

# Margins — roughdraft.md working-doc collaboration

## Overview

The human writes and edits the markdown doc and leaves margin comments in roughdraft.md CriticMarkup syntax (https://www.roughdraft.md). You work in two **separate, explicitly-triggered passes**: a **review pass** (reply to comments only) and a **rewrite pass** (apply the edits, resolve comments). Never combine them.

**All communication happens in the doc.** The human reads the doc through roughdraft.md rendering and does not see chat — every question, answer, and process note must be a comment in the doc, committed and pushed. Replies attach to the comment they answer; standalone process notes (git housekeeping, dropped junk, renumbered ids) go directly under the visible version stamp at the top.

## Syntax

- Highlight a span: `{==text==}`
- Comment on it: `{>>comment<<}{id="cN" by="user" at="<ISO8601>"}` immediately after the highlight
- Reply: `{>>text<<}{id="cM" by="claude" at="<ISO8601>" re="cN"}` placed immediately after the comment it answers
- Comment ids are unique doc-wide — take the next free number, never reuse one
- Timestamps are real: `date -u +"%Y-%m-%dT%H:%M:%S.000Z"` — never invent them

## Review pass — "do a round of review"

1. **Pull first.** `git pull` the doc's branch — the human edits via web/roughdraft and may be ahead of your checkout. Reconcile divergence: keep every human comment; on a duplicate id, the already-pushed comment keeps its id and you renumber the unpushed one to the next free number (note the renumber inside that comment or your reply to it); drop only obviously accidental junk (stray keystrokes) and say so in a process-note comment.
2. Read the whole doc. Reply to every open human comment: answer it, ask clarifying questions, or acknowledge.
3. **No content edits.** Replies only — even if a comment asks for a trivial fix, the fix waits for the rewrite pass.
4. Bump **patch** (+0.0.1), sync stamps, commit, push.

## Rewrite pass — "rewrite" / "apply the edits"

1. Pull first (same as above).
2. Apply the requested edits across the doc text.
3. Resolve the comments you handled: **delete them**, and where useful leave a fresh `by="claude"` comment marking what you did and where (like resolving a thread), or asking a follow-up. The human resolves your notes by deleting them.
4. Bump **minor** (+0.1.0), sync stamps, commit, push.

## Versioning & stamps

The doc carries `version` and `last_modified` (ISO 8601 UTC) in YAML frontmatter **and** a visible stamp directly under the H1, e.g. `` <sub>`v0.3.1 · Last modified Jun 10, 2026 at 10:27 PM EDT`</sub> `` — friendly format in the human's local timezone. Update **both** on every bump; every bump is its own commit.

## Git

No PR flow. Commit and push directly back to whatever branch the doc lives on (often `main`). Pull before every pass; push when the pass is done.

## Common mistakes

| Mistake | Fix |
|---|---|
| Editing content during a review pass | Replies only; the rewrite is a separate, explicitly-requested pass |
| Questions or status reported in chat | The human only reads the doc — put them in doc comments and push |
| Skipping the pull | Web edits diverge silently; pull/fast-forward before touching the doc |
| Duplicate comment ids after a merge | Renumber to the next free id; note it in your reply |
| Stamp and frontmatter out of sync | Update both, every bump |
| Invented or reused timestamps | `date -u`, fresh each pass |
