# Public sharing of private-repo docs (view → guest comments → guest suggestions)

## Problem

Today a margins doc can only be opened by someone logged in with GitHub access to its
repo — the browser fetches content with the **viewer's own** OAuth token. There is no way
to share a doc with someone who is not logged in, even when the doc's owner wants it
public, because the repo is private.

We want an author to mark an individual doc shareable via a property in the markdown file
(default private), so a logged-out visitor can **view** it; and later, optionally, **add
comments** (entering their name) and **suggest** edits. The access flags live in the file
and are editable only by people with write access to the repo.

## Context

- **Auth model:** GitHub **App**, user-to-server OAuth (`app/README.md` §1). The user
  token lives client-side (`app/src/github-auth.ts`); **all** GitHub reads and writes are
  made directly from the browser as the logged-in user. The only server code is the OAuth
  `code → user-token` exchange (`functions/api/auth/[[route]].ts`, `auth/exchange.ts`).
  There is **no server-side token, no app private key configured (only `CLIENT_ID`/
  `CLIENT_SECRET`), and no datastore** (`wrangler.toml` has no KV/D1/R2 bindings).
- **App installation** is used today only to *scope* what the user sees —
  `github-repos.ts` calls `/user/installations/{id}/repositories` (a user-to-server call).
  The App is granted **Contents: read/write** + **Metadata: read** per repo at install.
- **Frontmatter** is already parsed: `app/src/markdown.ts` (`splitYamlFrontmatter`,
  `YamlDocumentMetadataSplit`, `parseYaml`). The sharing flags slot in here.
- **Comments/suggestions** are CriticMarkup (`{>>…<<}`, `{~~…~>…~~}`) stored *in the file*
  and committed back — the same model the editor and the auto-runner depend on
  (`.margins/<docPath>.activity.jsonl`). Keeping public comments in the file preserves the
  single-source-of-truth model.
- **Deploy:** static SPA (`app/dist`) + Pages Functions (`functions/`), project
  `marginsmd`. New endpoints are added under `functions/api/public/*`.

## Access-control model (the file is the source of truth)

Three boolean frontmatter flags, **all default `false`** (absent ⇒ `false`):

```yaml
public: true        # logged-out visitors can VIEW (clean doc)
comments: true      # comment threads shown to + addable by guests (requires public)
suggestions: true   # guests can suggest edits (requires public)  [later phase]
```

- `comments`/`suggestions` are meaningful only with `public: true`; a doc with
  `comments: true` but `public: false` stays fully private.
- The flags are edited by committing the file, so **GitHub enforces "right permissions"**:
  only someone with push access can change them. We do not build a separate permission
  system.
- Exposure scope ("**option B**"): only a file whose *own* frontmatter says `public: true`
  is ever served to a logged-out visitor. Wikilinks/embeds to other docs resolve through
  the same public endpoint, so a link to a non-public doc returns 404 and renders as "not
  shared." No directory browsing, no tree listing.

## Architecture

The crux: a logged-out browser has **no token**, so a server-side credential must fetch
public content and write guest comments. We add a **server-side GitHub-App installation
token** (minted from the App's **private key** → app JWT → installation token, cached in
memory until ~10-min expiry). This is the only genuinely new credential; the file model
and the App's read/write permissions already exist.

### Endpoint: `GET /api/public/doc?owner=…&repo=…&path=…`

1. Mint/lookup the installation token for the App on `owner/repo`.
2. Fetch the file from the **default branch** via the installation token.
3. Parse frontmatter. **If `public` is not exactly `true` → `404`** (indistinguishable
   from "doesn't exist" — never confirms a private file's existence).
4. On `public: true`, return the markdown plus resolved flags `{ comments, suggestions }`.
   If `comments` is `false`, **strip CriticMarkup comments** from the returned body (clean
   read); if `true`, return them intact.

### Client flow (no new URL)

A logged-out visitor opens the normal `…/owner/repo/path` link. With no session the app
calls `/api/public/doc`:
- `200` → render **read-only** (Phase 1: clean doc; comments/suggestions per flags in later
  phases).
- `404` → today's sign-in prompt.

A logged-in user never hits this path — they read directly with their own token as now.

### Hard gating rules (the safety boundary — fail closed)

- Serve a **single file by exact path** only; never a tree/listing.
- Serve **only** from the default branch; arbitrary refs refused.
- Serve **only** if the file's *own* frontmatter has `public: true`.
- Malformed frontmatter, app-not-installed, missing file, non-default ref → **all 404**.
- Public reads are edge-cacheable with a **short TTL**; flipping `public` off goes live
  within the TTL window (explicit cache purge can be added later).

## Share UI

A **Share** button in the document toolbar opens a popover:

- Toggles for the **shipped** phases only (no dead switches): **Public**, then **Comments**,
  then **Suggestions**. `Comments`/`Suggestions` are disabled until `Public` is on.
- When `Public` is on: the copyable public link (the same `…/owner/repo/path` URL).
- A one-line warning under **Comments**: "Turns the existing comment threads public."

**Permission handling (read vs write):**

- Read the viewer's repo permission (`permissions.push` from repo metadata; the app already
  knows the repo via installations).
