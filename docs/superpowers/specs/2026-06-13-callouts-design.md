# Callouts (`[!note]` / `[!tip]` …) — design

**Date:** 2026-06-13
**Status:** Approved
**Branch:** `feat/callouts`

## Goal

Render GitHub-style alert blockquotes (`> [!NOTE] …`, TIP, IMPORTANT, WARNING,
CAUTION) as styled callout boxes in the editor instead of plain blockquotes with
a literal `[!note]` prefix.

## Approach (decoration-only — no markdown/schema change)

A ProseMirror decoration plugin (mirroring the existing `commentHighlight` /
`criticChange` decoration plugins in `editor-extensions.ts`) walks blockquote
nodes. When a blockquote's first paragraph text starts with `[!type]`, it:

1. adds a node decoration `class="callout callout-<type>"` to the blockquote, and
2. hides the literal `[!type]` marker via an inline decoration
   (`class="callout-marker"`).

The blockquote node and its text are untouched, so the document still serializes
to `> [!note] …` markdown — perfect round-trip, no schema or turndown changes —
and the styling updates live as you type. The doc's inline form
(`[!note] body on the same line`) is supported: the marker (and one trailing
space) is hidden; the rest of the line becomes the callout body.

## Components

- **`src/callout.ts`** — pure `parseCalloutMarker(text)` → `{ type, markerLength }
  | null`. `markerLength` covers `[!type]` plus one optional trailing space.
  Case-insensitive; the five standard types only.
- **`src/callout.test.ts`** — parser unit tests.
- **`src/editor-extensions.ts`** — `createCalloutDecorations(doc)` + a `Callout`
  extension exposing it via `props.decorations`; registered in the extensions
  array.
- **`src/style.css`** — `.tiptap blockquote.callout` + per-type variables
  (`--callout-bg/-border/-accent/-label/-icon`) for the five types, light + dark,
  and `.callout-marker { display: none }`. Each callout: soft tinted background,
  1px accent-tinted border, rounded; a header line = small icon + bold colored
  label (Note/Tip/Important/Warning/Caution); then the body.
- **`src/PreviewPage.tsx`** — seed one callout in the preview fixture for live
  verification.

Colors (fit the app's warm/soft palette): Note = blue, Tip = emerald,
Important = violet, Warning = amber, Caution = rose.

## Position math (decoration)

Blockquote node at `pos`; its first paragraph's content starts at `pos + 2`
(`+1` into the blockquote, `+1` into the paragraph). Marker inline decoration
spans `pos+2 … pos+2+markerLength`. Node decoration spans `pos … pos+nodeSize`.

## Testing

- Unit: `parseCalloutMarker` (each type, case-insensitive, trailing space,
  non-match).
- Live on `/preview`: a `[!note]`/`[!warning]` block renders as a styled callout
  (icon + label + tint), the `[!note]` text is hidden, and the markdown still
  round-trips (toggle to code view shows `> [!note] …`). jsdom can't render CSS,
  so the visual is verified live.

## Out of scope (YAGNI)

Custom/collapsible callouts, non-standard types, changing the markdown syntax,
strict GitHub "marker alone on first line" form (inline form is supported too).

## Delivery

`feat/callouts`; PR → merge → deploy → verify `/preview`.
