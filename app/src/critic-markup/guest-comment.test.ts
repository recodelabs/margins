import { describe, expect, it } from "vitest";
import { criticMarkdownToRenderedHtml } from "./index";

describe("guest comment parsing", () => {
  it('parses guest="true" attribute into CriticComment.guest === true', () => {
    const { comments } = criticMarkdownToRenderedHtml(
      '{==x==}{>>hi<<}{id="c1" by="Jane" at="2024-01-01T00:00:00Z" guest="true"}',
    );
    const comment = comments.get("c1");
    expect(comment?.guest).toBe(true);
  });

  it("leaves guest falsy when attribute is absent", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      '{==x==}{>>hi<<}{id="c2" by="Jane" at="2024-01-01T00:00:00Z"}',
    );
    const comment = comments.get("c2");
    expect(comment?.guest).toBeFalsy();
  });

  it('parses guest="false" as falsy', () => {
    const { comments } = criticMarkdownToRenderedHtml(
      '{==x==}{>>hi<<}{id="c3" by="Jane" at="2024-01-01T00:00:00Z" guest="false"}',
    );
    const comment = comments.get("c3");
    expect(comment?.guest).toBeFalsy();
  });
});
