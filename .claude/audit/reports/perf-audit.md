# Performance Audit — roughneck (React 19 / Vite SPA)

Date: 2026-06-10 · Scope: GitHub API patterns, render hotspots, bundle, unbounded growth, large-document path.
Built output measured from `app/dist` (build of Jun 10 22:06).

## Findings

### 1. HIGH — Full document re-serialized (JSON → HTML → Turndown) on every keystroke
- `app/src/PageCard.tsx:1222-1229` — Tiptap `onUpdate` calls `emitMarkdownChange(currentEditor.getJSON())` synchronously on every transaction.
- `app/src/PageCard.tsx:673-691` → `app/src/critic-markup/index.ts:1489-1521` — `editorStateToCriticMarkdown` runs `generateHTML(doc, extensions)` over the **whole document**, constructs a **new TurndownService per call** (`index.ts:1495`), walks the full doc tree (`collectCriticChangesFromDoc`, `index.ts:1455-1487`), then runs Turndown over the full HTML string.
- Only the network save is debounced (500ms, `PageCard.tsx:2197`); serialization itself is not. Typing latency scales O(document size); near the 1MB Contents-API ceiling this is tens of ms of main-thread work per keystroke. `refreshCriticChanges` (`PageCard.tsx:725-739`) adds another full-doc scan per keystroke (rAF-coalesced, but still per frame).
- Fix direction: debounce serialization together with the save, or serialize lazily in `flushSave`/dirty-check paths; cache one TurndownService.

### 2. HIGH — 1.9MB entry chunk (≈605KB gzip), no manualChunks, no route-level code splitting
- `app/dist/assets/index-D3ostsIt.js` = 1,895,126 bytes raw, **604,666 bytes gzipped** — contains React, Tiptap starter-kit + 12 extensions, CodeMirror 6 (+markdown/yaml), marked, turndown, yaml, the whole picker/homepage.
- `app/vite.config.ts:58-61` — `build` only sets `chunkSizeWarningLimit: 1000` (suppresses the warning instead of splitting); no `manualChunks`.
- `grep React.lazy` → zero hits: the login screen (`GitHubPicker.tsx:44-99`) and homepage pay the entire editor bundle before showing a button.
- CodeMirror is statically imported (`app/src/MarkdownCodeEditor.tsx:1-5`) although code view is an opt-in mode — an easy lazy-load win.
- Cost: slow first paint on the login/picker route (the most common cold-entry path), repaid on **every** navigation because the app uses full page loads (see Finding 3).

### 3. HIGH — GitHub API: no caching/ETags, no rate-limit handling, per-keystroke tree fetches, full-reload navigation
- `app/src/github-backend.ts:60-75, 129-146` — every read/tree call is a plain `fetch` with no `If-None-Match`/ETag, no client cache. `listMarkdownPaths` does a `recursive=1` tree fetch each time it's invoked.
- No 403/429 handling anywhere (`grep '403|429|rate'` across `github-backend.ts`, `GitHubPicker.tsx`, `github-auth.ts` → no hits). A rate-limited user sees only `"GitHub tree failed (403)"` with no retry-after, no explanation, no backoff.
- `app/src/GitHubPicker.tsx:148-181` — the tree fetch effect depends on `[token, repo, ref]` with **no debounce**: typing `owner/repo` or a branch name fires one recursive-tree request per keystroke (the AbortController cancels the client read but each request still counts against the 5,000 req/h quota).
- `app/src/GitHubPicker.tsx:210-214` (`openFile`) and `app/src/GitHubPicker.tsx:121-124` use `window.location.assign` — opening a file or returning to the picker is a full page reload: re-download/parse of the 1.9MB bundle path, tree refetched from scratch, document refetched. Browsing N files costs N full app boots + N+1 uncached API round-trips.

### 4. MEDIUM — MermaidOverlays: body-wide MutationObservers fire on every keystroke; unthrottled scroll handler with interleaved layout reads/writes
- `app/src/MermaidOverlays.tsx:359-378` — **two** `subtree: true` MutationObservers (editor root + `document.body`) run for the lifetime of the workspace. Every editor keystroke mutates the DOM, scheduling a debounced (150ms) `scan()` (`:348-355`) that does a document-wide `querySelectorAll` + `reposition()` — even when the document contains zero mermaid blocks.
- `app/src/MermaidOverlays.tsx:224` — `scrollerEl.addEventListener("scroll", reposition)` with no rAF/throttle. `reposition()` (`:291-302`) interleaves writes (`sizeSheet.textContent` at `:274`, `box.style.*` at `:280-288`) with reads (`pre.getBoundingClientRect()` at `:278`, `pre.clientWidth` at `:264`) across the box loop → one forced synchronous reflow per diagram per scroll event. With several diagrams this janks scrolling of the exact documents the overlay feature targets.
- Minor: the SVG render cache (`:245`) is keyed by full diagram text and never evicted (session-bounded).
- Cleanup itself is correct (`:395-407` disconnects everything).

