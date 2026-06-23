/**
 * Single source of truth for the file types margins can open. Historically the
 * app gated everything on a single `\.md$` test that meant two different things
 * at once — "can we open this?" and "is this markdown?". Those are now split:
 *
 *   - `isSupportedPath` — can the app open it at all (listing, routing, loading)?
 *   - `isMarkdownPath`  — does it get the rich-text editor + comment/review rail?
 *
 * Non-markdown types (.json, .yaml, .txt, .fsh) open in the read/write code
 * editor only; the CriticMarkup comment workflow is markdown-specific and would
 * corrupt structured formats, so it stays off for them.
 */

/** Which CodeMirror grammar the code editor should load for a file. */
export type CodeHighlight = "markdown" | "yaml" | "json" | "plain";

export interface SupportedFileType {
  /** Lowercase extension without the leading dot, e.g. "md". */
  ext: string;
  /** Human-readable label for UI ("Markdown", "JSON", …). */
  label: string;
  /** Markdown gets the rich-text editor + comment rail; others are code-only. */
  isMarkdown: boolean;
  /** Syntax highlighting to use in the code editor. */
  highlight: CodeHighlight;
}

/**
 * The file types margins can open, in display order. Markdown stays first as
 * the primary content type. `.fsh` (FHIR Shorthand) and `.txt` render as plain
 * text — there is no CodeMirror grammar for FSH.
 */
export const SUPPORTED_FILE_TYPES: readonly SupportedFileType[] = [
  { ext: "md", label: "Markdown", isMarkdown: true, highlight: "markdown" },
  { ext: "json", label: "JSON", isMarkdown: false, highlight: "json" },
  { ext: "yaml", label: "YAML", isMarkdown: false, highlight: "yaml" },
  { ext: "yml", label: "YAML", isMarkdown: false, highlight: "yaml" },
  { ext: "txt", label: "Text", isMarkdown: false, highlight: "plain" },
  {
    ext: "fsh",
    label: "FHIR Shorthand",
    isMarkdown: false,
    highlight: "plain",
  },
];

/** Supported extensions with a leading dot, e.g. [".md", ".json", …]. */
export const SUPPORTED_EXTENSIONS: readonly string[] = SUPPORTED_FILE_TYPES.map(
  (type) => `.${type.ext}`,
);

/** Lowercase extension (no dot) of a path's final segment, or "" if none. */
function extensionOf(path: string): string {
  const leaf = path.split(/[\\/]/).pop() ?? "";
  const dotIndex = leaf.lastIndexOf(".");
  return dotIndex >= 0 ? leaf.slice(dotIndex + 1).toLowerCase() : "";
}

/** The supported file type for `path`, or undefined if the type is unsupported. */
export function fileTypeForPath(path: string): SupportedFileType | undefined {
  const ext = extensionOf(path);
  return SUPPORTED_FILE_TYPES.find((type) => type.ext === ext);
}

/** Whether margins can open `path` at all (any supported file type). */
export function isSupportedPath(path: string): boolean {
  return fileTypeForPath(path) !== undefined;
}

/**
 * Whether `path` is a markdown file — the only type that gets the rich-text
 * editor and CriticMarkup comment/review rail.
 */
export function isMarkdownPath(path: string): boolean {
  return fileTypeForPath(path)?.isMarkdown === true;
}

/** CodeMirror grammar to load for `path`; "plain" for unknown/plain types. */
export function codeHighlightForPath(path: string): CodeHighlight {
  return fileTypeForPath(path)?.highlight ?? "plain";
}
