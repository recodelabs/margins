# Test Health Audit — roughneck

Date: 2026-06-10. Scope: `app/` Vitest unit suite, `app/e2e/` Playwright suite, CI. Read-only audit; no source modified.

## 1. Unit suite results

`npx vitest run` (Vitest 4.1.8): **Test Files 1 failed | 20 passed (21) — Tests 1 failed | 260 passed (261)**, 2.81s.

Failure, verbatim:

```
 FAIL  test/homepage-metadata.test.ts > homepage metadata > uses the homepage screenshot for social previews
AssertionError: expected 'margins' to be 'Roughdraft - Markdown reviews for cod…' // Object.is equality

Expected: "Roughdraft - Markdown reviews for coding agents"
Received: "margins"

 ❯ test/homepage-metadata.test.ts:29:58
```

- **[High] Suite is red on a clean `main`.** `app/index.html:6` now says `<title>margins</title>` (rebrand, see commits ca36ad0/af2b7ed) but `app/test/homepage-metadata.test.ts:7` still expects `"Roughdraft - Markdown reviews for coding agents"`. A permanently failing test trains everyone to ignore failures and masks new regressions. (With no CI — see §5 — nothing ever flagged it.)

## 2. Coverage gaps

Coverage run skipped: `@vitest/coverage-v8` is **not installed** (`app/node_modules/@vitest/` contains only expect/mocker/runner/snapshot/spy/utils), per instructions nothing was installed.

- **[Medium] Coverage thresholds are dead config.** `app/vitest.config.ts:16-31` declares v8 provider with thresholds (60% lines/functions/statements, 50% branches), but the provider package is absent, so `--coverage` cannot run and the thresholds enforce nothing.
- Note: `app/vitest.config.ts:40` includes `"../auth/**/*.test.ts"`, so `auth/exchange.test.ts` **does** run (file count 21 confirms it). Good — but the glob does not reach `functions/`.

Modules with **no test importing them anywhere** (verified by grep across `src/*.test.ts`, `test/**`, `auth/*.test.ts`):

| Module | Lines | Severity |
|---|---|---|
| `app/src/EditorContextMenu.tsx` | 1002 | High |
| `app/src/CommentEditorList.tsx` | 785 | High |
| `app/src/DocumentReviewRail.tsx` | 713 | High |
| `app/src/GitHubPicker.tsx` | 426 | Medium |
| `app/src/MermaidOverlays.tsx` | 420 | Medium |
| `app/src/DocumentCommentRail.tsx` | 229 | Medium |
| `app/src/useCommentAnchorLayout.ts` | 115 | Medium |
| `app/src/preview-backend.ts` | 101 | Medium |
| `app/src/theme.ts`, `app/src/update-status.ts` | 30/35 | Low |
| `functions/api/auth/[[route]].ts` (login redirect, callback, error paths, no-store headers) | 32 | Medium |

Nominally-tested but effectively uncovered:

- **[Medium]** `app/src/api-backend.ts` (197) and `app/src/local-storage-backend.ts` (153) are imported only by `src/detect-backend.test.ts` for `instanceof` checks — their fetch/persistence logic is untested.
- **[Low]** `app/src/MarkdownCodeEditor.test.ts` is a single 19-line smoke test for a 161-line module.
- Partially covered indirectly: `editor-extensions.ts` (810) via suggesting-mode/critic-markup tests; `storage.ts` types via several tests. Counterpoint to the prompt's premise: `PageCard.tsx` is exercised by `test/page-card.test.tsx` (2019 lines), `App.tsx` by `test/homepage.test.tsx` (794 lines, renders `Homepage`/`PreviewPage`) plus `app-navigation.test.ts`, and `DocumentWorkspace.tsx` by `test/view-toggle-bugs.test.tsx` — those are not bare.

## 3. Test quality (sampled: suggesting-mode, remote-backend, github-backend, view-toggle-bugs, homepage, page-card)

