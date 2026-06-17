import { describe, expect, it } from "vitest";
import { readSharingFlags } from "./sharing-flags";

describe("readSharingFlags", () => {
  it("defaults every flag to false when there is no frontmatter", () => {
    expect(readSharingFlags("# Just a body\n")).toEqual({
      public: false,
      comments: false,
      suggestions: false,
    });
  });

  it("reads true flags from the leading frontmatter block", () => {
    const md = "---\npublic: true\ncomments: true\n---\n\n# Body\n";
    expect(readSharingFlags(md)).toEqual({
      public: true,
      comments: true,
      suggestions: false,
    });
  });

  it("treats any non-true value as false", () => {
    const md = "---\npublic: false\ncomments: yes\nsuggestions:\n---\n";
    expect(readSharingFlags(md)).toEqual({
      public: false,
      comments: false,
      suggestions: false,
    });
  });

  it("ignores a 'public: true' that appears only in the body, not frontmatter", () => {
    const md = "# Heading\n\npublic: true\n";
    expect(readSharingFlags(md).public).toBe(false);
  });

  it("is case-insensitive on the value and tolerates trailing spaces/comments", () => {
    const md = "---\npublic:   TRUE  # opt in\n---\n";
    expect(readSharingFlags(md).public).toBe(true);
  });
});
