# roughneck: browser-only, GitHub-backed markdown reviewer

<sub>`Design · 2026-06-10 · MVP`</sub>

## Vision

A **roughneck** web app (lives in the `recodelabs/roughneck` repo — same product, not a new
repo). A static site you can run **hosted in the cloud OR locally**. You log in with GitHub,
point it at a repo you have access to, and **browse + edit + comment** that repo's markdown in
the Roughdraft (Tiptap/CriticMarkup) editor. A **commit button writes changes straight back to
GitHub**, authored as the logged-in user. No backend database, no server process, no stored
content — the browser talks directly to the GitHub API; the Ona team keeps syncing the repo
down normally.

"Get something working, then make it better": this spec is the **MVP** — the full
login → pick repo/branch → browse → open → edit/comment → commit loop, and nothing more.

## Where it lives

- In the existing **`recodelabs/roughneck`** repo, new directory **`app/`** (the SPA) and
  **`app/functions/`** (the one auth function). The existing LAN CLI (`roughneck` bash tool,
  the gatekeeper) stays as-is; this is a second way to use roughneck.
- The SPA is started from a **fork/copy of the MIT-licensed `Lex-Inc/roughdraft`** frontend
  (dormant upstream — we own it; no upstream-merge obligation), vendored under `app/`.

## Approach (A: reuse Roughdraft's frontend, add a data layer)

Roughdraft's app already has a pluggable `StorageBackend` interface
(`packages/app/src/storage.ts`) with implementations chosen by `detect-backend.ts`. We add one
more — **`github-backend.ts`** — and select it when the app is in "GitHub mode". The editor +
CriticMarkup UI is reused unchanged.

### The seam (verified in upstream source)

```ts
interface StorageBackend {
  info: BackendInfo;                 // add kind: "github"
  canManageProjects: boolean;
  getMarkdownFile(relativePath): Promise<Page>;            // Page = {id,title,content,version}
  saveMarkdownFile(relativePath, content, expectedVersion?): Promise<Page | undefined>;
  watchMarkdownFile?(...): () => void;                     // OPTIONAL — omitted (no server push)
  completeReview?(...): Promise<CompleteReviewResult>;     // OPTIONAL — omitted
  getReviewWatchStatus?(...): Promise<ReviewWatchStatus>;  // OPTIONAL — omitted
  saveAsset(file): Promise<StoredAsset>;                   // MVP: throw "not supported yet"
  resolveFileUrl(path): string | null;                    // GitHub raw URL
  openProject(path): Promise<void>;
}
```

The conflict model maps perfectly onto GitHub: `Page.version` = the file's **blob SHA**;
`saveMarkdownFile` sends that SHA, and a GitHub 409 (SHA moved) becomes the existing
`MarkdownFileConflictError` (which carries the current `Page` for reload/merge — UI already
handles it).

## Components (small, well-bounded)

1. **roughneck SPA** (`app/`) — forked Roughdraft, static Vite build. Unchanged except the new
   backend + a small repo/branch/file picker.
2. **`github-backend.ts`** — the `StorageBackend` implementation. The only substantial new
   frontend code. Pure GitHub REST client; takes the user token + `{owner, repo, branch}`.
3. **Auth function** (`app/functions/`) — one stateless serverless endpoint
   (`/api/auth/callback`). Holds the GitHub App client secret; exchanges OAuth `code` → user
   token; **stores nothing**.

