import { type MergeRegion, mergeText } from "./merge";
import { MarkdownFileConflictError, type Page } from "./storage";

export interface AutoMergeConflict {
  path: string;
  /** The common ancestor the resolved text must be merged against. */
  base: string;
  regions: MergeRegion[];
  /** Server version the resolved text must be saved against. */
  version?: string;
}

export type AutoMergeOutcome =
  | { kind: "saved"; savedDocument: Page; autoMerged: boolean }
  | { kind: "conflict"; conflict: AutoMergeConflict }
  | { kind: "exhausted" };

export type SaveFn = (
  path: string,
  content: string,
  expectedVersion?: string,
) => Promise<Page>;

/**
 * Save `content` to `path`, automatically folding in any concurrent save via a
 * 3-way merge against `base` (the common ancestor).
 *
 * On a version conflict the other person's content is merged into ours and the
 * save is retried. Because most edits touch different parts of the doc the merge
 * is usually clean and the retry lands without anyone noticing. Overlapping
 * edits return a `conflict` for a human to resolve. `exhausted` means a clean
 * merge kept losing the race against further saves.
 */
export async function saveWithAutoMerge(
  save: SaveFn,
  params: {
    path: string;
    content: string;
    base: string;
    expectedVersion?: string;
  },
  maxAttempts = 4,
): Promise<AutoMergeOutcome> {
  // `base` is the common ancestor and `ours` the content we're trying to land.
  // After a clean auto-merge they both advance: the merged text becomes our new
  // "ours" (it already folds in their changes) and their version becomes the new
  // ancestor, so a further race re-merges from the right point.
  let base = params.base;
  let ours = params.content;
  let expectedVersion = params.expectedVersion;
  let autoMerged = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const savedDocument = await save(params.path, ours, expectedVersion);
      return { kind: "saved", savedDocument, autoMerged };
    } catch (error) {
      if (!(error instanceof MarkdownFileConflictError)) throw error;

      const theirs = error.current.content;
      const merged = mergeText(base, ours, theirs);
      if (!merged.clean) {
        return {
          kind: "conflict",
          conflict: {
            path: params.path,
            // The resolved text will be built on top of their version, so that
            // is the ancestor for any follow-up merge during resolution.
            base: theirs,
            regions: merged.regions,
            version: error.current.version,
          },
        };
      }

      // Clean merge: retry the combined text against their version.
      ours = merged.text;
      base = theirs;
      expectedVersion = error.current.version;
      autoMerged = true;
    }
  }
  return { kind: "exhausted" };
}