- `push: true` → toggles interactive; flipping one **edits the frontmatter and commits** the
  file as the logged-in user (reuses today's commit path). GitHub history is the audit trail.
- `push: false` → toggles read-only (shown for transparency); **Copy link** still works if
  already public.
- App **not installed** on the repo → Share panel shows an **install prompt** (the one case
  surfaced, since it's the owner's own repo and the fix is theirs).

**Frontmatter editing mechanics:** a helper sets/merges a single key in the YAML frontmatter
**without disturbing the body or other keys** (`version`, `tags`, …), via the existing
`splitYamlFrontmatter` round-trip. A doc with no frontmatter gets a minimal block added.

## Guest comments (Phase 2)

**Viewing:** with `public: true` + `comments: true`, the endpoint returns CriticMarkup
intact and the client shows the comment rail (read + reply). With `comments: false`,
comments are stripped (Phase 1 clean read).

**Guest identity:** the visitor types a name once, kept in `localStorage`. Attribution uses
a CriticMarkup field that **cannot impersonate a GitHub user** — `by="Jane Doe"
guest="true"`, rendered "Jane Doe (guest)" with a distinct style.

**Write path — constrained, never "submit a file":**
`POST /api/public/comment` with `{ owner, repo, path, anchor, text, authorName, turnstileToken }`.
The server:
1. **Re-gates**: re-reads frontmatter; requires `public: true` *and* `comments: true`.
2. **Verifies Turnstile** and the per-IP rate limit.
3. **Applies the mutation server-side** using the same CriticMarkup insertion logic the
   editor uses — inserts **one comment at the given anchor and nothing else**. The anonymous
   client sends only the comment + anchor, **never file content**, bounding a guest to "add
   a comment thread."
4. **Commits** via the installation token, authored as the **App/bot** (`margins[bot]`),
   message `Public comment by <name> (guest) on <path>`. Uses the blob SHA for optimistic
   concurrency; on conflict, re-read + retry once.
5. Returns the updated doc so the rail refreshes.

**Anchoring** reuses the app's existing comment-anchor scheme (quoted text + position); the
server validates the anchor still exists before inserting, else 409.

## Guest suggestions (Phase 3)

Same write path with suggestion markup (`{~~old~>new~~}`) instead of a comment, gated by
`suggestions: true`. The owner accepts/rejects later in the normal editor.

## Abuse mitigation

Anonymous writes to someone's repo need a guard. v1:
- **Cloudflare Turnstile** (invisible CAPTCHA) on the guest comment/suggestion form.
- Per-IP **edge rate limit** and a **max comment length**.
- Moderation is free: owners delete a guest comment by editing like any other.

## Error handling (fail closed)

- All "not allowed / not found" conditions collapse to **404** for `/api/public/doc` — no
  existence leak.
- Installation-token mint failure → 503 with a generic message.
- Comment write: gating fail → 403; anchor not found / conflict → 409 (retry once); Turnstile
  / rate-limit fail → 429 with a clear message.
- Frontmatter malformed → treated as private (fail closed).

## Testing (the security boundary is the heart)

- **Gating units:** `public` true/false/missing/malformed → serve vs 404; `comments` off →
  CriticMarkup stripped; non-default ref refused; tree/listing never exposed.
- **Guest path:** attribution scheme cannot mint a real-user identity; server inserts **only**
  a comment at a valid anchor and **rejects any attempt to send file content**; anchor-not-found
  → 409.
- **Permissions:** `push:true` → editable toggles; `false` → read-only + copy.
- **Frontmatter editing:** single-key set/merge preserves body + other keys; adds a block when
  absent.
- **Integration:** anon view flow; anon comment flow (Turnstile mocked).

## Config / secrets

- Add the App **private key** + **App ID** as Cloudflare secrets (installation-token minting).
- Add **Turnstile** site + secret keys.
- Confirm the App installation permission: Contents **read** (Phase 1), Contents **read+write**
  (Phases 2–3).

## Phasing

1. **Phase 1 — Public view:** `/api/public/doc`, gating, logged-out read-only render, Share
   panel with the **Public** toggle + copy link.
2. **Phase 2 — Guest comments:** `comments` flag, guest rail, `/api/public/comment`, guest
   identity, Turnstile + rate limit.
3. **Phase 3 — Guest suggestions:** `suggestions` flag, same write path with suggestion markup.

## Out of scope (YAGNI)

Collaborator notifications on new guest comments; guest editing of the body; a moderation
queue; per-doc commenter allowlists; threaded guest replies beyond what CriticMarkup gives;
explicit edge-cache purge on flag change (short TTL covers v1).
