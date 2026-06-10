// Vitest global setup: polyfill jsdom APIs required by prosemirror-view / tiptap
// during headless editor tests.

// prosemirror-view's posAtCoords calls document.elementFromPoint (or
// view.root.elementFromPoint).  jsdom implements the method on the
// Document prototype but the shadow-root path can reach it via view.root;
// guard both to avoid "is not a function" errors in tests that spin up a
// headless Tiptap editor instance.
if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = (_x: number, _y: number) => null;
}

// ShadowRoot.elementFromPoint is not available in jsdom either; patch the
// prototype so any shadow-root-backed editor view also works.
if (typeof ShadowRoot !== "undefined" && typeof ShadowRoot.prototype.elementFromPoint !== "function") {
  ShadowRoot.prototype.elementFromPoint = (_x: number, _y: number) => null;
}
