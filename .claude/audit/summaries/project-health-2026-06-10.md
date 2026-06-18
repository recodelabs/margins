# Roughneck / "margins" — Principal-Level Repository Audit
Date: 2026-06-10 · Scope: full repo, depth-weighted to `app/src` (the 80% that matters) · Analysis only, no code modified.

## Executive Summary

**Overall health: C+ (68/100).** This is a capable, fast-moving MVP with real craftsmanship in places — a clean storage-backend contract with five implementations and a typed conflict model, boundary-mocked tests that assert genuine protocol behavior, and properly lazy-loaded Mermaid — undermined by the absence of any safety net and a few sharp edges. The single most important fact: **there is no CI, the unit suite is currently red on `main`, and the entire Playwright e2e suite cannot run at all** — so nothing is enforcing correctness, and that vacuum has already let a failing test and a rotted test suite sit unnoticed. On security, document-body markdown is XSS-safe by construction, but Mermaid diagrams render with `securityLevel: "loose"` via `innerHTML`, giving untrusted third-party diagram source a path to execute script and exfiltrate the repo-write GitHub token from `sessionStorage`. The codebase also suffers a split-brain identity (a legacy bash CLI and the React app share a name but nothing else) and three god files holding 40% of the app, including ~350 lines of quadruplicated editor logic in the riskiest file. None of this is unrecoverable; the raw materials for a healthy project (strict TS, a real test suite, a committed lockfile, zero dependency CVEs) are already here.

- **Top 3 risks:** (1) No CI + red suite + dead e2e → regressions ship silently. (2) Mermaid `loose`+`innerHTML` stored-XSS → GitHub token theft. (3) Per-keystroke full-document re-serialization and 1.9 MB single chunk → poor large-doc and first-load UX.
- **Top 3 opportunities:** (1) A ~1-hour CI gate + one-line test fix instantly stops the bleeding. (2) Two-line Mermaid hardening (`strict`) + a CSP closes the token-exfil path. (3) Extracting the duplicated suggesting-mode engine from `PageCard.tsx` de-risks the highest-churn code and unlocks the test that already exists for it.

| Dimension | Grade | Score | One-line justification |
|---|---|---|---|
| Architecture | C+ | 70 | Real backend contract, but god files, triple-mirrored save state, split-brain repo. |
| Security | C+ | 68 | Body markdown safe by construction; Mermaid XSS + no CSP are the gaps. |
| Performance | C | 65 | Lazy Mermaid is good; per-keystroke re-serialize + 1.9 MB bundle + uncached API are not. |
| Testing | C | 62 | Strong unit quality, but red on main, e2e unrunnable, no coverage enforcement. |
| Dependencies/DevEx | B− | 76 | Zero CVEs, strict TS, lockfile committed; no lint/CI, doc errors, public/ junk. |

---

## Repo Map

**Purpose.** A browser-only, GitHub-backed markdown reviewer (UI brand: **"margins"**). Log in with GitHub App OAuth, point at `owner/repo@branch`, browse `.md` files, edit and comment in a Tiptap/ProseMirror CriticMarkup editor, and **Save** to commit straight back to GitHub via the Contents API. No backend storage; the browser talks directly to the GitHub API. The only server-side piece is a stateless OAuth token exchange.

**Stack.** React 19 + Vite 6 + TypeScript 5.9 (strict). Tiptap 3 (pinned `3.22.4` + overrides), CodeMirror 6 (code view), Mermaid 11 (diagrams), `marked` (MD→HTML) + `turndown`/`@joplin/turndown-plugin-gfm` (HTML→MD) round-trip pipeline, Tailwind v4, shadcn CSS. Deploy target: Cloudflare Pages (`wrangler.toml` → project `marginsmd`, output `app/dist`) with one Pages Function for `/api/auth/*`. Test: Vitest (261 unit tests) + Playwright e2e (currently non-functional).

**Architecture sketch.**
```
Browser SPA (app/dist)  ──Bearer token──►  api.github.com (tree, contents, commits)
      │  token via #fragment
      ▼
/api/auth/{login,callback}  ──client_secret──►  github.com/login/oauth   (Cloudflare Pages Function
  (functions/api/auth/[[route]].ts,                                       = prod; Vite middleware = dev;
   shared core: auth/exchange.ts)                                         shared exchangeCodeForToken)
```
Inside the SPA: `App.tsx` orchestrates → `detect-backend.ts` picks one of five `StorageBackend` impls (github / api / remote / local-storage / preview, contract in `storage.ts`) → `DocumentWorkspace.tsx` → `PageCard.tsx` (editor kernel + autosave) → comment rail / review rail / Mermaid overlays.