### 5. MEDIUM — Comment-anchor layout remeasured on every keystroke *and* every cursor movement
- `app/src/useCommentAnchorLayout.ts:95-97` — subscribes to both `editor.on("update")` and `editor.on("selectionUpdate")`; each fires `measureLayout` → `querySelectorAll` of all `.comment-anchor` elements + `getBoundingClientRect` per anchor (`:51-59`) + `setLayoutState` (re-rendering the rail). Arrow-keying through a heavily-commented document triggers a full measurement pass + React render per keypress. rAF coalescing (`:30-34`) caps it at once per frame, but selection changes don't move anchors — the `selectionUpdate` subscription is mostly wasted work.
- Same pattern duplicated for the homepage demo at `app/src/App.tsx:775-828` (bounded content, low impact).

### 6. MEDIUM — localStorage backend: no quota handling, base64 file blobs in localStorage, full-store JSON.parse per read
- `app/src/local-storage-backend.ts:22-24, 36-38` — `localStorage.setItem` with the **entire** serialized page/asset store on every save; a `QuotaExceededError` propagates uncaught (save silently becomes `saveState: "error"` with no quota-specific message or eviction).
- `:123-140` — `saveAsset` stores whole files as base64 data URLs inside localStorage (~5MB origin quota, base64 = +33% overhead): one pasted screenshot can permanently exhaust the quota for all documents.
- `:142-146` — `resolveFileUrl` calls `readAssets()` which `JSON.parse`s the entire base64 asset blob **per link/image resolution** during markdown parsing (`PageCard.tsx:631-651` passes it into `criticMarkdownToEditorState`) — megabytes of parsing per document open once a few assets exist.
- Comment data (`document-comments.ts`) itself is fine — it lives inside the markdown document, bounded by file size.

### 7. MEDIUM — Large-file path: >1MB files silently decode to an empty document; per-byte base64 codecs on the main thread
- `app/src/github-backend.ts:60-75` — `readFile` assumes `json.content` is base64. For files between 1MB and 100MB the Contents API returns `"content": "", "encoding": "none"`; `decodeBase64("")` yields `""`, so the app opens an **empty editor** for the real file with no error. A subsequent commit would write that emptiness over the file (manual Commit gates this, but nothing warns the user). No size check, no Git Blobs API fallback. `app/README.md:129-130` admits files "may fail to load or save" — they don't fail, they load wrong, which is worse.
- `app/src/github-backend.ts:26-35` — `decodeBase64` runs a per-character callback (`Uint8Array.from(atob(...), c => c.charCodeAt(0))`) and `encodeBase64` accumulates a string byte-by-byte (`bin += String.fromCharCode(byte)`) — O(n) callbacks plus repeated string growth for ~1MB payloads, synchronously on the main thread at every load and save.

### 8. LOW — Megabyte-scale React key embeds the full document; remounts the entire Tiptap editor
- `app/src/PageCard.tsx:2345` — `key={`${page.id}:${richTextSourceVersion}:${effectiveRichTextSourceMarkdown}`}` puts the **entire markdown source** into the React key. The key string is rebuilt and compared on every render of `PageCardEditorSurface` — and that component re-renders on every keystroke because `handleMarkdownChange` calls `setMarkdown` (`:2240-2249`). For large docs that is an O(doc) string build + compare per keystroke, plus `criticMarkdownHasReviewRail(markdown)` recomputed per keystroke (`:2314-2317`). Any external content change remounts the whole editor (full destroy/re-parse) rather than patching it.
- Related: `app/src/PageCard.tsx:1296` compares documents via `JSON.stringify(editor.getJSON()) !== JSON.stringify(nextDoc)` — a double full-document stringify whenever `parsedContent` identity changes.

### 9. LOW — Unthrottled homepage scroll handler doing multiple layout reads per event
- `app/src/App.tsx:336-396` — `scroll` + `resize` listeners run `matchMedia` plus 3-4 `getBoundingClientRect` calls and a per-workflow-step rect loop (`:369-379`) on **every scroll event** with no rAF/throttle. setState calls are equality-guarded (`:347-351, :381-383`) so re-renders are bounded, but the layout reads run regardless. Homepage-only; main cost is scroll jank on low-end devices.

## Strengths (max 3)

1. **Mermaid is properly lazy.** `app/src/MermaidOverlays.tsx:177` uses `import("mermaid")` only when a diagram block actually appears; the build confirms it — `mermaid.core` (620KB), `cytoscape` (443KB), `katex` (261KB), and all per-diagram chunks live outside the entry bundle, and rendered SVGs are cached by definition (`:245-254`).
2. **GitHub mode disables autosave.** `app/src/App.tsx:1986` sets `manualCommit` for the GitHub backend, so the 500ms debounced autosave (`PageCard.tsx:2187-2194`) never spams commits or burns the 5,000 req/h write quota while typing; saves are explicit, with optimistic-concurrency SHA conflict detection (`github-backend.ts:103-118`).
3. **Editor render discipline.** `shouldRerenderOnTransaction: false` (`PageCard.tsx:754`), memoized editor surfaces (`:593, :2017, :2077`), `useEditorState` with equality functions (`:1243-1256`), and rAF-coalesced measurement (`useCommentAnchorLayout.ts:30-34`) keep React out of the per-transaction hot path; every listener/observer found has matching cleanup.
