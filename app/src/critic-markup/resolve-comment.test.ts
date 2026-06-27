import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  criticMarkdownToRenderedHtml,
  editorStateToCriticMarkdown,
} from "./index";

const INLINE_OPEN =
  '{==targeted text==}{>>needs a fix<<}{id="c1" by="alice" at="2024-01-01T00:00:00Z"}';

const DOC_SCOPED = [
  "Hello world.",
  "",
  "---",
  "comments:",
  "  c1:",
  "    by: bob",
  '    at: "2024-01-01T00:00:00Z"',
  "    body: A document-level note",
  "",
].join("\n");

function reparseInline(markdown: string) {
  const { doc, comments } = criticMarkdownToEditorState(markdown);
  const serialized = editorStateToCriticMarkdown(doc, comments);
  return criticMarkdownToEditorState(serialized).comments.get("c1");
}

describe("resolve/reopen metadata", () => {
  it("parses inline resolved attributes into the comment", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      '{==x==}{>>hi<<}{id="c1" by="alice" at="2024-01-01T00:00:00Z" resolved="true" resolvedBy="bob" resolvedAt="2024-02-02T00:00:00Z"}',
    );
    const comment = comments.get("c1");
    expect(comment?.resolved).toBe(true);
    expect(comment?.resolvedBy).toBe("bob");
    expect(comment?.resolvedAt).toBe("2024-02-02T00:00:00Z");
  });

  it("leaves resolved falsy when the attribute is absent", () => {
    const { comments } = criticMarkdownToRenderedHtml(INLINE_OPEN);
    const comment = comments.get("c1");
    expect(comment?.resolved).toBeFalsy();
    expect(comment?.resolvedBy).toBeFalsy();
  });

  it("round-trips a resolved inline-anchored comment through the editor", () => {
    const { doc, comments } = criticMarkdownToEditorState(INLINE_OPEN);
    const comment = comments.get("c1");
    expect(comment).toBeDefined();
    comments.set("c1", {
      ...comment!,
      resolved: true,
      resolvedBy: "bob",
      resolvedAt: "2024-02-02T00:00:00Z",
    });

    const serialized = editorStateToCriticMarkdown(doc, comments);
    expect(serialized).toContain('resolved="true"');

    const reparsed = criticMarkdownToEditorState(serialized).comments.get("c1");
    expect(reparsed?.resolved).toBe(true);
    expect(reparsed?.resolvedBy).toBe("bob");
    expect(reparsed?.resolvedAt).toBe("2024-02-02T00:00:00Z");
  });

  it("round-trips a resolved document-scoped comment through endmatter", () => {
    const { doc, comments } = criticMarkdownToEditorState(DOC_SCOPED);
    const comment = comments.get("c1");
    expect(comment?.scope).toBe("document");
    comments.set("c1", {
      ...comment!,
      resolved: true,
      resolvedBy: "carol",
      resolvedAt: "2024-03-03T00:00:00Z",
    });

    const serialized = editorStateToCriticMarkdown(doc, comments, {
      endmatter: doc.yamlEndmatter ?? null,
    });
    expect(serialized).toContain("resolved: true");

    const reparsed = criticMarkdownToEditorState(serialized).comments.get("c1");
    expect(reparsed?.resolved).toBe(true);
    expect(reparsed?.resolvedBy).toBe("carol");
    expect(reparsed?.resolvedAt).toBe("2024-03-03T00:00:00Z");
  });

  it("drops resolve metadata when a comment is reopened", () => {
    const resolved = criticMarkdownToEditorState(
      '{==x==}{>>hi<<}{id="c1" by="alice" at="2024-01-01T00:00:00Z" resolved="true" resolvedBy="bob" resolvedAt="2024-02-02T00:00:00Z"}',
    );
    const comment = resolved.comments.get("c1");
    resolved.comments.set("c1", {
      ...comment!,
      resolved: false,
      resolvedBy: null,
      resolvedAt: null,
    });

    const serialized = editorStateToCriticMarkdown(
      resolved.doc,
      resolved.comments,
    );
    expect(serialized).not.toContain("resolved");

    const reparsed = reparseInline(INLINE_OPEN);
    expect(reparsed?.resolved).toBeFalsy();
  });
});