A small **repo/branch + file picker** UI is needed because core Roughdraft is single-document
oriented (the file tree you've used was added by *roughneck*, not Roughdraft). MVP picker: an
input for `owner/repo` + branch select, then a list of `.md` paths from the Git Trees API.

## Auth & permissions

- **GitHub App** (not a classic OAuth app): users install it on the specific repos/orgs they
  choose, so it can only ever touch granted repos — permissions enforced by GitHub.
- Flow: **Login with GitHub** (OAuth web flow, `state` for CSRF) → redirect back with `code` →
  the auth function swaps it (with the client secret) for a **user-to-server token** → token
  returned to the browser.
- Token lives **only in the browser** (`sessionStorage` + in-memory; dies with the tab).
- Identity for CriticMarkup author comes from `GET /user` (the GitHub `login`).

## Data flow

1. Login with GitHub → token in browser.
2. Enter `owner/repo`, pick branch.
3. **Browse:** `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` → filter `*.md` → picker.
4. **Open:** `GET /repos/{o}/{r}/contents/{path}?ref={branch}` → base64-decode → `Page` with
   `version` = blob `sha`.
5. **Edit/comment:** existing Tiptap/CriticMarkup; comment author = GitHub `login`.
6. **Save (commit):** `PUT /repos/{o}/{r}/contents/{path}` with `{message, content(base64),
   sha: version, branch}` → one commit, authored as the user. On 409 → `MarkdownFileConflictError`.
7. **Draft safety:** uncommitted content kept in `sessionStorage` keyed by
   `owner/repo@branch:path`; cleared on successful commit.

## Running it — both modes

The same SPA + auth function run in two environments; the only difference is config (GitHub App
OAuth callback URL + where the function runs):

- **Local:** `npm run dev` in `app/` starts the Vite dev server (e.g. `localhost:5173`) and the
  auth function locally (platform dev server, e.g. `wrangler dev`/`vercel dev`, or a tiny local
  node handler). The GitHub App registers `http://localhost:5173/...` as an allowed callback.
  A `roughneck app` CLI subcommand may wrap this later (nice-to-have, not MVP).
- **Hosted:** the built static site + the function deployed to one platform that serves both
  (Cloudflare Pages + Functions, or Vercel/Netlify). The GitHub App registers the production
  callback URL. No DB, no server process.

The function reads its client secret from env in both modes; nothing else differs.

## Decisions (baked in)

- **Commit target:** each Save commits directly to the **selected branch** (default = repo
  default), one commit per save. Not auto-PR (a "propose as PR" button is a later nicety).
- **Comments are commits:** a CriticMarkup comment is just an edit to the `.md`, committed by
  the same button. No separate comment store (there is no backend).
- **Identity** from `GET /user` at login.

## Out of scope for MVP (the "make it better" list)

- `watchMarkdownFile` live updates; optional polling later.
- `completeReview` / review hand-off, asset upload (`saveAsset` throws a clear "not yet").
- "Propose as PR" button, multi-file batch commits, fancy install/permissions UI,
  conflict *auto-merge* (we surface the conflict; manual reload for now).
- `roughneck app` CLI subcommand wrapper for local dev (use `npm run dev` for MVP).

## Security considerations

- Browser-held token ⇒ **XSS = token theft.** Lock the SPA down: strict CSP, no untrusted
  third-party scripts, careful markdown/HTML rendering in the editor.
- OAuth `state` for CSRF on the login round-trip.
- `sessionStorage` (not `localStorage`) so the token is not persisted across sessions.
- The auth function is a pure relay: client secret in env, never logs/stores the token or code.

## Testing strategy

- **`github-backend.ts` unit tests** with a mocked `fetch`: read decodes content + sets
  `version` from `sha`; save sends the right PUT body; a 409 throws `MarkdownFileConflictError`
  carrying the refreshed `Page`; tree listing filters `*.md`.
- **Auth function test:** given a `code`, calls GitHub's token endpoint and returns the token;
  never echoes the client secret; rejects a missing/blank `code`.
- **Manual end-to-end (local first, then hosted):** against a real test repo — login, browse,
  open, edit, commit, verify the commit appears on GitHub authored as the user; force a conflict
  (edit on GitHub between open and save) and confirm the conflict path fires.

## Risks

- **App-shell navigation seam:** confirm Roughdraft's routing cleanly accommodates the
  repo/branch/file picker (it's single-document oriented). Retire this in the first build step;
  if the shell resists, the picker becomes a thin wrapper view that sets the backend's
  `{owner,repo,branch,path}` and mounts the existing editor.
- **GitHub Contents API size limit** (~1 MB / file). Large docs may need the Blobs API on read.
  Note now; handle if hit.
