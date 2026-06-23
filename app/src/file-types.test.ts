import { describe, expect, it } from "vitest";
import {
  codeHighlightForPath,
  fileTypeForPath,
  isMarkdownPath,
  isSupportedPath,
  SUPPORTED_EXTENSIONS,
} from "./file-types";

describe("isSupportedPath", () => {
  it("accepts every supported extension", () => {
    for (const path of [
      "notes.md",
      "data.json",
      "config.yaml",
      "config.yml",
      "readme.txt",
      "patient.fsh",
    ]) {
      expect(isSupportedPath(path)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isSupportedPath("README.MD")).toBe(true);
    expect(isSupportedPath("DATA.JSON")).toBe(true);
  });

  it("matches the final segment of a nested path", () => {
    expect(isSupportedPath("a/b/c/data.json")).toBe(true);
    expect(isSupportedPath("a.json/notes.md")).toBe(true);
  });

  it("rejects unsupported or extension-less paths", () => {
    for (const path of [
      "image.png",
      "script.ts",
      "notes.mdx",
      "README",
      "archive.tar.gz",
      "folder.json/file",
    ]) {
      expect(isSupportedPath(path)).toBe(false);
    }
  });
});

describe("isMarkdownPath", () => {
  it("is true only for markdown", () => {
    expect(isMarkdownPath("notes.md")).toBe(true);
    expect(isMarkdownPath("README.MD")).toBe(true);
  });

  it("is false for non-markdown supported types", () => {
    for (const path of [
      "data.json",
      "config.yaml",
      "x.yml",
      "a.txt",
      "p.fsh",
    ]) {
      expect(isMarkdownPath(path)).toBe(false);
    }
  });

  it("is false for unsupported paths", () => {
    expect(isMarkdownPath("image.png")).toBe(false);
    expect(isMarkdownPath("README")).toBe(false);
  });
});

describe("fileTypeForPath", () => {
  it("returns the label for known types", () => {
    expect(fileTypeForPath("data.json")?.label).toBe("JSON");
    expect(fileTypeForPath("config.yml")?.label).toBe("YAML");
    expect(fileTypeForPath("patient.fsh")?.label).toBe("FHIR Shorthand");
  });

  it("returns undefined for unknown types", () => {
    expect(fileTypeForPath("image.png")).toBeUndefined();
  });
});

describe("codeHighlightForPath", () => {
  it("maps extensions to grammars", () => {
    expect(codeHighlightForPath("notes.md")).toBe("markdown");
    expect(codeHighlightForPath("data.json")).toBe("json");
    expect(codeHighlightForPath("config.yaml")).toBe("yaml");
    expect(codeHighlightForPath("config.yml")).toBe("yaml");
    expect(codeHighlightForPath("readme.txt")).toBe("plain");
    expect(codeHighlightForPath("patient.fsh")).toBe("plain");
  });

  it("falls back to plain for unsupported types", () => {
    expect(codeHighlightForPath("image.png")).toBe("plain");
  });
});

describe("SUPPORTED_EXTENSIONS", () => {
  it("lists dotted extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".md");
    expect(SUPPORTED_EXTENSIONS).toContain(".json");
    expect(SUPPORTED_EXTENSIONS).toContain(".fsh");
  });
});
