// Two-way line diff for the file-history view. Given two versions of a document
// it produces a flat list of rows — unchanged context, removed lines, and added
// lines — in document order, suitable for rendering a git-style unified diff.
//
// It reuses the longest-common-subsequence alignment from `merge.ts` so the diff
// matches how the app already reasons about line-level edits, and stays pure and
// dependency-free for easy testing.

import { lcsMatches } from "./merge";

/** One row of a unified diff. */
export interface DiffRow {
  type: "context" | "add" | "del";
  /** The line's text, without its trailing newline. */
  text: string;
  /** 1-based line number in the old version; null for added lines. */
  oldLine: number | null;
  /** 1-based line number in the new version; null for removed lines. */
  newLine: number | null;
}

/**
 * Diff `oldText` against `newText`, line by line. Both are split on "\n", so a
 * trailing newline shows up as a trailing empty line and blank-line changes stay
 * visible. Removed lines are emitted before added lines within each changed span,
 * matching conventional unified-diff ordering.
 */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const matches = lcsMatches(oldLines, newLines);

  const rows: DiffRow[] = [];
  let oi = 0;
  let ni = 0;

  const pushChanges = (oldEnd: number, newEnd: number) => {
    while (oi < oldEnd) {
      rows.push({
        type: "del",
        text: oldLines[oi],
        oldLine: oi + 1,
        newLine: null,
      });
      oi += 1;
    }
    while (ni < newEnd) {
      rows.push({
        type: "add",
        text: newLines[ni],
        oldLine: null,
        newLine: ni + 1,
      });
      ni += 1;
    }
  };

  for (const [mo, mn] of matches) {
    pushChanges(mo, mn);
    rows.push({
      type: "context",
      text: oldLines[mo],
      oldLine: mo + 1,
      newLine: mn + 1,
    });
    oi = mo + 1;
    ni = mn + 1;
  }
  // Trailing removals/additions after the last matched line.
  pushChanges(oldLines.length, newLines.length);

  return rows;
}