**Key directories.**
| Path | What it is |
|---|---|
| `app/src/` | The product. ~15 k LOC TS/TSX; the 80% that matters. |
| `app/src/*-backend.ts`, `storage.ts` | The data layer: one interface, five implementations, typed conflict error. |
| `auth/`, `functions/api/auth/` | Stateless OAuth token exchange (shared core + Cloudflare Function wrapper). |
| `app/e2e/`, `app/test/`, `app/src/*.test.ts` | Tests. Unit = real & mostly good; e2e = transplanted, broken. |
| `roughneck` (bash), `assets/` | **Legacy half.** A LAN CLI that patches a globally-installed `roughdraft` npm package. Unrelated to `app/`. |
| `docs/`, `README.md`, `app/README.md` | Docs — split and partly stale (see findings). |

**What surprised me.** (1) The root `README.md` documents *only* the legacy bash CLI and never mentions the deployed app that is 95% of the repo's activity. (2) `App.tsx` is ~65% upstream marketing/brand content for a *different* product (roughdraft.md), and that marketing homepage is what a "margins" user sees as the **error page** when a document fails to load. (3) The Playwright suite imports a `server/` directory that does not exist anywhere in the repo.

---

## Audit Report

Severity is consequence-based. Findings are tagged **[Fact]** (verifiable in code) or **[Judgment]** (assessment). IDs are referenced by the Task Plan.

### Critical

- **T-1 · No CI exists. [Fact]** No `.github/` directory or CI config anywhere. Nothing runs `vitest`, `tsc -b`, or the build on push/PR; the only deploy gate is Cloudflare Pages auto-build. *Consequence:* a red suite and a rotted e2e suite both reached `main` unnoticed — this finding is the root cause of T-2 and T-3.
- **T-2 · Playwright e2e suite is completely unrunnable. [Fact]** `app/e2e/start-api.ts:1` imports `../../server/src/index` — **no `server/` exists**. `@playwright/test`/`tsx` are not dependencies; `playwright.config.ts:27,34` shells out to `pnpm` in an npm repo; `helpers.ts:111` logs `source: "packages/app/e2e"` (transplanted from a monorepo). ~1,660 lines of e2e code look like coverage but provide zero protection.

### High

- **SEC-1 · Mermaid stored-XSS → GitHub token exfiltration. [Fact + Judgment]** `MermaidOverlays.tsx:184` sets `securityLevel: "loose"`; SVG output is injected via `innerHTML` (`:327`, `:66`). Diagram source is arbitrary third-party GitHub markdown. "loose" permits HTML-in-labels and `javascript:` handlers, so a malicious diagram executes script in the app origin and can read the repo-**write** token at `sessionStorage["roughneck.gh.token"]`. Same flaw in the legacy `assets/roughneck-enhance.js:109/155/75`. This is the one practical token-theft path against untrusted content.
- **TEST-1 · Unit suite is red on a clean `main`. [Fact]** `vitest run` → 1 failed / 260 passed. `test/homepage-metadata.test.ts:29` expects `"Roughdraft - Markdown reviews for coding agents"`; `app/index.html:6` now says `margins` (rebrand). A permanent failure trains everyone to ignore the suite. (One-line fix; severity is from the signal-rot, not the effort.)
- **ARCH-1 · `App.tsx` (1,991 lines) is three apps in one. [Fact]** Only lines 1479–1991 are the real `App`; ~1,300 lines are upstream marketing (`Homepage`, workflow mocks, `RoughdraftFlavoredMarkdownPage`) for roughdraft.md. Seams are clean (no shared state) — extractable with near-zero risk.
- **ARCH-2 · `PageCard.tsx` (2,411 lines): ~350 lines of quadruplicated suggesting-mode transaction logic. [Fact]** The "collect addition/original segments, delete additions, mark originals" block is copy-pasted in paste (`801–887`), text-input (`913–999`), cut (`1070–1107`), and backspace/delete (`1176–1211`). A fix to one copy must be hand-replicated three times — in the app's single highest-risk, silent-data-loss-prone file. `suggesting-mode.test.ts` (755 lines) already tests a *hand-copied fork* of this logic, not the production code.
- **ARCH-3 · Save/dirty state lives in three+ synchronized copies. [Fact]** Computed in `PageCardEditorSurface` → mirrored in `PageCard` (`2381–2385`) → mirrored in `DocumentWorkspace` (`297,315–321`) → mirrored again in `App` + a ref (`1490–1491,1726–1732`), each via callback. Divergence is invisible in types and surfaces as wrong beforeunload/handoff behavior.
- **PERF-1 · Whole document re-serialized (JSON→HTML→Turndown) on every keystroke. [Fact]** `PageCard.tsx:1222` `onUpdate` → `editorStateToCriticMarkdown` (`critic-markup/index.ts:1489`) runs `generateHTML` over the full doc and **news a TurndownService per call** (`:1495`). Only the network save is debounced (`:2197`); serialization is not. Typing latency is O(doc size) — tens of ms/keystroke near the 1 MB ceiling.
- **PERF-2 · 1.9 MB entry chunk (605 KB gzip), no splitting. [Fact]** `app/dist/assets/index-*.js` = 1,895,126 B. `vite.config.ts:58` only raises `chunkSizeWarningLimit` (silences the warning); no `manualChunks`, zero `React.lazy`. The login screen pays the full editor + CodeMirror bundle before showing a button.
- **PERF-3 · GitHub API: no caching/ETags, no 403/429 handling, per-keystroke tree fetches, full-reload nav. [Fact]** `github-backend.ts:60,129` plain `fetch`, no `If-None-Match`; `GitHubPicker.tsx:148` refetches the recursive tree per keystroke of `owner/repo`/branch; navigation via `window.location.assign` (`:210`) reboots the whole app and refetches on every file open. Rate-limited users just see `"GitHub tree failed (403)"`.
- **DEP-1 · No linter/formatter anywhere. [Fact]** No ESLint/Prettier/Biome config in `app/` or root. Nothing enforces style or catches a class of bugs pre-merge.
- **DOC-1 · `docs/deploy-cloudflare.md` is wrong on two load-bearing facts. [Fact]** Claims `app/public/_redirects` is "already committed" — **it does not exist**. Tells you to set the OAuth secret on project `roughneck-web`, but `wrangler.toml` deploys `marginsmd` — following the doc puts the secret on the wrong project. Active deploy footgun.

