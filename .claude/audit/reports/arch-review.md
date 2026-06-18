# Architecture & Code Quality Audit — `app/src` (margins / roughneck)

Date: 2026-06-10. Scope: `app/src` plus repo-root legacy half. Analysis only; no files modified except this report.
Severity legend: consequence-based (Critical = data loss/security now, High = active defect-breeding or major drag, Medium = real cost, Low = hygiene). No Critical findings were identified.

---

## 1. God files

### 1.1 `App.tsx` (1,991 lines) — three applications in one file
**Fact:** Only lines 1479–1991 are the actual `App` component. Lines 100–1395 (~65% of the file) are static marketing/docs content for the *upstream* product: `Homepage` (308–570), `HomepageWorkflowScene`/`AgentChatMock`/`RoughdraftPopupMock` mocks with their own ResizeObserver/scroll measurement systems (572–1154), and `RoughdraftFlavoredMarkdownPage` (1156–1395). `PreviewPage` (1406–1477) is a fourth concern.
**Judgment:** **High.** The orchestration shell (backend detection, document lifecycle, save/conflict flow) is buried under ~1,300 lines of brand content for a different product (`roughdraft.md`, App.tsx:414). Natural seams are clean — none of the marketing components share state with `App`: extract `Homepage.tsx`, `RoughdraftFlavoredMarkdownPage.tsx`, `PreviewPage.tsx`, `homepage-workflow-mocks.tsx` with zero refactoring risk.
**Most complex functions:** `App` (1479–1991, mixes 2 routing schemes, 10 state atoms, 6 refs synced during render at 1510–1513); `initialize` effect (1582–1657, 5-way branch on backend kind/GitHub mode/path shape); file-watch effect (1844–1894, nested async closure with 5 guard branches).

### 1.2 `PageCard.tsx` (2,411 lines) — editor kernel, four components, one save engine
**Facts — distinct responsibilities mixed:**
1. ProseMirror query/mutation helpers (124–591, ~15 free functions).
2. `RichTextEditorSurface` (593–2015): TipTap config *including the entire suggesting-mode input engine inlined as `editorProps` handlers*, comment CRUD, suggestion accept/reject, DOM hover/click wiring (1352–1448), highlight-plugin dispatch.
3. `CodeEditorSurface` (2017–2075).
4. `PageCardEditorSurface` (2077–2359): the autosave engine — debounce, flush, blocked/manualCommit modes, and external-change reconciliation.
5. `PageCard` shell (2361–2411).

**Most complex/branched functions:**
- `handleKeyDown` editorProps (1004–1220, ~216 lines): Enter-split, Cut, word-wise Backspace/Delete each with their own branch trees.
- `handlePaste` (766–891, ~125 lines) and `handleTextInput` (892–1003, ~111 lines).
- `getDocumentCriticChangeRailItems` (394–509): two-pass DOM-rect + doc-walk merge.
- Reconciliation effect (2251–2281): the dirty/echo heuristic comparing full markdown strings against a 10-entry `recentMarkdownRef` Set — the riskiest logic in the app; any bug here is silent data loss territory, and it is only testable through the whole component.

**Finding (High):** the "collect addition/original segments, delete additions, mark originals" block is **copy-pasted four times** with only the surrounding mark choice differing: paste (801–818 + 822–887), text input (913–930 + 934–999), cut (1070–1107), backspace/delete (1176–1211). ~350 lines of quadruplicated transaction logic; a fix to one copy (e.g., the segment-merge `prev.to === segFrom` condition) must be manually replicated 3 more times.
**Seams:** extract a `suggesting-mode.ts` (the segment/mark engine — note `suggesting-mode.test.ts` already exists, 755 lines, but the production logic it exercises lives inline in PageCard); extract `use-autosave.ts` from `PageCardEditorSurface`; move the 15 ProseMirror helpers (124–591) to `critic-editor-queries.ts`.

**Finding (Medium):** `RichTextEditorSurface` is keyed by the *entire markdown document string*: `key={`${page.id}:${richTextSourceVersion}:${effectiveRichTextSourceMarkdown}`}` (2345). Every accepted external change destroys and rebuilds the whole TipTap editor, and React diffs keys whose length is O(document size).

**Finding (Low):** `useCallback` hooks closing over `authorId` omit it from deps — 1473–1501, 1503–1514, 1530–1594, 1635–1672, 1736–1777. Benign today only because `backend` never changes after mount.

