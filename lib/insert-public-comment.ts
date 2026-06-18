// lib/insert-public-comment.ts
export interface NewCommentInput {
  mode: "new";
  quote: string;
  occurrence: number;
  text: string; authorName: string; id: string; atIso: string;
}
export interface ReplyCommentInput {
  mode: "reply";
  parentId: string;
  text: string; authorName: string; id: string; atIso: string;
}
export type InsertInput = NewCommentInput | ReplyCommentInput;

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorError";
  }
}

const escapeAttr = (v: string): string => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function frontmatterEnd(markdown: string): number {
  const m = markdown.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return m ? m[0].length : 0;
}

function metaBlock(id: string, by: string, atIso: string, parentId?: string): string {
  let s = `{id="${escapeAttr(id)}" by="${escapeAttr(by)}" at="${escapeAttr(atIso)}"`;
  if (parentId) s += ` re="${escapeAttr(parentId)}"`;
  s += ` guest="true"}`;
  return s;
}

function commentBlock(text: string, id: string, by: string, atIso: string, parentId?: string): string {
  return `{>>${text}<<}${metaBlock(id, by, atIso, parentId)}`;
}

export function insertPublicComment(markdown: string, input: InsertInput): string {
  if (input.mode === "new") {
    const bodyStart = frontmatterEnd(markdown);
    const body = markdown.slice(bodyStart);

    // Find all critic markup regions in the body so we can detect overlaps
    const criticRegions: Array<{ start: number; end: number }> = [];
    const criticRe = /\{==[\s\S]*?==\}|\{>>[\s\S]*?<<\}(\{[^{}]*\})?/g;
    let cm: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
    while ((cm = criticRe.exec(body)) !== null) {
      criticRegions.push({ start: cm.index, end: cm.index + cm[0].length });
    }

    // Find the occurrence-th plain-text match of quote within the body
    let count = 0;
    let searchFrom = 0;
    let at = -1;
    while (count < input.occurrence) {
      const idx = body.indexOf(input.quote, searchFrom);
      if (idx === -1) throw new AnchorError("quote occurrence not found");
      count++;
      at = idx;
      searchFrom = idx + input.quote.length;
    }

    // Reject if the match overlaps any existing critic markup region
    const matchEnd = at + input.quote.length;
    for (const region of criticRegions) {
      if (at < region.end && matchEnd > region.start) {
        throw new AnchorError("match overlaps existing critic markup");
      }
    }

    const absoluteAt = bodyStart + at;
    const absoluteEnd = bodyStart + matchEnd;
    const wrapped = `{==${input.quote}==}${commentBlock(input.text, input.id, input.authorName, input.atIso)}`;
    return markdown.slice(0, absoluteAt) + wrapped + markdown.slice(absoluteEnd);
  }

  // reply: insert a block immediately after the parent's metadata block
  const escaped = input.parentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parentMeta = new RegExp(`\\{id="${escaped}"[^}]*\\}`);
  const m = markdown.match(parentMeta);
  if (!m || m.index === undefined) throw new AnchorError("parent comment not found");
  const insertAt = m.index + m[0].length;
  const block = commentBlock(input.text, input.id, input.authorName, input.atIso, input.parentId);
  return markdown.slice(0, insertAt) + block + markdown.slice(insertAt);
}
