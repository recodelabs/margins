import { describe, expect, it } from "vitest";
import { type FileMeta, getFolderContents, splitPath } from "./github-tree";

describe("getFolderContents", () => {
  const files: FileMeta[] = [
    { path: "README.md", size: 100 },
    { path: "docs/intro.md", size: 200 },
    { path: "docs/design/plan.md", size: 300 },
    { path: "docs/design/spec.md", size: 400 },
    { path: "docs/archive/old.md", size: 500 },
    { path: "notes/scratch.md", size: 600 },
  ];

  it("returns folders first, then files, sorted alphabetically", () => {
    const entries = getFolderContents(files, "");
    expect(entries.map((e) => e.name)).toEqual(["docs", "notes", "README.md"]);
    expect(entries[0].kind).toBe("folder");
    expect(entries[1].kind).toBe("folder");
    expect(entries[2].kind).toBe("file");
  });

  it("root file has correct path and size", () => {
    const entries = getFolderContents(files, "");
    const readme = entries.find((e) => e.name === "README.md");
    expect(readme?.path).toBe("README.md");
    expect(readme?.kind === "file" && readme.size).toBe(100);
  });

  it("drills into a subfolder", () => {
    const entries = getFolderContents(files, "docs");
    // subfolders: archive, design; file: intro.md
    expect(entries.map((e) => e.name)).toEqual([
      "archive",
      "design",
      "intro.md",
    ]);
    expect(entries[0].kind).toBe("folder");
    expect(entries[0].path).toBe("docs/archive");
    expect(entries[2].kind).toBe("file");
    expect(entries[2].path).toBe("docs/intro.md");
    expect(entries[2].kind === "file" && entries[2].size).toBe(200);
  });

  it("drills into a deeper subfolder", () => {
    const entries = getFolderContents(files, "docs/design");
    expect(entries.map((e) => e.name)).toEqual(["plan.md", "spec.md"]);
    expect(entries.every((e) => e.kind === "file")).toBe(true);
    expect(entries[0].path).toBe("docs/design/plan.md");
  });

  it("returns empty array for a folder with no .md files", () => {
    const entries = getFolderContents(files, "nonexistent");
    expect(entries).toEqual([]);
  });

  it("only shows folders containing .md files", () => {
    const entries = getFolderContents(files, "");
    // There is no top-level folder without .md descendants
    expect(
      entries.filter((e) => e.kind === "folder").map((e) => e.name),
    ).toEqual(["docs", "notes"]);
  });

  it("handles single file at root", () => {
    const entries = getFolderContents([{ path: "only.md", size: 42 }], "");
    expect(entries).toEqual([
      { kind: "file", name: "only.md", path: "only.md", size: 42 },
    ]);
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