### 1.3 `DocumentWorkspace.tsx` (1,012 lines)
**Facts — responsibilities:** review-handoff state machine (`ReviewHandoffState` + watcher reconciliation, 298–448), watcher polling, clipboard copy menu (450–478), GitHub breadcrumb builder (529–566), conflict notice UI (770–829), commit button, save-status indicator, mode selector, plus the 18-prop pass-through to `PageCard`.
**Most complex:** watcher/handoff reconciliation effect (370–390) — a hand-rolled state machine using `sawNoWatcherAfterNotifiedRef`; `handleCompleteReview` (417–448).
**Finding (Low):** `getReviewWatchStatus` is polled every 1.5 s forever while a document is open (363), even when the tab is hidden.
**Seams:** `ReviewHandoffControl`, `FileConflictNotice`, `GitHubBreadcrumb`, `FileCopyMenu` are each self-contained JSX+state islands; extraction is mechanical.

### 1.4 `EditorContextMenu.tsx` (1,002 lines) — three overlays in one component
**Fact:** one component owns (a) the right-click context menu (`position`, 878–999), (b) the floating selection toolbar (`selectionActionPosition`, 652–787), (c) the link edit popover (`linkPopoverState`, 788–877) — three independent positioning systems and dismiss protocols.
**Most complex:** the listener mega-effect (516–571) registering 8 listeners (editor events, `selectionchange`, capture-phase keydown, window resize, capture-phase scroll) with rAF-debounced repositioning; `updateLinkPopover` (318–362); `findActiveLinkAnchor` (126–159).
**Judgment (Medium):** the three overlays share only `editor`/`backend`; splitting into `SelectionToolbar`, `LinkPopover`, `ContextMenu` would remove the cross-talk (e.g., the double Escape handling at 495–498 closes both systems from one effect keyed on both states).

### 1.5 `editor-extensions.ts` (810 lines)
**Fact:** `CommentHighlight` (511–564) and `CriticChangeHighlight` (627–680), plus their decoration builders (449–509 vs 566–625), are structural twins differing only in mark type and attr names. Same for `acceptCriticChange`/`rejectCriticChange` (344–421), which share `collectCriticChangeRanges` but duplicate the sentinel/loop scaffolding.
**Finding (Medium, perf):** both highlight plugins rebuild their full `DecorationSet` by walking the *entire document* on **every transaction where `tr.docChanged`** (528–555, 644–671) instead of `DecorationSet.map`. Two O(doc) scans per keystroke; and `createCommentHighlightDecorations` creates an inline decoration for every commented text node even when nothing is selected/hovered (496–505).
**Seam:** parameterize one `createMarkHighlightExtension({markName, pluginKey, classPrefix})`; move the two big Mark definitions (`CommentRef`, `CriticChange`) to their own files.

### 1.6 `CommentEditorList.tsx` (785 lines)
**Fact:** the best-shaped of the six — list orchestration (91–315) + recursive `CommentThreadNode` (397–785). Cost center: `CommentThreadNode` takes **24 props** (325–339 interface), all drilled per level of the comment tree; draft/edit state lives in the parent and is threaded down as `drafts`/`editingCommentIds` maps.
**Judgment (Low):** a `CommentListContext` (or colocating edit state in the node) would cut the prop fan-out; otherwise fine.

---

## 2. Backend abstraction

**Fact:** there *is* a real contract — `StorageBackend` in `storage.ts:52–72` with optional capabilities (`watchMarkdownFile?`, `completeReview?`, `getReviewWatchStatus?`), implemented by all five backends, with `MarkdownFileConflictError` (storage.ts:14–21) used uniformly for optimistic concurrency (api-backend.ts:76–83, github-backend.ts:105–121, remote-backend.ts:138–147). **No circular dependencies:** `storage.ts` is a leaf; only `detect-backend.ts` imports the implementations; nothing imports `detect-backend` back.

Where the abstraction leaks:

- **(Medium) `info.detail` doubles as a document identifier.** `BackendInfo.detail` is a human-readable label, but App.tsx:1596–1598 does `const documentPath = detectedBackend.info.detail || "remote.md"` and passes it to `getMarkdownFile`. It only works because `RemoteBackend.getMarkdownFile` ignores its argument (remote-backend.ts:101). A future rename of the label string silently changes routing.
- **(Medium) `saveMarkdownFile` returns `Page | undefined`** (storage.ts:56–60); only `LocalStorageBackend` returns `undefined` (local-storage-backend.ts:110–117), forcing every caller to re-synthesize a `Page` — App.tsx does this **three times** with copy-pasted title derivation (1705–1713, 1784–1795, 1818–1831).
- **(Medium) Behavior switched on `info.kind` / `instanceof` instead of capabilities:** `manualCommit={backend?.info.kind === "github"}` (App.tsx:1986), `if (detectedBackend.info.kind === "remote")` (App.tsx:1596), `backend instanceof RemoteBackend` (components/RemoteSessionBanner.tsx:14, 20). Adding a sixth backend means auditing these scattered checks; a `capabilities`/`autosave` flag on the interface would localize it.
- **(Low) `PreviewBackend` lies about its kind:** `info.kind = "local-storage"` (preview-backend.ts:31) because the `BackendInfo.kind` union (storage.ts:41) has no `"preview"` member.
- **(Low) `titleFromContent` (first-line `#`-strip) is duplicated 7×:** local-storage-backend.ts:103, preview-backend.ts:5, github-backend.ts:21, remote-backend.ts:244, App.tsx:1707, 1787, 1821.
- **(Low) `GitHubBackend.listMarkdownPaths` lives off-interface** and `GitHubPicker` constructs its own throwaway `GitHubBackend` (GitHubPicker.tsx:164–166) separate from the one `detectBackend()` builds — two backend instances with independently captured tokens for the same session.

