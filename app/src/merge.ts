// Line-based 3-way merge (diff3-style) for managing concurrent edits to a doc.
//
// When two people edit the same markdown file, the save that lands second is
// rejected with a 409 and the app gets the other person's content back. Most of
// the time the two edits touch different parts of the doc, so we can merge them
// automatically; only edits that overlap the same lines need a human to resolve.
//
// This module is intentionally dependency-free and pure so it can be unit
// tested in isolation and reused by any backend.

/** A region of the merged document where the two sides disagree. */
export interface MergeConflict {
  /** Lines from our draft for this region. */
  ours: string[];
  /** Lines from the common ancestor for this region. */
  base: string[];
  /** Lines from the version currently on the server. */
  theirs: string[];
}

export type MergeRegion =
  | { type: "stable"; lines: string[] }
  | ({ type: "conflict" } & MergeConflict);

export interface MergeResult {
  /** True when the merge resolved every region without human input. */
  clean: boolean;
  /**
   * The merged document. When `clean`, this is the final text to save. When not
   * clean, conflicting regions are wrapped in git-style markers so the text is
   * still inspectable; the structured `conflicts`/`regions` drive the resolve UI.
   */
  text: string;
  /** The ordered list of stable and conflicting regions. */
  regions: MergeRegion[];
  /** Just the conflicting regions, in document order. */
  conflicts: MergeConflict[];
}

const CONFLICT_START = "<<<<<<< yours";
const CONFLICT_SEP = "=======";
const CONFLICT_END = ">>>>>>> theirs";

/** A contiguous span of `base` that one side replaced with `lines`. */
interface Change {
  baseStart: number;
  baseEnd: number; // exclusive
  lines: string[];
}

/**
 * Longest-common-subsequence alignment between two line arrays, returned as the
 * matched index pairs in increasing order. Standard O(n*m) DP — fine for the
 * document sizes margins handles (a save is a single file).
 */
export function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matches.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matches;
}

/**
 * The set of base spans that `side` replaced, derived from the LCS alignment.
 * Each change records which base lines were touched and the side's replacement
 * lines for that span.
 */
function changesAgainstBase(base: string[], side: string[]): Change[] {
  const matches = lcsMatches(base, side);
  const changes: Change[] = [];
  let baseCursor = 0;
  let sideCursor = 0;
  // Sentinel match past the end captures any trailing insertion/deletion.
  for (const [bi, si] of [
    ...matches,
    [base.length, side.length] as [number, number],
  ]) {
    if (bi > baseCursor || si > sideCursor) {
      changes.push({
        baseStart: baseCursor,
        baseEnd: bi,
        lines: side.slice(sideCursor, si),
      });
    }
    baseCursor = bi + 1;
    sideCursor = si + 1;
  }
  return changes;
}

/**
 * Reconstruct what a side says for the base span [start, end), given the side's
 * changes that fall inside the cluster. Stable base lines are copied through;
 * changed spans are replaced with the side's lines.
 */
