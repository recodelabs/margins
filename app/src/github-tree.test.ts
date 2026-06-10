import { describe, it, expect } from "vitest";
import { getFolderContents, splitPath } from "./github-tree";

describe("getFolderContents", () => {
  const paths = [
    "README.md",
    "docs/intro.md",
    "docs/design/plan.md",
    "docs/design/spec.md",
    "docs/archive/old.md",
    "notes/scratch.md",
  ];

  it("returns folders first, then files, sorted alphabetically", () => {
    const entries = getFolderContents(paths, "");
    expect(entries.map((e) => e.name)).toEqual(["docs", "notes", "README.md"]);
    expect(entries[0].kind).toBe("folder");
    expect(entries[1].kind).toBe("folder");
    expect(entries[2].kind).toBe("file");
  });

  it("root file has correct path", () => {
    const entries = getFolderContents(paths, "");
    const readme = entries.find((e) => e.name === "README.md");
    expect(readme?.path).toBe("README.md");
  });

  it("drills into a subfolder", () => {
    const entries = getFolderContents(paths, "docs");
    // subfolders: archive, design; file: intro.md
    expect(entries.map((e) => e.name)).toEqual(["archive", "design", "intro.md"]);
    expect(entries[0].kind).toBe("folder");
    expect(entries[0].path).toBe("docs/archive");
    expect(entries[2].kind).toBe("file");
    expect(entries[2].path).toBe("docs/intro.md");
  });

  it("drills into a deeper subfolder", () => {
    const entries = getFolderContents(paths, "docs/design");
    expect(entries.map((e) => e.name)).toEqual(["plan.md", "spec.md"]);
    expect(entries.every((e) => e.kind === "file")).toBe(true);
    expect(entries[0].path).toBe("docs/design/plan.md");
  });

  it("returns empty array for a folder with no .md files", () => {
    const entries = getFolderContents(paths, "nonexistent");
    expect(entries).toEqual([]);
  });

  it("only shows folders containing .md files", () => {
    const entries = getFolderContents(paths, "");
    // There is no top-level folder without .md descendants
    expect(entries.filter((e) => e.kind === "folder").map((e) => e.name)).toEqual(["docs", "notes"]);
  });

  it("handles single file at root", () => {
    const entries = getFolderContents(["only.md"], "");
    expect(entries).toEqual([{ kind: "file", name: "only.md", path: "only.md" }]);
  });

  it("handles empty path list", () => {
    expect(getFolderContents([], "")).toEqual([]);
    expect(getFolderContents([], "docs")).toEqual([]);
  });
});

describe("splitPath", () => {
  it("returns empty array for empty string", () => {
    expect(splitPath("")).toEqual([]);
  });

  it("splits a single-level path", () => {
    expect(splitPath("docs")).toEqual([{ name: "docs", path: "docs" }]);
  });

  it("splits a multi-level path", () => {
    expect(splitPath("docs/design/patterns")).toEqual([
      { name: "docs", path: "docs" },
      { name: "design", path: "docs/design" },
      { name: "patterns", path: "docs/design/patterns" },
    ]);
  });
});
