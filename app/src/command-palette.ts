/**
 * Pure model + fuzzy-matching logic for the ⌘K command palette (REC-504).
 *
 * Kept free of React/DOM/async so the ranking is trivially unit-testable. The
 * `CommandPalette` component renders these; `DocumentWorkspace` builds the list.
 */

/** A single selectable row in the palette. */
export interface PaletteCommand {
  /** Stable identifier handed back to `onRun`. */
  id: string;
  /** Display label, also the primary fuzzy-match target. */
  title: string;
  /** Section heading the row is listed under. */
  group: string;
  /** Extra fuzzy-match terms that don't appear in the title (e.g. "dark"). */
  keywords?: string[];
  /** Right-aligned secondary text, e.g. the current value or shortcut. */
  hint?: string;
}

function isSeparator(ch: string): boolean {
  return ch === " " || ch === "/" || ch === "-" || ch === "_" || ch === ".";
}

/**
 * Score how well `query` fuzzy-matches `text`. Higher is a better match;
 * returns `null` when `query` is not a (case-insensitive) subsequence of `text`.
 *
 * Greedy earliest-match alignment — correct for subsequence *existence*, and
 * good enough for ranking. Bonuses: word-boundary hits, contiguous runs,
 * prefix, and exact equality; a small length penalty favours shorter targets.
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (query.length === 0) return 0;

  const t = text.toLowerCase();
  const q = query.toLowerCase();

  let score = 0;
  let qi = 0;
  let consecutive = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let charScore = 1;
      if (ti === 0 || isSeparator(t[ti - 1])) {
        charScore += 10; // start of a word
      } else if (consecutive > 0) {
        charScore += 5; // part of a contiguous run
      }
      score += charScore;
      consecutive += 1;
      qi += 1;
    } else {
      consecutive = 0;
    }
  }

  if (qi < q.length) return null; // not all query characters matched

  if (t === q) {
    score += 100;
  } else if (t.startsWith(q)) {
    score += 30;
  }

  // Favour shorter targets when scores are otherwise close.
  score -= t.length * 0.1;
  return score;
}

/** Best score for a command across its title and keywords (or null). */
function commandScore(command: PaletteCommand, query: string): number | null {
  let best = fuzzyScore(command.title, query);
  for (const keyword of command.keywords ?? []) {
    const s = fuzzyScore(keyword, query);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

/**
 * Filter and rank `commands` by `query`. An empty/whitespace query returns the
 * input unchanged (callers cap large lists before passing them in). Ties break
 * by shorter title, then original order — so the result is stable.
 */
export function filterCommands<T extends PaletteCommand>(
  commands: T[],
  query: string,
): T[] {
  if (query.trim().length === 0) return commands;

  return commands
    .map((command, index) => ({
      command,
      index,
      score: commandScore(command, query),
    }))
    .filter((entry): entry is typeof entry & { score: number } => {
      return entry.score !== null;
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.command.title.length - b.command.title.length ||
        a.index - b.index,
    )
    .map((entry) => entry.command);
}
