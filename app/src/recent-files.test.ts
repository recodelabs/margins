import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RECENT_FILES_LIMIT,
  readPinnedFiles,
  readRecentFiles,
  recordRecentFile,
  repoKey,
  togglePinnedFile,
} from "./recent-files";

const KEY = repoKey("octo", "demo");
const OTHER = repoKey("octo", "other");

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("repoKey", () => {
  it("joins owner and repo", () => {
    expect(repoKey("octo", "demo")).toBe("octo/demo");
  });
});

describe("recent files", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(readRecentFiles(KEY)).toEqual([]);
  });

  it("records most-recent first", () => {
    recordRecentFile(KEY, "a.md");
    recordRecentFile(KEY, "b.md");
    expect(readRecentFiles(KEY)).toEqual(["b.md", "a.md"]);
  });

  it("moves a re-opened file to the front without duplicating", () => {
    recordRecentFile(KEY, "a.md");
    recordRecentFile(KEY, "b.md");
    recordRecentFile(KEY, "a.md");
    expect(readRecentFiles(KEY)).toEqual(["a.md", "b.md"]);
  });

  it("caps the list at the limit", () => {
    for (let i = 0; i < RECENT_FILES_LIMIT + 5; i++) {
      recordRecentFile(KEY, `f${i}.md`);
    }
    const recent = readRecentFiles(KEY);
    expect(recent).toHaveLength(RECENT_FILES_LIMIT);
    // The most recent is the last recorded; the oldest five fell off.
    expect(recent[0]).toBe(`f${RECENT_FILES_LIMIT + 4}.md`);
    expect(recent).not.toContain("f0.md");
  });

  it("scopes recents per repo", () => {
    recordRecentFile(KEY, "a.md");
    recordRecentFile(OTHER, "z.md");
    expect(readRecentFiles(KEY)).toEqual(["a.md"]);
    expect(readRecentFiles(OTHER)).toEqual(["z.md"]);
  });

  it("falls back to empty on malformed stored JSON", () => {
    localStorage.setItem("margins:recent-files", "not json{");
    expect(readRecentFiles(KEY)).toEqual([]);
  });
});

describe("pinned files", () => {
  it("toggles a path on and off", () => {
    expect(togglePinnedFile(KEY, "a.md")).toEqual(["a.md"]);
    expect(readPinnedFiles(KEY)).toEqual(["a.md"]);
    expect(togglePinnedFile(KEY, "a.md")).toEqual([]);
    expect(readPinnedFiles(KEY)).toEqual([]);
  });

  it("appends new pins in pin order", () => {
    togglePinnedFile(KEY, "a.md");
    togglePinnedFile(KEY, "b.md");
    expect(readPinnedFiles(KEY)).toEqual(["a.md", "b.md"]);
  });

  it("scopes pins per repo", () => {
    togglePinnedFile(KEY, "a.md");
    expect(readPinnedFiles(OTHER)).toEqual([]);
  });
});
