import { describe, expect, it } from "vitest";
import { canonicalizeRichTextMarkdown, markdownEquivalent } from "./index";

describe("canonicalizeRichTextMarkdown", () => {
  it("is idempotent: canonicalizing twice equals canonicalizing once", () => {
    const samples = [
      "# Title\n\nHello world.\n",
      "- one\n- two\n",
      "- parent\n  - child\n",
      "- [ ] todo\n- [x] done\n",
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
      "Just one line.",
      "Para one.\n\nPara two.\n",
    ];
    for (const md of samples) {
      const once = canonicalizeRichTextMarkdown(md);
      const twice = canonicalizeRichTextMarkdown(once);
      expect(twice).toBe(once);
    }
  });
});

describe("markdownEquivalent", () => {
  it("treats raw disk content and its round-trip as equivalent (no phantom edit)", () => {
    const docs = [
      "# Title\n\nHello world.\n",
      "- parent\n  - child\n",
      "- [ ] todo\n- [x] done\n",
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
      "Just one line.",
      "## Heading\n\nSome *italic* and **bold**.\n\nAnother paragraph.\n",
    ];
    for (const raw of docs) {
      const serialized = canonicalizeRichTextMarkdown(raw);
      // The editor's serialization of an untouched doc must NOT register as dirty.
      expect(markdownEquivalent(serialized, raw)).toBe(true);
    }
  });

  it("detects a genuine content edit as not equivalent", () => {
    const raw = "# Title\n\nHello world.\n";
    const edited = "# Title\n\nHello world, edited.\n";
    expect(markdownEquivalent(edited, raw)).toBe(false);
  });
});
