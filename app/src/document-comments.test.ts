import { describe, expect, it } from "vitest";
import { resolveAnchorReferenceElement } from "./document-comments";

describe("resolveAnchorReferenceElement", () => {
  it("returns the .document-page-shell ancestor when the editor is nested in one", () => {
    const shell = document.createElement("div");
    shell.className = "document-page-shell";
    const editor = document.createElement("div");
    shell.appendChild(editor);

    expect(resolveAnchorReferenceElement(editor)).toBe(shell);
  });

  it("returns the editor element itself when there is no shell ancestor", () => {
    const editor = document.createElement("div");
    expect(resolveAnchorReferenceElement(editor)).toBe(editor);
  });
});