- **[Medium] `app/src/suggesting-mode.test.ts` tests a re-implementation, not the product.** Its helpers openly state they "Mirror the `handleTextInput` logic in PageCard.tsx" (`suggesting-mode.test.ts:23-29`) and "Mirror the *fixed* `handleKeyDown` logic from PageCard.tsx" (`:64-70`). 755 lines assert a hand-copied duplicate of the production handlers; PageCard's real handlers can drift or regress without any failure here. The real tiptap schema/extensions are used, so it's not worthless, but the keystroke logic under test is a fork.
- **[Low]** `app/src/remote-backend.test.ts:185-199` drives state via a private method through a type cast (`(backend as unknown as { setSessionStatus(...) })`) — couples the test to internals instead of the SSE events that change status (the last test does it properly via FakeEventSource).
- **[Low] Flake surface in component tests:** `test/page-card.test.tsx` uses `vi.useFakeTimers()` in ~25 tests with `advanceTimersByTime(500)` (e.g. `:492-499`), and real `requestAnimationFrame` waits (`flushAnimationFrame`, `:124-130`); cleanup relies on a single `afterEach` (`:477-478 useRealTimers/restoreAllMocks`). Currently green and fast, but rAF-under-jsdom waits and pervasive `getBoundingClientRect` prototype mocks (`view-toggle-bugs.test.tsx:72`, `homepage.test.tsx:102`) are order-sensitive if any test forgets cleanup.
- Otherwise quality is genuinely good: `github-backend.test.ts` and `remote-backend.test.ts` mock only at the `fetch` boundary and assert real behavior — exact URLs/headers/bodies, 409 → `MarkdownFileConflictError` carrying server state (`github-backend.test.ts:72-89`), multibyte base64 round-trip (`:111-120`), markdown-only guards that assert fetch was *not* called. `homepage.test.tsx`/`view-toggle-bugs.test.tsx` render real components with `createRoot` + `act` and assert via `data-testid`; mocks are limited to DOM geometry jsdom lacks. No mock-asserting-mock anti-pattern found.

## 4. E2E suite (not run, per instructions)

7 specs + helpers in `app/e2e/` covering real user value (stale-write conflicts, CriticMarkup review, markdown round-trip, homepage storyboard). They need no external credentials or network — `e2e/helpers.ts:7-13` builds temp-dir markdown projects and specs even abort SSE routes (`stale-write.spec.ts:30`). Chromium-only, headless-capable config with CI hooks (`playwright.config.ts:14,29`). But:

- **[Critical] The e2e suite cannot run at all in this repo.**
  - `app/e2e/start-api.ts:1` imports `../../server/src/index` — there is **no `server/` directory** anywhere in the repo (root contains app/auth/assets/docs/functions only). The webServer (`playwright.config.ts:27`) can never start.
  - `@playwright/test` is **not a dependency** and is not installed (`app/package.json` devDependencies:67-78; no `app/node_modules/@playwright` or `playwright`); `tsx` (`playwright.config.ts:27`) is also absent.
  - `playwright.config.ts:27,34` shells out to `pnpm`, but the project is npm-managed (`package-lock.json`, no pnpm-lock).
  - `helpers.ts:111` says `source: "packages/app/e2e"` — these specs were transplanted from a monorepo and never re-wired.
- **[High] No script invokes e2e.** `app/package.json:6-11` has only `dev/build/preview/test` — nothing references Playwright, so even a future fix has no entry point.

Net: ~1,660 lines of e2e code are dead weight providing zero protection while looking like coverage.

## 5. CI

- **[Critical] No CI exists.** No `/Users/claudius/github/roughneck/.github/` directory, and no CI config (no *.yml workflow, CircleCI, GitLab, etc.) anywhere outside node_modules. Consequence: nothing enforces `vitest run`, `tsc -b`/`vite build`, or e2e on push or PR. This is why a failing unit test sits on `main` unnoticed (§1) and why the e2e suite rotted into unrunnability (§4) — `playwright.config.ts`'s `process.env.CI` branches reference a CI that has never run.

## Strengths (max 3)

1. **Boundary-mocked backend tests assert real protocol behavior** — exact request shapes, 409-conflict error payloads, UTF-8 round-trips, and negative assertions that guards short-circuit before fetch (`github-backend.test.ts`, `remote-backend.test.ts`, `auth/exchange.test.ts`).
2. **Component tests exercise real rendering, not mocks** — `homepage.test.tsx`, `page-card.test.tsx` (2019 lines), `view-toggle-bugs.test.tsx` mount real React trees and real tiptap editors in jsdom, stubbing only missing DOM geometry; `view-toggle-bugs.test.tsx` is a regression-named suite pinning fixed bugs.
3. **Fast, broad unit suite with smart includes** — 261 tests in ~2.8s, and `vitest.config.ts:40` pulls `../auth/**/*.test.ts` into the run so the shared OAuth exchange code outside `app/` is actually tested.
