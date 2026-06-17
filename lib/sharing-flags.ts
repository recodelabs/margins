export interface SharingFlags {
  public: boolean;
  comments: boolean;
  suggestions: boolean;
}

const FLAG_KEYS = ["public", "comments", "suggestions"] as const;

/** Extract the raw text inside the leading `---`…`---` frontmatter block, or null. */
function frontmatterBlock(markdown: string): string | null {
  const match = markdown.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/,
  );
  return match ? match[1] : null;
}

/**
 * Read the public/comments/suggestions booleans from a doc's frontmatter.
 * Absent, non-`true`, or unparseable ⇒ false (fail closed). A `key: true` that
 * only appears in the body (not the frontmatter block) is ignored.
 */
export function readSharingFlags(markdown: string): SharingFlags {
  const block = frontmatterBlock(markdown);
  const flags: SharingFlags = {
    public: false,
    comments: false,
    suggestions: false,
  };
  if (!block) return flags;
  for (const key of FLAG_KEYS) {
    // `key:` then a value; capture the first token before any `#` comment.
    const re = new RegExp(`^${key}:[ \\t]*([^\\r\\n#]*)`, "im");
    const m = block.match(re);
    if (m && m[1].trim().toLowerCase() === "true") flags[key] = true;
  }
  return flags;
}
