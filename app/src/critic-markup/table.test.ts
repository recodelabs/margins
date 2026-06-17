import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "./index";

function hasNodeOfType(doc: JSONContent, type: string): boolean {
  let found = false;
  const visit = (node: JSONContent) => {
    if (found) return;
    if (node.type === type) {
      found = true;
      return;
    }
    (node.content ?? []).forEach(visit);
  };
  visit(doc);
  return found;
}

// A FHIR-style property table whose cells carry escaped pipes (`\|`) and
// code spans containing pipes — the shape that previously got hidden behind an
// invisible rawMarkdownBlock (REC-479).
const propertyTable = [
  "| Element | Card. | Type / Binding | Description |",
  "| --- | --- | --- | --- |",
  "| `for` | 1..1 | `Reference(ICRDeliveryUnit \\| ICRLocation \\| Patient)` | The unit being **targeted**. |",
  "| `role` | 1..1 | `vaccinator` \\| `cdd` \\| `supervisor` | Team role. |",
  "",
].join("\n");

describe("criticMarkdownToEditorState pipe-bearing tables", () => {
  it("renders a property table as an editable table node, not a hidden raw block", () => {
    const { doc } = criticMarkdownToEditorState(propertyTable);

    expect(hasNodeOfType(doc, "table")).toBe(true);
    expect(hasNodeOfType(doc, "rawMarkdownBlock")).toBe(false);
  });

  it("round-trips escaped pipes and code-span pipes through the editor", () => {
    const { doc, comments } = criticMarkdownToEditorState(propertyTable);
    const out = editorStateToCriticMarkdown(doc, comments);

    // Escaped pipes survive in both plain-text and code-span cells.
    expect(out).toContain(
      "`Reference(ICRDeliveryUnit \\| ICRLocation \\| Patient)`",
    );
    expect(out).toContain("`vaccinator` \\| `cdd` \\| `supervisor`");
    // The literal source pipes are never emitted unescaped (which would split cells).
    expect(out).not.toContain("ICRLocation | Patient");
  });
});
