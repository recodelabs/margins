/**
 * Return the clean "current" text of a CriticMarkup document for a public read:
 *  - comments `{>>…<<}` are removed, along with an id/metadata block `{…}` that
 *    immediately follows them;
 *  - highlights `{==text==}` are unwrapped to `text` (and a trailing comment removed);
 *  - suggestions are rejected: additions `{++…++}` and deletions `{--…--}` removed,
 *    substitutions `{~~old~>new~~}` collapse to `old`.
 * Order matters: resolve comment+metadata first, then highlights, then suggestions.
 */
export function stripCriticMarkup(markdown: string): string {
  let out = markdown;
  // Comment followed by an optional metadata block: `{>>…<<}` then optional `{…}`.
  out = out.replace(/\{>>[\s\S]*?<<\}(\{[^{}]*\})?/g, "");
  // Highlight: `{==text==}` -> `text` (any trailing comment was already removed above).
  out = out.replace(/\{==([\s\S]*?)==\}/g, "$1");
  // Substitution: `{~~old~>new~~}` -> `old`.
  out = out.replace(/\{~~([\s\S]*?)~>[\s\S]*?~~\}/g, "$1");
  // Addition / deletion: drop the marked span entirely.
  out = out.replace(/\{\+\+[\s\S]*?\+\+\}/g, "");
  out = out.replace(/\{--[\s\S]*?--\}/g, "");
  return out;
}
