import { describe, expect, it } from "vitest";
import { validateNewFileName } from "./new-file-name";

describe("validateNewFileName", () => {
  it("accepts a fresh .md name", () => {
    expect(validateNewFileName("notes.md", [])).toEqual({ ok: true });
  });

  it("rejects an empty name", () => {
    const r = validateNewFileName("   ", []);
    expect(r.ok).toBe(false);
  });

  it("rejects a name without a .md extension", () => {
    const r = validateNewFileName("notes.txt", []);
    expect(r).toEqual({ ok: false, error: "File name must end in .md" });
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