---

## 3. State & control flow

- **(High) Save state exists in three synchronized copies.** `PageCardEditorSurface` computes it → `PageCard` mirrors it in `useState` (PageCard.tsx:2381–2385) → `DocumentWorkspace` mirrors it again (DocumentWorkspace.tsx:297, 315–321) → `App` mirrors it a third time plus a ref (App.tsx:1490–1491, 1507, 1726–1732), each hop via an `onDocumentSaveStateChange` callback. The same pattern repeats for dirty state and draft content (`documentDirtyRef`, `documentDraftContentRef`, App.tsx:1506–1508 vs `localDirtyRef`/`pendingMarkdownRef` in PageCard.tsx:2099–2103). Any divergence between copies (e.g., the manualCommit path where `PageCard` reports `"unsaved"` while `App`'s ref lags one render) is invisible in types and only surfaces as wrong beforeunload/handoff-button behavior. The flush controller ref handed up through three layers (`saveControllerRef`, PageCard.tsx:2235–2238 → DocumentWorkspace.tsx:308, 992–994) confirms the data wants to live in one place.
- **(Medium) Two routing schemes interleaved with no router.** `app-navigation.ts` parses filesystem-style URLs (`/?path=/abs/file.md`), `github-route.ts` parses `/owner/repo/path.md?branch=`. In GitHub mode, `getRequestedPathState()` is still run against GitHub URLs (App.tsx:1480), producing a fictitious `projectPath` of `"/owner/repo/dir"`, and `isGitHubMode()` is re-checked at five separate points to override the result (App.tsx:1550, 1610, 1630, 1928, 1953). Route state is captured once at mount (`useState(initialRequestedPathState)` with no setter, 1481) and there is **no `popstate` handling in App** — only `GitHubPicker` listens (GitHubPicker.tsx:142) — so the picker uses `pushState` SPA navigation while every workspace link (breadcrumbs, DocumentWorkspace.tsx:591–604) is a full-page reload. Also `getRequestedPathState()` is recomputed and discarded every render (1480).
- **(Medium) File-watch effect resubscribes on UI state.** The effect at App.tsx:1844–1894 lists `documentDiskChangeState` in deps, so each `clean ↔ changed/paused` flip closes and reopens the backend `EventSource` (api-backend.ts:88–110). Reading the state through a ref (as the same effect already does for backend/path) would keep one stable subscription.
- **(Low) Refs assigned during render** (App.tsx:1510–1513; PageCard.tsx:1235–1237) — works, but is the documented-unsafe pattern under concurrent rendering.
- Prop drilling scale (fact, cost folded into the High above): `DocumentWorkspace` 18 props (252–273) → `PageCard` 18 props → `RichTextEditorSurface` passes ~30 props to `DocumentReviewRail` (PageCard.tsx:1967–2011) → `CommentThreadNode` 24 props.

---

## 4. Dead / vestigial code & the split-brain repo

- **(Medium) The repo is two unrelated projects sharing a name.** Root `roughneck` (222-line bash) + `assets/roughneck-enhance.js` (323 lines) patch a **globally installed `roughdraft` npm package** (`RD_ROOT="$(npm root -g)/roughdraft"`, roughneck:30–33), not `app/`. The root README documents only that CLI; git history shows 2 commits ever for the CLI half vs. continuous active work in `app/`. Meanwhile `app/` re-implements the enhance script's features natively (`MermaidOverlays.tsx`, `ThemeToggle.tsx`). The naming is four-way: repo **roughneck**, package **@roughdraft/app** (app/package.json:2), Cloudflare project **marginsmd** / title **margins** (wrangler.toml:4, App.tsx:1673–1674), homepage brand **roughdraft.md** (App.tsx:414); storage keys mix both lineages (`roughdraft:pages` local-storage-backend.ts:3, `roughneck.gh.token` github-auth.ts:1, error copy "…opened in roughneck" github-backend.ts:81). Anyone grepping for "margins" finds almost nothing.
- **(Medium) The marketing Homepage is the production *error page*.** With `VITE_GITHUB_MODE=1` (the deployed configuration, app/.env.example:5, docs/deploy-cloudflare.md:33), the only paths to `Homepage` are `loadError` or a rawPath-less fall-through after the picker guard (App.tsx:1928–1943). So a margins user whose document fails to load is shown the full roughdraft.md sales page ("Install now", agent-setup prompt) with the error as its subtitle. `RoughdraftFormatDemo.tsx` (211 lines) is reachable only through that Homepage (App.tsx:566) — effectively dead in the deployed app, alive in code.
- **(Low) Dead export:** `gitHubSelectionFromUrl` (detect-backend.ts:93–101) has zero callers. `isReservedAppPath` (app-navigation.ts:15) is exported but used only within its own module.
- **(Low) Local-server features run against a server that doesn't exist in production:** `fetchUpdateStatus()` fires unconditionally (App.tsx:1532–1547 → `/api/update-status`) and fails silently on Cloudflare; the `/api/open-requests` SSE is at least gated by `isGitHubMode()` (App.tsx:1550). The remote-session and review-watcher subsystems (`RemoteBackend`, `RemoteSessionBanner`, watcher polling) are likewise unreachable in GitHub mode but fully shipped.

---

## 5. Error handling

**Fact — the dominant pattern is sound:** backends `throw new Error(\`… (${status})\`)` on non-OK responses; top-level flows catch, `console.error`, and set user-visible state (App.tsx:1637–1644, DocumentWorkspace.tsx:441–445, PageCard.tsx:2164–2168). Conflicts use a typed error. Inconsistencies:

- **(Medium) Conflict-resolution actions can fail with zero feedback.** "Reload from disk" and "Overwrite disk file" invoke async handlers as `void onReloadDocumentFromDisk()` / `void onOverwriteDocumentOnDisk()` (DocumentWorkspace.tsx:798, 822); the underlying App handlers (App.tsx:1759–1771, 1777–1804) have **no try/catch**, so a failed `getMarkdownFile`/`saveMarkdownFile` becomes an unhandled rejection — the banner stays up, the click appears to do nothing. These are exactly the buttons users press when the system is already in a bad state. Same shape: `handlePasteText`/`handlePasteMarkdown` use `try { await clipboard.readText() } finally {…}` with **no catch**, called as `void …()` (EditorContextMenu.tsx:589–622, 986, 994) — a clipboard-permission denial is an unhandled rejection.
- **(Low) Truly silent `catch {}` (no comment, no fallback):** MermaidOverlays.tsx:132, 186, 385. The other ~14 bare catches (local-storage-backend.ts:16, 30; detect-backend.ts:47; markdown.ts:47, 204; github-route.ts:17; update-status.ts:32; etc.) are deliberate parse/availability fallbacks, mostly commented — acceptable.
- **(Low) Error detail is inconsistent across backends:** `GitHubBackend` surfaces the server message for 422s (github-backend.ts:108–111) but `ApiBackend`/`RemoteBackend` discard response bodies and report only status codes, so "Save failed (500)" is all the UI can ever show for local saves.

---

## Strengths (3)

1. **The storage contract and conflict model are genuinely good.** One interface, five implementations, optional capabilities, version-checked saves with a typed `MarkdownFileConflictError` flowing into a real three-choice conflict UI — and no import cycles anywhere in the backend layer.
2. **Pure logic is extracted and tested where it matters most:** 12 colocated `*.test.ts` files cover routing (`app-navigation`, `github-route`), backend detection, GitHub backend conflict semantics, markdown round-tripping, and the suggesting-mode semantics (755-line `suggesting-mode.test.ts`).
3. **Non-obvious decisions are documented at the point of code:** e.g., why the handoff button stays enabled during debounce (DocumentWorkspace.tsx:234–237), why SSE auth rides a query param (remote-backend.ts:165–168), why 422 isn't always a conflict (github-backend.ts:107), why the save indicator is hidden in manual-commit mode (DocumentWorkspace.tsx:928–930).

## Top 5 actions by leverage

1. Extract the quadruplicated suggesting-mode transaction engine from `PageCard.tsx` editorProps into one module (eliminates ~350 duplicated lines in the highest-risk file).
2. Collapse the save/dirty state to a single owner (a `useDocumentSave` hook or store) and delete the three mirror copies.
3. Split `App.tsx`: move Homepage/RFM/Preview/marketing mocks out; while there, stop rendering the marketing Homepage as the GitHub-mode error page.
4. Add `capabilities` (autosave vs manual-commit, remote-session) to `StorageBackend` and a real `documentPath()` accessor; kill the `info.detail`-as-path and `info.kind`/`instanceof` switches.
5. Decide the repo's identity: either delete/archive the root CLI half (its features are reimplemented in `app/`) or move it to its own repo, and unify the roughneck/margins/roughdraft naming.
