export type CalloutType =
  | "note"
  | "tip"
  | "important"
  | "warning"
  | "caution";

export interface CalloutMarker {
  type: CalloutType;
  /** Length of the `[!type]` marker plus one optional trailing space to hide. */
  markerLength: number;
}

// `[!type]` at the very start of a blockquote's first line (GitHub alert
// syntax), optionally followed by a single space before inline body text.
const CALLOUT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]?/i;

/**
 * Detects a GitHub-style callout marker at the start of a blockquote's first
 * paragraph. Returns the callout type and the length of the marker (plus one
 * trailing space) to hide, or null when the text isn't a callout.
 */
export function parseCalloutMarker(text: string): CalloutMarker | null {
  const match = CALLOUT_RE.exec(text);
  if (!match) return null;
  return {
    type: match[1].toLowerCase() as CalloutType,
    markerLength: match[0].length,
  };
}
