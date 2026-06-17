/**
 * Return the clean "current" text of a CriticMarkup document for a public read:
 *  - comments `{>>…<<}` are removed, along with an id/metadata block `{…}` that
 *    immediately follows them;
 *  - highlights `{==text==}` are unwrapped to `text` (and a trailing comment removed);
 *  - suggestions are rejected: additions `{++…++}` and deletions `{--…--}` removed,
 *    substitutions `{~~old~>new~~}` collapse to `old`.
 *  - unterminated comments (`{>>` with no closing `<<}`) are dropped through
 *    end-of-string so they cannot leak internal review text into the public body.
 * Order matters: resolve comment+metadata first, then highlights, then suggestions.
 */
export function stripCriticMarkup(markdown: string): string {
  let out = markdown;
  // Comment followed by an optional metadata block: `{>>…<<}` then optional `{key=…}`.
  // The metadata block must start with a word-like key (letter/underscore then word chars then `=`)
  // so that adjacent CriticMarkup tokens like `{==…==}`, `{~~…~~}`, `{++…++}`, `{--…--}` are NOT consumed.
  out = out.replace(/\{>>[\s\S]*?<<\}(\{\s*[A-Za-z_][\w-]*=[^{}]*\})?/g, "");
  // Highlight: `{==text==}` -> `text` (any trailing comment was already removed above).
  out = out.replace(/\{==([\s\S]*?)==\}/g, "$1");
  // Substitution: `{~~old~>new~~}` -> `old`.
  out = out.replace(/\{~~([\s\S]*?)~>[\s\S]*?~~\}/g, "$1");
  // Addition / deletion: drop the marked span entirely.
  out = out.replace(/\{\+\+[\s\S]*?\+\+\}/g, "");
  out = out.replace(/\{--[\s\S]*?--\}/g, "");
  // Defensive: an unterminated comment (`{>>` with no closing `<<}`) would
  // otherwise leak its text into the public body. Drop it through end-of-string.
  out = out.replace(/\{>>[\s\S]*$/g, "");
  return out;
}
