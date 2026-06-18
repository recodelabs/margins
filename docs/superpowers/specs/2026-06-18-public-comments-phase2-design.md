# Public sharing Phase 2 — guest comments (read + write)

Builds on `2026-06-17-public-sharing-design.md` (the overarching view → comment → suggest
design) and the shipped Phase 1 (public read-only view). This spec is the implementation
design for **guest comments**: logged-out visitors can both **see** existing comment
threads on a public doc and **add** their own (a new anchored comment, or a reply to an
existing thread), entering a display name.

Suggestions (`{~~old~>new~~}`) remain Phase 3 and are out of scope here.

## Decisions (locked in brainstorming)

- **Scope:** full read **and** write guest commenting in this round.
- **Both comment modes:** (a) new comment on a selected span, and (b) reply to an existing
  thread.
- **Abuse guard:** a **Cloudflare-native rate-limiting rule** on the write endpoint
  (dashboard/WAF config, not code) plus code-level validation (max length, required
  fields, re-gate). **No Turnstile, no KV/datastore** in v1.

## Context (what already exists)

- **Server install token:** `lib/installation-token.ts` mints/caches a GitHub App
  installation token; `lib/app-jwt.ts` signs the App JWT. Live in prod (App
  `margins-md`, id 4022236, installed org-wide, Contents: read/write). This is the
  credential the write path commits with.
- **Read endpoint:** `functions/api/public/doc.ts` → `lib/public-doc.ts`. Today it always
  strips CriticMarkup and returns `comments:false` ("Phase 1A: comments not yet shipped").
- **Flag model:** `lib/sharing-flags.ts` already parses `public` / `comments` /
  `suggestions` from frontmatter (fail-closed). No code change needed to *read* the flag.
- **Framework-free `lib/` pattern:** `lib/strip-critic-markup.ts`, `lib/sharing-flags.ts`
  are small, dependency-free, unit-tested server modules. The new insertion helper follows
  this pattern.
- **Comment format (client):** `app/src/critic-markup/index.ts` serializes a thread as
  `{==anchorText==}` followed by one or more `{>>content<<}{metadata}` blocks; replies are
  modeled via `parentCommentId` (`app/src/critic-markup/comment-threads.ts`). This 41 KB
  module is editor-coupled and is **not** reused server-side.
- **Client public read:** `app/src/public-backend.ts` (`PublicBackend`) is read-only today;
  all writes reject. `app/src/SharePopover.tsx` exposes only the **Public** toggle.

## Architecture

Four pieces, each with a single responsibility:

1. **`lib/insert-public-comment.ts`** (new, framework-free) — the one place that knows how
   to splice a guest comment into markdown as CriticMarkup. Pure function, no I/O.
