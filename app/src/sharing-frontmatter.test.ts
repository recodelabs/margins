import { describe, expect, it } from "vitest";
import { getSharingFlags, setSharingFlag } from "./sharing-frontmatter";

describe("getSharingFlags", () => {
  it("defaults to all-false with no frontmatter", () => {
    expect(getSharingFlags("# Body\n")).toEqual({
      public: false,
      comments: false,
      suggestions: false,
    });
  });
  it("reads true flags", () => {
    expect(getSharingFlags("---\npublic: true\n---\n# Body\n").public).toBe(
      true,
    );
  });
});

describe("setSharingFlag", () => {
  it("adds a frontmatter block when none exists", () => {
    const out = setSharingFlag("# Body\n", "public", true);
    expect(getSharingFlags(out).public).toBe(true);
    expect(out).toContain("# Body");
  });
  it("sets a key without disturbing other keys or the body", () => {
    const md = "---\nversion: 1\ntags: [a]\n---\n\n# Title\n\nText.\n";
    const out = setSharingFlag(md, "public", true);
    expect(getSharingFlags(out).public).toBe(true);
    expect(out).toContain("version: 1");
    expect(out).toContain("# Title");
    expect(out).toContain("Text.");
  });
  it("flips a flag false (removes it) and round-trips", () => {
    const md = "---\npublic: true\n---\n# B\n";
    const off = setSharingFlag(md, "public", false);
    expect(getSharingFlags(off).public).toBe(false);
    const on = setSharingFlag(off, "public", true);
    expect(getSharingFlags(on).public).toBe(true);
  });
});
