import { describe, expect, it } from "vitest";
import {
  applyMention,
  filterMentionCandidates,
  getActiveMentionQuery,
} from "./comment-mentions";

describe("getActiveMentionQuery", () => {
  it("detects a mention being typed at the caret", () => {
    const text = "hey @oct";
    expect(getActiveMentionQuery(text, text.length)).toEqual({
      query: "oct",
      start: 4,
      end: 8,
    });
  });

  it("detects a bare @ with an empty query", () => {
    const text = "ping @";
    expect(getActiveMentionQuery(text, text.length)).toEqual({
      query: "",
      start: 5,
      end: 6,
    });
  });

  it("triggers at the very start of the text", () => {
    expect(getActiveMentionQuery("@ab", 3)).toEqual({
      query: "ab",
      start: 0,
      end: 3,
    });
  });

  it("does not trigger inside an email-like token", () => {
    const text = "mail me at a@b";
    expect(getActiveMentionQuery(text, text.length)).toBeNull();
  });

  it("does not trigger once whitespace follows the @ token", () => {
    const text = "@oct typed";
    expect(getActiveMentionQuery(text, text.length)).toBeNull();
  });

  it("ignores a @ that is not adjacent to the caret token", () => {
    const text = "@alice and bob ";
    expect(getActiveMentionQuery(text, text.length)).toBeNull();
  });

  it("does not trigger on disallowed characters in the query", () => {
    const text = "@oc!t";
    expect(getActiveMentionQuery(text, text.length)).toBeNull();
  });

  it("uses the caret position, not the end of the text", () => {
    const text = "@alice rest";
    // caret sits right after "alic"
    expect(getActiveMentionQuery(text, 5)).toEqual({
      query: "alic",
      start: 0,
      end: 5,
    });
  });
});

describe("filterMentionCandidates", () => {
  const people = ["octocat", "octodog", "alice", "Bob", "carol-bot"];

  it("returns prefix matches before substring matches, case-insensitive", () => {
    expect(filterMentionCandidates(people, "oct")).toEqual([
      "octocat",
      "octodog",
    ]);
  });

  it("includes substring matches after prefix matches", () => {
    expect(filterMentionCandidates(["octocat", "category"], "cat")).toEqual([
      "category",
      "octocat",
    ]);
  });

  it("matches case-insensitively", () => {
    expect(filterMentionCandidates(people, "bob")).toEqual(["Bob"]);
  });

  it("returns all candidates (capped) for an empty query", () => {
    expect(filterMentionCandidates(people, "", 3)).toEqual([
      "octocat",
      "octodog",
      "alice",
    ]);
  });

  it("caps the number of results", () => {
    expect(filterMentionCandidates(people, "", 2)).toHaveLength(2);
  });

  it("returns nothing when no candidate matches", () => {
    expect(filterMentionCandidates(people, "zzz")).toEqual([]);
  });
});

describe("applyMention", () => {
  it("replaces the active token with @login and a trailing space", () => {
    const result = applyMention("hey @oct", 4, 8, "octocat");
    expect(result.text).toBe("hey @octocat ");
    expect(result.caret).toBe(result.text.length);
  });

  it("preserves text after the caret and positions the caret after the space", () => {
    const result = applyMention("hi @al done", 3, 6, "alice");
    expect(result.text).toBe("hi @alice  done");
    expect(result.caret).toBe("hi @alice ".length);
  });
});
