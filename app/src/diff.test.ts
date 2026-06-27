import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

describe("diffLines", () => {
  it("marks every line as context when the texts are identical", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");
    expect(rows).toEqual([
      { type: "context", text: "a", oldLine: 1, newLine: 1 },
      { type: "context", text: "b", oldLine: 2, newLine: 2 },
      { type: "context", text: "c", oldLine: 3, newLine: 3 },
    ]);
  });

  it("marks appended lines as additions with no old line number", () => {
    const rows = diffLines("a\nb", "a\nb\nc");
    expect(rows).toEqual([
      { type: "context", text: "a", oldLine: 1, newLine: 1 },
      { type: "context", text: "b", oldLine: 2, newLine: 2 },
      { type: "add", text: "c", oldLine: null, newLine: 3 },
    ]);
  });

  it("marks removed lines as deletions with no new line number", () => {
    const rows = diffLines("a\nb\nc", "a\nc");
    expect(rows).toEqual([
      { type: "context", text: "a", oldLine: 1, newLine: 1 },
      { type: "del", text: "b", oldLine: 2, newLine: null },
      { type: "context", text: "c", oldLine: 3, newLine: 2 },
    ]);
  });

  it("renders a changed line as a deletion followed by an addition", () => {
    const rows = diffLines("a\nb\nc", "a\nB\nc");
    expect(rows).toEqual([
      { type: "context", text: "a", oldLine: 1, newLine: 1 },
      { type: "del", text: "b", oldLine: 2, newLine: null },
      { type: "add", text: "B", oldLine: null, newLine: 2 },
      { type: "context", text: "c", oldLine: 3, newLine: 3 },
    ]);
  });

  it("treats a brand-new file (empty old) as a removed blank line plus additions", () => {
    const rows = diffLines("", "x\ny");
    expect(rows).toEqual([
      // An empty old document is a single empty line that shares nothing with
      // the new content, so it drops and every new line is an addition.
      { type: "del", text: "", oldLine: 1, newLine: null },
      { type: "add", text: "x", oldLine: null, newLine: 1 },
      { type: "add", text: "y", oldLine: null, newLine: 2 },
    ]);
  });

  it("preserves blank lines so formatting changes are visible", () => {
    const rows = diffLines("a\n\nb", "a\nb");
    expect(rows).toEqual([
      { type: "context", text: "a", oldLine: 1, newLine: 1 },
      { type: "del", text: "", oldLine: 2, newLine: null },
      { type: "context", text: "b", oldLine: 3, newLine: 2 },
    ]);
  });
});
