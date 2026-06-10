# roughneck: confine to launched folder + clean relative URLs

<sub>`Design · 2026-06-10`</sub>

## Problem

roughneck serves a folder's markdown over the LAN by launching stock Roughdraft
(`child.js --project-dir <folder>`). Roughdraft 0.1.9 hardcodes `stateless: true` /
`projectPathRequired: true`, which produces two defects:

1. **No confinement.** The `--project-dir` flag is reported in `/api/status.projectDir`
   but does **not** restrict file access. The client supplies `projectPath` on every
   `/api/markdown-file` request and the server reads whatever it names. Verified: a request
   for `path=CLAUDE.md&projectPath=/Users/claudius/github/icr` (the *parent* of the launched
   folder) returns 200 + content. Effectively a read-any-`.md`-on-the-machine browser.
2. **Ugly, leaky URLs.** Because the SPA derives the project folder from `dirname(?path=)`,
   opening a doc requires the **absolute** path in the URL
   (`?path=/Users/claudius/github/icr/project/icr-v1.md`). A relative `?path=icr-v1.md`
   resolves `projectPath` to `"."` and 400s — a blank page.

A prior fix (`abs()` in `roughneck-enhance.js`) made clicks work by putting the absolute
path in the URL. That entrenched the wrong model and must be reverted.

## Goals

- URLs are clean **relative** paths: `?path=icr-v1.md`.
- The server can **only** read files inside the launched folder (hard 403 on escape).
- **No token.** Bind LAN (`0.0.0.0`) by default; `--local` for loopback only.
- **Keep importing Roughdraft updates.** The security boundary lives in roughneck-owned
  code that depends only on Roughdraft's stable public export, not on patching its compiled
  internals or minified bundle.

## Non-goals (separate, later specs)

- Git sync of edits → GitHub (decided: auto-commit & push to a branch).
- Hosting beyond the LAN + real auth (decided: PaaS — Railway/Fly/Render).

These stack on top of this piece; the gatekeeper below is where their hooks will plug in.

## Key facts (from the installed Roughdraft 0.1.9 source)

- `packages/server/dist/index.js` **exports `createApp(options) → { app }`** (line 231) — a
  real Express 5 app. `createServer(port, projectDir)` (line 906) is a thin wrapper that calls
  `createApp` then `.listen()`.
- `createServer` **refuses to bind a non-loopback host without `ROUGHDRAFT_TOKEN`** (line ~909).
  That guard is the only reason roughneck currently mints tokens. Calling `createApp` directly
  and listening ourselves bypasses it — which is what makes "drop token + bind LAN" possible.
- The token's purpose is to gate `/api/remote-document/*` (routes that can rewrite files on
  connected CLI machines). We don't use remote-document; blocking those routes removes the
  hazard the token guarded.
- Roughdraft is **Express 5** (`5.2.1`). roughneck already carries Express-5-aware patches
  (`ensure_spa_fix` rewrites the `/{*splat}` SPA fallback).

## Design

### New component: `assets/roughneck-server.mjs` (the gatekeeper)

A roughneck-owned Node entry script (~60 lines) launched **instead of** `child.js`.

1. Resolve the installed Roughdraft (same `npm root -g`/`RD_ROOT` logic the CLI uses) and
   `import { createApp } from "<RD_ROOT>/packages/server/dist/index.js"`.
2. `const { app: rd } = createApp({ port, projectDir })` — **no** `remoteDocumentToken`.
3. Build a parent Express app with one **guard** middleware mounted first, then `app.use(rd)`:
   - **Block remote-document:** any request whose path starts with `/api/remote-document/`
     → `404`.
   - **Pin the folder:** for every `/api/*` request, overwrite the `projectPath` query param
     to the launched folder (rewrite `req.url`), ignoring whatever the client sent. This makes
     relative `?path=` work and removes client control of the root.
   - **Confine:** if the request carries a `path` param, resolve it against the folder
     (`path.resolve(folder, value)`); if the result is not inside the folder (prefix check
     after resolving, catches `..` and absolute paths) → `403`.
4. Listen via `http.createServer(parent).listen(port, host)` for the chosen host
   (`0.0.0.0` default, `127.0.0.1` for `--local`). No token guard.

CLI contract: `node roughneck-server.mjs --port <n> --project-dir <abs> --host <bind>`.

### Changes to the `roughneck` bash CLI

- `start_server()`: launch `node "$RN_ASSETS/roughneck-server.mjs" --port "$port"
  --project-dir "$folder" --host "$bind"` instead of `child.js`. Stop generating
  `ROUGHDRAFT_TOKEN`; drop the `token` field from `~/.roughdraft/roughneck.json` and from
  printed/opened URLs.
- `server_for_folder()`: stop reading/printing token; reuse logic unchanged otherwise.
- Keep `ensure_spa_fix` and `ensure_url_fix` (deep links / reload normalization still apply
  to relative paths). Keep `ensure_enhance_patch`.
- `--local` → `BIND=127.0.0.1`; default `BIND=0.0.0.0` (unchanged flags, no token in URL).

### Revert in `assets/roughneck-enhance.js`

Remove the `abs()` helper and its three call sites; links return to relative `f.path` /
`path` (`?path=icr-v1.md`). The gatekeeper now supplies the root server-side.

## Data flow (after)

```
browser ──GET /?path=icr-v1.md──▶ gatekeeper
                                   │  guard: force projectPath=<folder>, confine path,
                                   │         block /api/remote-document/*
                                   ▼
                                  roughdraft app (createApp) ── reads <folder>/icr-v1.md
```

No absolute path in the URL; nothing outside `<folder>` is reachable; no token.

## Testing / acceptance

- **Clean URL open:** clicking a file in the browser opens it; address bar shows
  `?path=icr-v1.md` (no absolute path).
- **Confinement (the hole we found):** `curl ".../api/markdown-file?path=CLAUDE.md&projectPath=/Users/claudius/github/icr"`
  → **not 200** (pinned to the launched folder, parent unreadable).
- **Traversal:** `?path=../../../etc/hosts` (and absolute `path=/etc/hosts`) → **403**.
- **Remote-document blocked:** `curl ".../api/remote-document/anything"` → **404**.
- **LAN, no token:** the bare `http://<host>:<port>/?path=icr-v1.md` loads from another LAN
  device with no token. `--local` binds loopback only (not reachable from the LAN).
- **Update resilience (smoke):** after `npm i -g roughdraft@<same>` + restart, the above all
  still hold (boundary is in our entry, not a patch of their handler).

## Risks / mitigations

- **`createApp` export changes in a future Roughdraft.** Mitigation: the entry fails loudly
  if the import is missing (clear error, not a silent security bypass); pin/observe on upgrade.
- **Express 5 sub-app query rewriting.** Rewrite `req.url` (not just `req.query`) so the
  mounted app re-parses the forced `projectPath`. Covered by the confinement tests.
- **Symlinks inside the folder pointing out.** Prefix check is on the resolved path; a symlink
  whose realpath escapes would pass the string check. Acceptable for v1 (trusted repo content);
  note for hardening if hosting untrusted repos later.
