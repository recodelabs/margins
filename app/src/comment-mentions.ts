// Pure, framework-free logic for the comment composer's @mention autocomplete.
// Kept separate from the React component so the caret/query/insertion rules can
// be unit-tested without a DOM. The composer is a plain <textarea>, so all of
// this works on a string + caret offset rather than editor nodes.

export interface ActiveMentionQuery {
  /** The text typed after `@`, up to the caret (may be empty). */
  query: string;
  /** Index of the triggering `@` in the source text. */
  start: number;
  /** Caret index; the mention occupies `[start, end)`. */
  end: number;
}

// GitHub logins allow alphanumerics and single hyphens; we accept that set as
// the in-progress query so typos with other punctuation simply dismiss the menu.
const MENTION_QUERY_CHAR = /[A-Za-z0-9-]/;

/**
 * Returns the mention currently being typed at `caret`, or null when the caret
 * is not inside an `@token`. The `@` must sit at the start of the text or follow
 * whitespace, so email-like `a@b` fragments do not trigger the menu.
 */
export function getActiveMentionQuery(
  text: string,
  caret: number,
): ActiveMentionQuery | null {
  if (caret < 0 || caret > text.length) return null;

  let index = caret - 1;
  while (index >= 0) {
    const char = text[index];
    if (char === "@") break;
    if (!char || !MENTION_QUERY_CHAR.test(char)) return null;
    index -= 1;
  }

  if (index < 0 || text[index] !== "@") return null;

  const precedingChar = index > 0 ? text[index - 1] : undefined;
  if (precedingChar !== undefined && !/\s/.test(precedingChar)) return null;

  return {
    query: text.slice(index + 1, caret),
    start: index,
    end: caret,
  };
}

/**
 * Filters `candidates` against `query` case-insensitively, surfacing prefix
 * matches ahead of looser substring matches and capping the result to `limit`.
 */
export function filterMentionCandidates(
  candidates: readonly string[],
  query: string,
  limit = 6,
): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return candidates.slice(0, limit);

  const prefix: string[] = [];
  const substring: string[] = [];
  for (const candidate of candidates) {
    const haystack = candidate.toLowerCase();
    if (haystack.startsWith(needle)) {
      prefix.push(candidate);
    } else if (haystack.includes(needle)) {
      substring.push(candidate);
    }
  }

  return [...prefix, ...substring].slice(0, limit);
}

export interface AppliedMention {
  text: string;
  caret: number;
}

/**
 * Replaces the active mention token `[start, end)` with `@login ` and returns
 * the new text plus the caret position just past the inserted trailing space.
 */
export function applyMention(
  text: string,
  start: number,
  end: number,
  login: string,
): AppliedMention {
  const inserted = `@${login} `;
  const next = text.slice(0, start) + inserted + text.slice(end);
  return { text: next, caret: start + inserted.length };
}
