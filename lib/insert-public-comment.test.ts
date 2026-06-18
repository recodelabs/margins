// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AnchorError, insertPublicComment } from "./insert-public-comment";

const base = (body: string) => `---\npublic: true\ncomments: true\n---\n${body}`;

describe("insertPublicComment — new", () => {
  it("wraps the chosen occurrence in a guest comment thread", () => {
    const md = base("The cat sat. The cat ran.\n");
    const out = insertPublicComment(md, {
      mode: "new", quote: "cat", occurrence: 2,
      text: "which one?", authorName: 'Jane "JD"', id: "g1", atIso: "2026-06-18T00:00:00.000Z",
    });
    expect(out).toContain('The cat sat. The {==cat==}{>>which one?<<}{id="g1" by="Jane \\"JD\\"" at="2026-06-18T00:00:00.000Z" guest="true"} ran.');
  });

  it("ignores matches inside the frontmatter block", () => {
    const md = base("public mention of cat\n"); // 'public' also in frontmatter
    const out = insertPublicComment(md, {
      mode: "new", quote: "public", occurrence: 1,
      text: "x", authorName: "A", id: "g2", atIso: "2026-06-18T00:00:00.000Z",
    });
    expect(out).toContain("{==public==}"); // the body occurrence, not the frontmatter key
    expect(out.split("---")[1]).not.toContain("{==");
  });

  it("throws AnchorError when the occurrence does not exist", () => {
    expect(() => insertPublicComment(base("hello\n"), {
      mode: "new", quote: "cat", occurrence: 1, text: "x", authorName: "A", id: "g3", atIso: "t",
    })).toThrow(AnchorError);
  });

  it("throws AnchorError when the match overlaps existing critic markup", () => {
    const md = base('a {==cat==}{>>note<<}{id="x" by="y" at="t"} b\n');
    expect(() => insertPublicComment(md, {
      mode: "new", quote: "cat", occurrence: 1, text: "x", authorName: "A", id: "g4", atIso: "t",
    })).toThrow(AnchorError);
  });
});
