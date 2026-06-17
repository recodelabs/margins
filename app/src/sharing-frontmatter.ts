import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { prependYamlFrontmatter, splitYamlFrontmatter } from "./markdown";

export type SharingFlagKey = "public" | "comments" | "suggestions";
export interface SharingFlags {
  public: boolean;
  comments: boolean;
  suggestions: boolean;
}

function parseFrontmatterObject(
  frontmatter: string | null,
): Record<string, unknown> {
  if (!frontmatter) return {};
  const inner = frontmatter
    .replace(/^---[ \t]*\r?\n/, "")
    .replace(/\r?\n---[ \t]*\r?\n?\s*$/, "\n");
  try {
    const parsed = parseYaml(inner);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function getSharingFlags(markdown: string): SharingFlags {
  const { frontmatter } = splitYamlFrontmatter(markdown);
  const obj = parseFrontmatterObject(frontmatter);
  return {
    public: obj.public === true,
    comments: obj.comments === true,
    suggestions: obj.suggestions === true,
  };
}

/**
 * Set (or clear) one sharing flag, preserving the body and all other frontmatter
 * keys. `value === true` writes `key: true`; `value === false` removes the key
 * (absent ⇒ false is the documented default).
 */
export function setSharingFlag(
  markdown: string,
  key: SharingFlagKey,
  value: boolean,
): string {
  const { frontmatter, body } = splitYamlFrontmatter(markdown);
  const obj = parseFrontmatterObject(frontmatter);
  if (value) obj[key] = true;
  else delete obj[key];

  if (Object.keys(obj).length === 0) return body;
  const yamlText = stringifyYaml(obj).replace(/\n$/, "");
  return prependYamlFrontmatter(body, `---\n${yamlText}\n---\n\n`);
}