function projectSide(
  base: string[],
  start: number,
  end: number,
  changes: Change[],
): string[] {
  const out: string[] = [];
  let pos = start;
  for (const change of changes) {
    for (let k = pos; k < change.baseStart; k++) out.push(base[k]);
    out.push(...change.lines);
    pos = change.baseEnd;
  }
  for (let k = pos; k < end; k++) out.push(base[k]);
  return out;
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function mergeLines(
  base: string[],
  ours: string[],
  theirs: string[],
): MergeRegion[] {
  const oursChanges = changesAgainstBase(base, ours);
  const theirsChanges = changesAgainstBase(base, theirs);

  const regions: MergeRegion[] = [];
  let cursor = 0; // position in base
  let oi = 0;
  let ti = 0;

  const pushStable = (lines: string[]) => {
    if (lines.length === 0) return;
    const last = regions[regions.length - 1];
    if (last && last.type === "stable") {
      last.lines.push(...lines);
    } else {
      regions.push({ type: "stable", lines });
    }
  };

  while (oi < oursChanges.length || ti < theirsChanges.length) {
    const nextOurs = oursChanges[oi];
    const nextTheirs = theirsChanges[ti];
    const clusterStart = Math.min(
      nextOurs?.baseStart ?? Number.POSITIVE_INFINITY,
      nextTheirs?.baseStart ?? Number.POSITIVE_INFINITY,
    );

    // Emit untouched base lines leading up to the next change.
    pushStable(base.slice(cursor, clusterStart));

    // Grow a cluster over every change from either side that overlaps it, so
    // interleaved edits to the same region resolve together.
    let clusterEnd = clusterStart;
    const oursInCluster: Change[] = [];
    const theirsInCluster: Change[] = [];
    let grew = true;
    while (grew) {
      grew = false;
      while (
        oi < oursChanges.length &&
        oursChanges[oi].baseStart <= clusterEnd
      ) {
        clusterEnd = Math.max(clusterEnd, oursChanges[oi].baseEnd);
        oursInCluster.push(oursChanges[oi]);
        oi++;
        grew = true;
      }
      while (
        ti < theirsChanges.length &&
        theirsChanges[ti].baseStart <= clusterEnd
      ) {
        clusterEnd = Math.max(clusterEnd, theirsChanges[ti].baseEnd);
        theirsInCluster.push(theirsChanges[ti]);
        ti++;
        grew = true;
      }
    }

    const baseSlice = base.slice(clusterStart, clusterEnd);
    const ourSlice = projectSide(base, clusterStart, clusterEnd, oursInCluster);
    const theirSlice = projectSide(
      base,
      clusterStart,
      clusterEnd,
      theirsInCluster,
    );

    if (sameLines(ourSlice, theirSlice)) {
      // Both sides agree (including the case where they made the same edit).
      pushStable(ourSlice);
    } else if (sameLines(ourSlice, baseSlice)) {
      // Only they changed this region.
      pushStable(theirSlice);
    } else if (sameLines(theirSlice, baseSlice)) {
      // Only we changed this region.
      pushStable(ourSlice);
    } else {
      regions.push({
        type: "conflict",
        ours: ourSlice,
        base: baseSlice,
        theirs: theirSlice,
      });
    }

    cursor = clusterEnd;
  }

  pushStable(base.slice(cursor));
  return regions;
}

function renderRegions(regions: MergeRegion[]): string {
  const lines: string[] = [];
  for (const region of regions) {
    if (region.type === "stable") {
      lines.push(...region.lines);
    } else {
      lines.push(
        CONFLICT_START,
        ...region.ours,
        CONFLICT_SEP,
        ...region.theirs,
        CONFLICT_END,
      );
    }
  }
  return lines.join("\n");
}

/** Which side a human picked when resolving a conflicting region. */
export type ConflictChoice = "ours" | "theirs" | "both";

/**
 * Build the final document text from a merge's regions and the human's per-
 * conflict choices. `choices[i]` corresponds to the i-th conflict region in
 * document order; "both" keeps our lines followed by theirs.
 */
export function resolveRegions(
  regions: MergeRegion[],
  choices: ConflictChoice[],
): string {
  const lines: string[] = [];
  let conflictIndex = 0;
  for (const region of regions) {
    if (region.type === "stable") {
      lines.push(...region.lines);
      continue;
    }
    const choice = choices[conflictIndex] ?? "ours";
    conflictIndex++;
    if (choice === "ours") lines.push(...region.ours);
    else if (choice === "theirs") lines.push(...region.theirs);
    else lines.push(...region.ours, ...region.theirs);
  }
  return lines.join("\n");
}

/**
 * Three-way merge of `ours` and `theirs` against their common ancestor `base`.
 * Splitting on "\n" and re-joining round-trips exactly, so trailing newlines and
 * blank lines are preserved.
 */
export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): MergeResult {
  const regions = mergeLines(
    base.split("\n"),
    ours.split("\n"),
    theirs.split("\n"),
  );
  const conflicts = regions.filter(
    (region): region is { type: "conflict" } & MergeConflict =>
      region.type === "conflict",
  );
  const clean = conflicts.length === 0;
  const text = clean
    ? regions
        .flatMap((region) => (region.type === "stable" ? region.lines : []))
        .join("\n")
    : renderRegions(regions);

  return {
    clean,
    text,
    regions,
    conflicts: conflicts.map(({ ours: o, base: b, theirs: t }) => ({
      ours: o,
      base: b,
      theirs: t,
    })),
  };
}