### Medium

- **SEC-2 · Token in the 302 `Location` fragment. [Fact]** `functions/api/auth/[[route]].ts:25` (and dev mirror `vite.config.ts:33`) redirect to `…/#token=…`. Any edge/proxy/access log recording response headers captures a live token; `no-store` doesn't prevent logging.
- **SEC-3 · No CSP / security headers. [Fact]** No `_headers` file, no CSP meta. A `script-src`/`connect-src` CSP would blunt SEC-1.
- **SEC-4 · Live OAuth client secret in working-tree `app/.env`. [Fact]** Real client ID + 40-hex secret on disk. *Positive:* `.env` is gitignored, untracked, and **absent from git history** (verified). Recommend rotating regardless, since it sits in cleartext and was surfaced during this audit.
- **SEC-5 · Legacy CLI patches a globally-installed npm package + loads CDN Mermaid without SRI. [Fact]** `roughneck:41–73` rewrites `roughdraft`'s dist on every run; `assets/roughneck-enhance.js:106` imports `mermaid@11` from jsdelivr with no integrity hash. Supply-chain/persistence footgun on the legacy half.
- **ARCH-4 · Backend behavior switched on `info.kind`/`instanceof`, and `info.detail` doubles as a document path. [Fact]** `manualCommit={backend?.info.kind === "github"}` (`App.tsx:1986`), `instanceof RemoteBackend` (`RemoteSessionBanner.tsx:14`); `documentPath = detectedBackend.info.detail` (`App.tsx:1596`) routes off a human-readable label. The contract exists (`storage.ts:52`) but lacks a capabilities flag and a real `documentPath()` accessor; adding a sixth backend means auditing scattered checks.
- **ARCH-5 · Marketing homepage is the production error page. [Judgment]** With `VITE_GITHUB_MODE=1` (the deployed config), the only route to `Homepage` is `loadError` (`App.tsx:1928`). A user whose doc fails to load sees the roughdraft.md sales page ("Install now") with the error as subtitle. `RoughdraftFormatDemo.tsx` (211 lines) is reachable only this way — dead in deploy, alive in code.
- **ARCH-6 · Two routing schemes interleaved with no router + no `popstate` in App. [Fact]** `app-navigation.ts` and `github-route.ts` both parse the URL; `getRequestedPathState()` runs against GitHub URLs and is overridden by `isGitHubMode()` at five points (`App.tsx:1550,1610,1630,1928,1953`). Only `GitHubPicker` listens for `popstate`; workspace links are full-page reloads.
- **PERF-4 · MermaidOverlays runs body-wide MutationObservers + unthrottled scroll reflow. [Fact]** Two `subtree:true` observers (editor + `document.body`) schedule a document-wide `querySelectorAll` on every keystroke even with zero diagrams (`:348–378`); scroll handler interleaves rect reads with writes → one forced reflow per diagram per scroll event (`:224,291`).
- **PERF-5 · Comment-anchor layout remeasured on every keystroke *and* cursor move. [Fact]** `useCommentAnchorLayout.ts:95` subscribes to both `update` and `selectionUpdate`; each does `querySelectorAll` + per-anchor `getBoundingClientRect` + setState. Selection changes don't move anchors — that subscription is wasted work.
- **PERF-6 · Large files (>1 MB) silently decode to an empty document. [Fact]** `github-backend.ts:60` — the Contents API returns `"content":""` for 1–100 MB files; `decodeBase64("")→""` opens an **empty editor** for a real file with no error; a later commit overwrites it with emptiness (manual Commit gates it, nothing warns). `app/README.md:129` says such files "may fail to load" — they load *wrong*.
- **TEST-2 · Coverage thresholds are dead config; core modules untested. [Fact]** `vitest.config.ts:16` declares v8 thresholds (60/60/50/60) but `@vitest/coverage-v8` is not installed, so `--coverage` can't run. No test imports `EditorContextMenu.tsx` (1002), `CommentEditorList.tsx` (785), `DocumentReviewRail.tsx` (713), `MermaidOverlays.tsx`, or `functions/api/auth/[[route]].ts`.
- **TEST-3 · The 755-line suggesting-mode test tests a re-implementation, not the product. [Fact]** Helpers state they "Mirror the `handleKeyDown` logic in PageCard.tsx" (`:23,64`). Production handlers can drift with no failure here. (Directly resolved by ARCH-2's extraction.)
- **ERR-1 · Conflict-resolution actions can fail with zero feedback. [Fact]** "Reload from disk"/"Overwrite disk file" are called as `void …()` (`DocumentWorkspace.tsx:798,822`) into App handlers with no try/catch (`App.tsx:1759,1777`) → a failed read/save is an unhandled rejection; the banner stays and the click appears to do nothing — exactly when the system is already in a bad state.
- **DEP-2 · ~5 MB of junk in `app/public/` ships to production. [Fact]** `sneak-peek.png` (4.0 MB), `ChatGPT Image …png` (840 KB), `prompt.md`, `setup.md`, `install.sh` are served verbatim from the deployed site.
- **DEP-3 · `.wrangler/` is not gitignored. [Fact]** Currently escapes `git status` only because it holds an empty `tmp/`; one `wrangler pages dev` away from being committed.
- **DOC-2 · Five-way naming drift. [Fact]** roughneck (repo/CLI) vs roughneck-web (deploy doc) vs margins (UI) vs marginsmd (Pages) vs @roughdraft/app (package); storage keys mix lineages (`roughdraft:pages`, `roughneck.gh.token`).

### Low (grouped)

- **ARCH-7** `titleFromContent` duplicated 7× across backends + `App.tsx`; `saveMarkdownFile` returns `Page | undefined` forcing 3 copy-pasted re-synthesis blocks (`App.tsx:1705,1784,1818`). **ARCH-8** Dead export `gitHubSelectionFromUrl` (`detect-backend.ts:93`). **ARCH-9** `editor-extensions.ts` rebuilds full `DecorationSet` by walking the whole doc on every `docChanged` (`:528,644`) instead of `DecorationSet.map`. **PERF-7** localStorage stores assets as base64 (≈5 MB quota), re-`JSON.parse`s the full blob per image (`local-storage-backend.ts:142`); `QuotaExceededError` uncaught. **PERF-8** `RichTextEditorSurface` keyed by the entire markdown string (`PageCard.tsx:2345`) → full editor remount + O(doc) key diff on external change. **SEC-6** raw exception text on the 500 path (`[[route]].ts:28`); client-side-only OAuth state, no PKCE (acceptable for a confidential client). **DEP-4** `vite` 2 majors behind, `marked` 3 behind + a second `marked` bundled inside mermaid; `shadcn` (a CLI) in `dependencies` for one CSS import — move to devDeps. **ERR-2** silent `catch {}` at `MermaidOverlays.tsx:132,186,385`.

### Strengths (preserve these)

1. **The storage contract is genuinely good.** One `StorageBackend` interface, five implementations, optional capabilities, version-checked saves with a typed `MarkdownFileConflictError` flowing into a real three-choice conflict UI, and **zero import cycles** in the backend layer (`storage.ts`, all `*-backend.ts`).
2. **Document-body markdown is XSS-safe by construction.** Zero `dangerouslySetInnerHTML` in `app/src`; content round-trips through the Tiptap/ProseMirror schema (drops unknown tags/attrs/handlers), raw HTML stored as opaque data attributes (`markdown.ts:52`), comment bodies render as escaped React children.
3. **Boundary-mocked tests assert real behavior** — exact request URLs/headers/bodies, 409→typed conflict with server state, multibyte base64 round-trips, negative assertions that guards short-circuit before fetch (`github-backend.test.ts`, `remote-backend.test.ts`, `auth/exchange.test.ts`). 261 tests in ~2.8 s.
4. **Mermaid is properly lazy** (`MermaidOverlays.tsx:177` dynamic `import("mermaid")`) — its ~1.3 MB of chunks stay out of the entry bundle — and **GitHub mode disables autosave** (`App.tsx:1986`) so saves never spam commits or write-quota.
5. **Clean, secret-disciplined deploy architecture** the code actually matches: static SPA + one stateless Function, `client_secret` server-side only, no `VITE_` leak, gitignored, clean git history. Zero `npm audit` vulnerabilities; strict TS; lockfile committed.

**Lighter-review areas** (lower confidence, less depth): the legacy bash CLI (`roughneck`, `assets/`) reviewed for security/identity only, not functionality; Tiptap extension internals and `critic-markup/index.ts` AST logic reviewed at the interface level; no runtime profiling or real-browser perf traces were taken (static analysis only).

---

## Improvement Strategy

Five themes explain almost every finding.

**Theme 1 — There is no safety net.** (T-1, T-2, TEST-1, TEST-2, DEP-1)
*Target state:* every push runs typecheck + unit tests + build and **fails** on red; e2e either runs or is deleted. *Principle:* a test that can't fail and a suite that never runs are worse than none — they manufacture false confidence. This is the highest-leverage theme: it's cheap and it's the precondition for safely doing everything else.

**Theme 2 — Untrusted content meets a privileged token.** (SEC-1, SEC-2, SEC-3)
*Target state:* Mermaid renders in `strict` mode (and/or DOMPurify'd), a CSP constrains `script-src`/`connect-src`, and the token leaves the URL fragment. *Principle:* the app holds a repo-write credential while rendering arbitrary third-party markdown — that pairing demands defense in depth, not a single safe-by-construction path that Mermaid bypasses. *Trade-off accepted:* PKCE and moving off fragment-based token delivery are deferred — they're real but lower-impact than closing the script-execution path.

**Theme 3 — God files concentrate risk where churn is highest.** (ARCH-1, ARCH-2, ARCH-3, ARCH-6, TEST-3)
*Target state:* `App.tsx` split (marketing extracted), the suggesting-mode engine extracted into one tested module, and save/dirty state owned in one place. *Principle:* the files most likely to change (the editor kernel, the orchestration shell) are the ones where duplication and mirrored state turn small edits into silent-data-loss bugs. *Trade-off accepted:* a full router migration and a capabilities-based backend redesign (ARCH-4) are **not** recommended now — the current contract works; do the targeted extractions that pay off immediately and defer the architectural purity work.

**Theme 4 — Work is repeated on the hot path.** (PERF-1, PERF-3, PERF-4, PERF-5, PERF-2)
*Target state:* serialization debounced with the save, one cached TurndownService, GitHub reads cached/ETagged with rate-limit handling, the picker tree-fetch debounced, and the bundle split so the login screen is light. *Principle:* the editor re-does O(doc) work per keystroke and the network layer re-does O(repo) work per navigation; both should do work proportional to what changed. *Trade-off accepted:* the large-file Blobs-API fallback (PERF-6) is deferred to a correctness guard (just warn/refuse) rather than a full implementation.

**Theme 5 — The repo has two identities and stale docs.** (ARCH-5, DEP-2, DEP-3, DOC-1, DOC-2)
*Target state:* one name, one README that documents the deployed app, the legacy CLI archived or clearly partitioned, deploy docs that match `wrangler.toml`, and production assets free of junk. *Principle:* a contributor (or the owner in six months) should not have to reverse-engineer which half of the repo is live. *Trade-off accepted:* don't rewrite the legacy CLI; just relocate/label it.

**Definition of done (measurable signals).**
- CI is green and **fails the build on** any failing test, type error, or lint error.
- `vitest run` exits 0 on `main`; e2e either runs in CI or is removed from the tree.
- Zero **Critical** and zero **High** security findings (SEC-1 closed, CSP present, token off the fragment).
- First-load JS < ~300 KB gzip to interactive login (editor/CodeMirror/Mermaid lazy).
- Keystroke serialization no longer O(doc) on every transaction (debounced + single TurndownService).
- One project name across repo/README/wrangler/package; root README documents the deployed app; deploy doc matches `marginsmd`.

---

## Task Plan

### Quick wins (high impact, S effort — do immediately)
| ID | Task | Why it's a quick win |
|---|---|---|
| TEST-1 | Fix `homepage-metadata.test.ts:29` to expect `margins` | One line; turns the suite green so CI is meaningful. |
| DEP-3 | Add `.wrangler/` to `.gitignore` | One line; prevents committing tmp/secrets. |
| DEP-2 | `git rm` the ~5 MB of `app/public/` junk (`sneak-peek.png`, etc.) | Smaller, faster deploy; one commit. |
| DOC-1 | Fix deploy doc: `marginsmd` project name + remove the false `_redirects` claim | Stops a real deploy-time secret-misplacement footgun. |
| SEC-1a | Flip Mermaid `securityLevel: "loose"` → `"strict"` (both render paths) | Two-line change closes the main token-exfil vector. |
| SEC-4 | Rotate the OAuth client secret | Precautionary; cheap; secret was on disk. |

### Milestone 0 — Safety net (do before any refactor)
| ID | Task | Files | Acceptance | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| T-1 | Add CI (GitHub Actions): `npm ci && tsc -b && vitest run && vite build` on push/PR | `.github/workflows/ci.yml` | Workflow runs & **fails** on red test/type/build | S | Low | TEST-1 |
| TEST-1 | Fix stale homepage-metadata assertion | `app/test/homepage-metadata.test.ts` | `vitest run` exits 0 | S | Low | — |
| T-2 | Decide e2e fate: wire it up (restore `server/`, add `@playwright/test`+`tsx`, switch `pnpm`→`npm`) **or** remove `app/e2e/`+config | `app/e2e/`, `playwright.config.ts`, `app/package.json` | e2e runs in CI, or tree no longer contains dead e2e | M (fix) / S (remove) | Low | — |
| DEP-1 | Add Biome (lint+format) and wire into CI | `app/biome.json`, CI | `biome check` runs in CI; baseline committed | M | Low | T-1 |
| TEST-2 | Install `@vitest/coverage-v8`; enforce existing thresholds (or lower to honest current %) in CI | `app/package.json`, `vitest.config.ts`, CI | `vitest run --coverage` passes thresholds in CI | M | Low | T-1 |

### Milestone 1 — Critical security & correctness
| ID | Task | Files | Acceptance | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| SEC-1 | Harden Mermaid: `strict` + DOMPurify the SVG before `innerHTML` (both SPA + legacy) | `MermaidOverlays.tsx`, `assets/roughneck-enhance.js` | A diagram with an `onerror`/`javascript:` payload renders inert; regression test added | M | Med (diagram visuals) | quick-win SEC-1a |
| SEC-3 | Add CSP + security headers via `app/public/_headers` (Cloudflare) | `app/public/_headers` | Response carries `Content-Security-Policy` limiting `script-src`/`connect-src` to self+api.github.com; app still works | M | Med (CSP can break inline) | — |
| SEC-2 | Stop returning the token in the redirect fragment (e.g. short-lived code → SPA fetch, or `postMessage`) | `functions/api/auth/[[route]].ts`, `app/src/github-auth.ts`, `vite.config.ts` | Token never appears in a `Location`/URL; e2e auth still works | L | Med | T-2 |
| PERF-6 | Guard large files: detect empty-content/`encoding:"none"` and surface an explicit error instead of an empty editor | `app/src/github-backend.ts` | Loading a >1 MB file shows an error, never an empty doc that can overwrite | S | Low | — |
| ERR-1 | Add try/catch + user feedback to conflict-resolution handlers | `App.tsx`, `DocumentWorkspace.tsx`, `EditorContextMenu.tsx` | A failed reload/overwrite surfaces an error; no unhandled rejection | S | Low | — |

### Milestone 2 — High-leverage refactors (make future work easier)
| ID | Task | Files | Acceptance | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| ARCH-2 | Extract the quadruplicated suggesting-mode engine into `suggesting-mode.ts`; point `PageCard` editorProps at it; retarget `suggesting-mode.test.ts` at the real module | `PageCard.tsx`, new `suggesting-mode.ts`, `suggesting-mode.test.ts` | One implementation; test imports production code; all tests green | L | **High** (silent-data-loss path) | M0 complete |
| ARCH-1 | Split `App.tsx`: extract `Homepage`, `RoughdraftFlavoredMarkdownPage`, `PreviewPage`, workflow mocks | `App.tsx` → new files | `App.tsx` < ~700 lines; build green; no behavior change | M | Low | — |
| ARCH-3 | Collapse save/dirty state to a single owner; delete the three mirror copies | `PageCard.tsx`, `DocumentWorkspace.tsx`, `App.tsx` | One source of truth; beforeunload/handoff behavior unchanged under tests | L | **High** | ARCH-2 |
| PERF-1 | Debounce serialization with the save; cache one `TurndownService` | `PageCard.tsx`, `critic-markup/index.ts` | No full re-serialize per keystroke; typing latency flat vs doc size | M | Med | ARCH-2 |
| PERF-2 | `manualChunks` + `React.lazy` for editor/CodeMirror/Mermaid; lazy-load CodeMirror | `vite.config.ts`, `MarkdownCodeEditor.tsx`, route boundaries | Login-screen JS < ~300 KB gzip | M | Low | — |
| PERF-3 | GitHub layer: ETag/conditional caching, 403/429 handling w/ backoff + message, debounce picker tree-fetch, SPA nav instead of full reload | `github-backend.ts`, `GitHubPicker.tsx`, routing | Rate-limit shows a real message; file open doesn't reboot app; tree not refetched per keystroke | L | Med | — |

### Milestone 3 — Quality & polish
| ID | Task | Effort | Risk |
|---|---|---|---|
| ARCH-5 | Give GitHub mode a real error page; stop rendering the marketing Homepage on `loadError` | S | Low |
| PERF-4/5 | Throttle Mermaid scroll reflow (rAF + read/write batching); drop the `selectionUpdate` subscription in `useCommentAnchorLayout` | M | Low |
| ARCH-4 | Add `capabilities` + `documentPath()` to `StorageBackend`; remove `info.kind`/`instanceof`/`info.detail`-as-path switches | M | Med |
| ARCH-9 | Use `DecorationSet.map` instead of full-doc walks in `editor-extensions.ts` highlight plugins | M | Med |
| ARCH-7 | Dedupe `titleFromContent` (×7) into one util; make `saveMarkdownFile` always return `Page` | S | Low |
| PERF-7/8 | localStorage quota handling; stop keying the editor on the full doc string | M | Med |
| DEP-4 | Move `shadcn` to devDeps; plan `vite`/`marked` major bumps; slim tiptap overrides | M | Med |
| ARCH-8 / SEC-5 | Remove dead `gitHubSelectionFromUrl`; harden the legacy CLI (covered by SEC-1 legacy path + SRI on CDN Mermaid) | S | Low |

### DOC-3 · Rename project to "margins" (repo, binaries, READMEs) — owner decision 2026-06-10

**Description.** Unify the project's identity under **margins**: rename the GitHub repo, the CLI binary, package metadata, the deployed-app branding, and every README — but *surgically*, because most `roughdraft` hits in the tree are NOT our branding and must be preserved. Blast radius (measured): ~40 tracked files, ~340 case-insensitive `roughneck|roughdraft` hits.

**Critical distinction — three categories of "roughdraft" string, only one gets renamed:**
1. **Our branding → rename to margins:** repo dir, CLI binary `roughneck`, `assets/roughneck-enhance.js`, package name `@roughdraft/app`, app title/wordmark, storage keys (`roughneck.gh.token`, `roughdraft:pages`), the `.rn-bak` backup suffix, README prose, `docs/deploy-cloudflare.md`.
2. **Legitimate upstream references → KEEP:** the marketing homepage in `App.tsx` is roughdraft.md's own content (the upstream product this is forked from); "CriticMarkup", "roughdraft.md" links, and the `margins` skill's mention of roughdraft.md CriticMarkup are real external references. Do not rewrite these — most of `App.tsx`'s 59 hits are here, and the bulk of them disappear anyway when **ARCH-5/ARCH-1** remove the upstream marketing homepage. **Sequence DOC-3 after ARCH-1/ARCH-5** so you're not renaming content you're about to delete.
3. **Historical record → leave as-is:** `docs/superpowers/plans|specs/2026-06-10-roughneck-*.md` are dated artifacts; renaming them rewrites history for no gain.

**Files/areas affected.** Repo rename (GitHub settings, not a file edit) · `roughneck` → `margins` (binary + its 32 internal refs, install symlink instructions) · `assets/roughneck-enhance.js` → `assets/margins-enhance.js` (+ `patch-url.mjs:3` refs, `.rn-bak`→`.margins-bak`) · `app/package.json` name · `app/index.html` title/meta (ties to TEST-1) · `github-auth.ts` token key · `local-storage-backend.ts` localStorage key · root `README.md` (two-products framing per the kept-CLI decision) · `app/README.md` · `docs/deploy-cloudflare.md` (also fixes DOC-1's `roughneck-web`→`marginsmd`) · brand assertions in `app/test/*` and `app/e2e/*` specs.

**Migration hazards (must decide/handle, not just sed):**
- **localStorage `roughdraft:pages` rename orphans existing local docs.** Either add a one-time read-old-write-new migration shim, or accept the data loss and say so. (sessionStorage token key rename just forces re-login — harmless.)
- **CLI binary rename breaks existing PATH symlinks.** Clean break — no `roughneck` alias/shim (owner decision). Document the re-link step (`ln -sf .../margins ...`) in the README; existing `roughneck` symlinks just stop working and users re-link.
- **The patch markers injected into the globally-installed roughdraft package** (`roughneck:41–73`) carry the old name; bump the marker string so re-running the renamed CLI cleanly re-patches rather than double-injecting.

**Acceptance criteria.** `git grep -iI roughneck` returns **zero** hits outside category-3 historical docs (`docs/superpowers/...`) — no back-compat shim; remaining `roughdraft` hits are all category-2/3 (upstream/CriticMarkup/historical), enumerated in the PR description; `vitest run` green (brand-string tests updated); root README documents both the `margins` CLI and the hosted app; deploy doc names `marginsmd`; the renamed `margins` CLI installs and re-patches cleanly.

**Effort:** L · **Risk:** Med (storage-key migration is the sharp edge; the string churn itself is low-risk once category-2 is fenced off) · **Depends on:** ARCH-1, ARCH-5, TEST-1 (and pairs naturally with DOC-1/DOC-2).

### Top-3 task implementation sketches

**T-1 — Add CI (do first).**
Approach: a single `.github/workflows/ci.yml`, `working-directory: app`, Node 20, steps `npm ci` → `npx tsc -b` → `npx vitest run` → `npm run build`. Add Biome/coverage steps once those land (M0). *Key steps:* matrix is unnecessary; cache npm. *Gotcha:* `npm ci` requires the committed `app/package-lock.json` (present ✓). Land **after** TEST-1 or the first CI run is red and people learn to ignore it — order matters.

**SEC-1 — Harden Mermaid.**
Approach: set `securityLevel: "strict"` in both `mermaid.initialize` calls; if interactive labels are needed, keep `loose` only behind `DOMPurify.sanitize(svg, {USE_PROFILES:{svg:true,svgFilters:true}})` before the `innerHTML` assignments at `MermaidOverlays.tsx:327/66`. *Key steps:* add `dompurify` (new dep), sanitize at the two injection points and the legacy `roughneck-enhance.js:155/75`; add a regression test rendering a diagram whose node label contains `<img src=x onerror=...>` and asserting no script/attribute survives. *Gotchas:* `strict` disables clickable nodes and HTML labels — confirm no current diagram relies on them (zoom modal is the interactive surface to re-test); DOMPurify must run in the same origin before insertion, not after.

**ARCH-2 — Extract the suggesting-mode engine.**
Approach: lift the four near-identical "collect addition/original segments → delete additions → mark originals" blocks (`PageCard.tsx:801–887, 913–999, 1070–1107, 1176–1211`) into pure functions in a new `suggesting-mode.ts` taking `(state, ranges, markType) → transaction`; the editorProps handlers (`handlePaste`, `handleTextInput`, `handleKeyDown` cut/backspace/delete) call them. Then **retarget** `suggesting-mode.test.ts` (which currently tests a hand-copied fork, `:23/64`) at the real module. *Key steps:* extract one block first, prove the existing test passes against it, then migrate the other three call sites one at a time, running the suite between each. *Gotchas:* this is the highest-risk file in the app (silent-data-loss reconciliation at `2251–2281`); do it only after M0's safety net exists, in small reviewed steps, and verify the dirty/echo `recentMarkdownRef` heuristic still holds after each migration. Do **not** combine with ARCH-3 in the same PR.

---

## Open Questions (need a human decision)

1. **Repo identity:** ~~Is the legacy bash CLI still shipped?~~ **Resolved 2026-06-10:** keep the CLI for self-hosters, and rename everything (repo, binary, READMEs) to **margins** — captured as task **DOC-3**. The CLI binary becomes `margins` with a clean break — no `roughneck` shim/alias.
2. **Maturity bar:** Is "margins" a public-facing product (which makes SEC-1/2/3 and CI non-negotiable) or a personal/internal tool (which lets some Medium items wait)? The plan assumes "becoming public."
3. **e2e:** Restore the missing `server/` and wire Playwright up, or delete the suite? (T-2 branches on this.)
4. **Untrusted-content posture:** Will users open arbitrary third-party repos (raising SEC-1's severity) or only their own? Changes how aggressively to sandbox Mermaid and whether to add a CSP allowlist for diagram features.
5. **Performance target:** Is the ~1 MB GitHub Contents limit the real ceiling, or do you need to support larger files via the Blobs API (PERF-6 becomes a feature, not just a guard)?
6. **Tiptap pinning:** Keep the exact-pin + 15-entry overrides block (blocks transitive security fixes) or move to a `^3.x` range? Needs the owner's risk preference.
