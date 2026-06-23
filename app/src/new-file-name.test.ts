import { describe, expect, it } from "vitest";
import { validateNewFileName } from "./new-file-name";

describe("validateNewFileName", () => {
  it("accepts a fresh .md name", () => {
    expect(validateNewFileName("notes.md", [])).toEqual({ ok: true });
  });

  it("rejects an empty name", () => {
    expect(validateNewFileName("   ", [])).toEqual({
      ok: false,
      error: "Enter a file name",
    });
  });

  it("accepts the other supported extensions", () => {
    for (const name of [
      "data.json",
      "config.yaml",
      "config.yml",
      "notes.txt",
      "patient.fsh",
    ]) {
      expect(validateNewFileName(name, [])).toEqual({ ok: true });
    }
  });

  it("rejects an unsupported extension", () => {
    const r = validateNewFileName("logo.png", []);
    expect(r).toEqual({
      ok: false,
      error: "File name must end in .md, .json, .yaml, .yml, .txt or .fsh",
    });
  });

  it("rejects a name containing a slash", () => {
    const r = validateNewFileName("sub/notes.md", []);
    expect(r).toEqual({ ok: false, error: "File name can't contain '/'" });
  });

  it("rejects a name that already exists (case-insensitive)", () => {
    const r = validateNewFileName("Notes.md", ["notes.md"]);
    expect(r).toEqual({
      ok: false,
      error: "A file with that name already exists here",
    });
  });

  it("accepts .MD uppercase extension", () => {
    expect(validateNewFileName("README.MD", [])).toEqual({ ok: true });
  });
});
