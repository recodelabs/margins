import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { criticMarkdownToEditorState } from "./index";

function firstCodeBlockText(doc: JSONContent): string | null {
  let found: string | null = null;
  const visit = (node: JSONContent) => {
    if (found !== null) return;
    if (node.type === "codeBlock") {
      found = (node.content ?? []).map((c) => c.text ?? "").join("");
      return;
    }
    (node.content ?? []).forEach(visit);
  };
  visit(doc);
  return found;
}

describe("criticMarkdownToEditorState json code blocks", () => {
  it("pretty-prints a minified json block in the editor doc", () => {
    const { doc } = criticMarkdownToEditorState(
      '```json\n{"a":1,"b":2}\n```\n',
    );
    expect(firstCodeBlockText(doc)).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it("leaves invalid json untouched", () => {
    const { doc } = criticMarkdownToEditorState("```json\n{not valid}\n```\n");
    expect(firstCodeBlockText(doc)).toBe("{not valid}");
  });

  it("leaves a non-json block untouched", () => {
    const { doc } = criticMarkdownToEditorState("```js\nconst x={a:1}\n```\n");
    expect(firstCodeBlockText(doc)).toBe("const x={a:1}");
  });
});
