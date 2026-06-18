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
    // Frontmatter region (before the body) must not contain any critic markup
    const fmEnd = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(out);
    expect(fmEnd).not.toBeNull();
    const frontmatter = out.slice(0, fmEnd![0].length);
    expect(frontmatter).not.toContain("{==");
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

  // Finding 1: occurrence counting must skip matches inside existing critic markup
  it("counts occurrences in plain text only, skipping matches inside critic markup", () => {
    const md = base('{==cat==}{>>note<<}{id="x" by="y" at="t"} The cat sat.\n');
    const out = insertPublicComment(md, {
      mode: "new", quote: "cat", occurrence: 1, text: "plain", authorName: "A", id: "g5", atIso: "t",
    });
    // The plain-text "cat" in "The cat sat." must be wrapped, NOT the one inside {==cat==}
    expect(out).toContain("The {==cat==}{>>plain<<}");
    // The original critic anchor must remain untouched
    expect(out).toContain('{==cat==}{>>note<<}{id="x"');
  });

  // Finding 2a: text containing CriticMarkup close delimiters must throw
  it("throws AnchorError when text contains <<}", () => {
    expect(() => insertPublicComment(base("hello world\n"), {
      mode: "new", quote: "hello", occurrence: 1,
      text: "a <<} b", authorName: "A", id: "g6", atIso: "t",
    })).toThrow(AnchorError);
  });

  // Finding 2b: text containing CriticMarkup open delimiters must throw
  it("throws AnchorError when text contains {>>", () => {
    expect(() => insertPublicComment(base("hello world\n"), {
      mode: "new", quote: "hello", occurrence: 1,
      text: "a {>> b", authorName: "A", id: "g7", atIso: "t",
    })).toThrow(AnchorError);
  });

  // Finding 2c: quote containing ==} must throw
  it("throws AnchorError when quote contains ==}", () => {
    expect(() => insertPublicComment(base("x ==} y\n"), {
      mode: "new", quote: "x ==} y", occurrence: 1,
      text: "safe", authorName: "A", id: "g8", atIso: "t",
    })).toThrow(AnchorError);
  });

  // Finding 2d: quote containing {== must throw
  it("throws AnchorError when quote contains {==", () => {
    expect(() => insertPublicComment(base("x {== y\n"), {
      mode: "new", quote: "x {== y", occurrence: 1,
      text: "safe", authorName: "A", id: "g9", atIso: "t",
    })).toThrow(AnchorError);
  });
});