2. **`lib/public-doc.ts`** (change) — serve CriticMarkup intact when `comments:true`.
3. **`functions/api/public/comment.ts`** + `lib/public-comment.ts` (new) — the gated write
   endpoint; re-gate, validate, insert (via #1), commit via the installation token.
4. **Client** — `PublicBackend.addComment(...)`, guest-name capture, and rendering the
   comment rail in the public read-only view + a Comments toggle in the Share popover.

### 1. `lib/insert-public-comment.ts` (the insertion boundary)

Pure, framework-free, fully unit-tested. Two modes, one helper:

```
insertPublicComment(markdown, {
  mode: "new" | "reply",
  // mode "new":   anchor = { quote, occurrence } — the selected text + which occurrence
  // mode "reply": parentId = id of the comment being replied to
  text, authorName, id, atIso,
}) -> { markdown } | throws AnchorError
```

- **mode "new":** find the `occurrence`-th plain-text match of `quote` in the **body**
  (outside the frontmatter block and outside any existing `{==…==}`/`{>>…<<}` markup); wrap
  it as `{==quote==}{>>text<<}{metadata}`. If the quote isn't found cleanly, or overlaps
  existing markup, throw `AnchorError` → endpoint returns 409.
- **mode "reply":** locate the existing thread anchored by the comment with `parentId` and
  append a `{>>text<<}{metadata}` block carrying `parent="<parentId>"`. If `parentId` isn't
  present, throw `AnchorError` → 409.
- **metadata:** reuse the existing attribute shape (`id`, `by`, `at`) and add
  **`guest="true"`**. Guest attribution renders "Name (guest)" and **cannot** mint a real
  GitHub-user identity (no `authorId`/user fields). `id` and `at` are supplied by the
  caller (the endpoint), keeping this function deterministic/testable.

This helper does **no** anchor *quality* judgement beyond "found exactly / not found"; it
is the security-critical unit and gets the heaviest tests.

### 2. `lib/public-doc.ts` change (read side)

Replace the hardcoded strip with flag-driven behavior:

- `public:true` + `comments:true` → return the body **with CriticMarkup intact** and
  `{ comments: true, suggestions: false }`.
- `public:true` + `comments:false` (or absent) → unchanged: strip CriticMarkup, return
  `{ comments: false }`.
- All other conditions → unchanged (404 fail-closed). Cache headers unchanged from the
  prior fix (200 `max-age=10`, 404 `no-store`).

### 3. `POST /api/public/comment` (write side)

`functions/api/public/comment.ts` (thin, like `doc.ts`) → `lib/public-comment.ts`
(`handlePublicComment(env, body)`), so the logic is unit-testable off the Function.

Request body: `{ owner, repo, path, mode, text, authorName, anchor?, parentId? }`
(`anchor` for mode "new", `parentId` for mode "reply").

Steps:
1. **Validate shape** — required fields per mode; `text` non-empty and ≤ **MAX_COMMENT_LEN**
   (e.g. 2000 chars); `authorName` non-empty, trimmed, ≤ **MAX_NAME_LEN** (e.g. 60); path is
   a safe markdown path (reuse `isSafeMarkdownPath`). Bad shape → **400** `no-store`.
2. **Mint token** — `getInstallationToken(env, owner, repo)`; failure → **404** (same
   fail-closed/no-existence-leak posture as the read path).
3. **Fetch + re-gate** — GET the file (default branch) via the token; parse frontmatter;
   require `public:true` **and** `comments:true`. Otherwise → **403**. Capture the blob
   `sha` for the commit.
4. **Insert** — call `insertPublicComment(...)` with a server-generated `id` and `at`
   (ISO). `AnchorError` → **409**.
5. **Commit** — PUT the contents API with the new body, `sha`, author/committer
   `margins[bot]`, message `Public comment by <name> (guest) on <path>`. On 409 (sha
   conflict) re-read + retry **once**; still failing → **409**.
6. **Return** the updated doc payload (same shape as `/api/public/doc` 200) so the rail
   refreshes without a second fetch. Response `Cache-Control: no-store`.

The browser sends **only** `{mode, text, authorName, anchor|parentId}` — **never file
content**. The server is the only writer of the body. That bound — "a guest can add a
comment thread and nothing else" — is the security boundary.

### 4. Client

- **`PublicBackend`** gains `addComment(input)` → `POST /api/public/comment`, returning the
  refreshed doc; maps 403/409/429 to clear messages. Everything else stays read-only
  (`saveMarkdownFile` etc. still reject).
- **Guest identity:** prompt for a display name once on first comment; persist in
  `localStorage` (`margins:guest-name`). Editable. Never sent as a GitHub identity.
- **Rail in public view:** when the loaded public doc reports `comments:true`, render the
  existing threads (reuse the read-only rail components, fed from `PublicBackend`'s parsed
  CriticMarkup) and enable "add comment" on a text selection + "reply" on a thread. When
  `comments:false`, no rail (today's clean read).
- **Share popover:** add a **Comments** toggle (disabled until **Public** is on), per the
  overarching spec — flipping it edits the `comments` frontmatter key and commits as the
  logged-in owner (reuses the existing `sharing-frontmatter` set/commit path). One-line
  warning: "Turns the existing comment threads public."

## Abuse mitigation (v1)

- **Cloudflare rate-limiting rule** on `POST /api/public/comment` (path + method match),
  configured in the dashboard. Documented in `docs/deploy-cloudflare.md` with the exact
  rule (threshold, window, action). It is **infra config, not code** — the endpoint does
  not implement counting.
- **Code-level:** `MAX_COMMENT_LEN`, `MAX_NAME_LEN`, required-field validation, and the
  re-gate. Optional hidden honeypot field rejected if filled.
- **Moderation is free:** the owner edits/deletes a guest comment like any other CriticMarkup
  in the normal editor; GitHub history is the audit trail.

## Error handling (fail closed)

| Condition                                   | Status |
|---------------------------------------------|--------|
| Malformed body / over-length / bad path     | 400 (no-store) |
| App not installed / token mint fail / missing file / not public | 404 |
| `public:true` but `comments:false`          | 403 |
| Anchor not found / overlaps markup / parent missing | 409 |
| sha conflict after one retry                | 409 |
| Rate limit (Cloudflare rule)                | 429 (from the edge) |
| Success                                     | 200 (no-store) |

## Testing (the boundary is the heart)

- **`insert-public-comment` units:** new-anchor wrap at the right occurrence; quote not
  found → AnchorError; quote inside frontmatter ignored; quote overlapping existing markup
  → AnchorError; reply appends under the right parent; reply to missing parent →
  AnchorError; `guest="true"` always present; never emits user-identity attributes.
- **`public-comment` units (fetch mocked):** re-gate `comments:false` → 403; not public →
  404; over-length → 400; happy path commits expected body + `margins[bot]` + message; sha
  conflict retries once then 409; **rejects any attempt to pass file content** (no such
  field is honored).
- **`public-doc` units:** `comments:true` → CriticMarkup preserved + `comments:true`;
  `comments:false` → stripped (existing tests stay green).
- **Client:** guest name persists/edits; add-comment and reply flows call the endpoint with
  the right payload and refresh the rail; read-only writes still reject; Share Comments
  toggle commits the frontmatter key.
- All server tests run under the **node** vitest environment (Web Crypto), per the existing
  `// @vitest-environment node` convention.

## Config / deploy

- No new secrets (App credentials already set). No new wrangler bindings (no KV).
- Add the Cloudflare rate-limit rule (dashboard) + document it.
- App permission already sufficient (Contents: read/write).

## Out of scope (YAGNI)

Turnstile/CAPTCHA; KV-based in-code rate limiting; guest suggestions (Phase 3); guest
editing of the body; owner notifications on new guest comments; a moderation queue;
threaded replies deeper than the existing CriticMarkup parent model; explicit edge-cache
purge on flag change (short TTL covers it).
