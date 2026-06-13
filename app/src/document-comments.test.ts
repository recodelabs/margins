import { describe, expect, it } from "vitest";
import {
  resolveAnchoredRailLayouts,
  resolveAnchorReferenceElement,
} from "./document-comments";

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

describe("resolveAnchoredRailLayouts pivot stability", () => {
  // Mixed spacing: a/b are crowded near the top, c is far down with slack.
  const items = [
    { key: "a", anchorTop: 0, anchorBottom: 20 },
    { key: "b", anchorTop: 30, anchorBottom: 50 },
    { key: "c", anchorTop: 400, anchorBottom: 420 },
  ];
  const heights = { a: 100, b: 100, c: 100 };

  it("stacks greedily top-down with a null pivot (selection-independent)", () => {
    expect(
      resolveAnchoredRailLayouts(items, heights, null).map((l) => l.railTop),
    ).toEqual([0, 116, 400]);
  });

  it("reshuffles the stack when a lower item becomes the active pivot — why the rail uses a null pivot so selection never moves cards", () => {
    const nullPivot = resolveAnchoredRailLayouts(items, heights, null).map(
      (l) => l.railTop,
    );
    const cPivot = resolveAnchoredRailLayouts(items, heights, "c").map(
      (l) => l.railTop,
    );
    expect(cPivot).not.toEqual(nullPivot);
  });
});
