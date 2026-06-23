import { describe, expect, it, vi } from "vitest";
import { saveWithAutoMerge } from "./auto-merge";
import { MarkdownFileConflictError, type Page } from "./storage";

const page = (content: string, version: string): Page => ({
  id: "doc",
  title: "doc",
  content,
  version,
});

describe("saveWithAutoMerge", () => {
  it("saves directly when there is no conflict", async () => {
    const save = vi.fn(async (_path, content: string) => page(content, "v2"));
    const outcome = await saveWithAutoMerge(save, {
      path: "doc.md",
      content: "hello world",
      base: "hello",
      expectedVersion: "v1",
    });

    expect(outcome).toEqual({
      kind: "saved",
      savedDocument: page("hello world", "v2"),
      autoMerged: false,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("doc.md", "hello world", "v1");
  });

  it("auto-merges non-overlapping edits and retries against their version", async () => {
    const base = "title\n\nintro\n\nbody\n\nconclusion";
    const ours = "title\n\nINTRO EDIT\n\nbody\n\nconclusion";
    const theirs = "title\n\nintro\n\nbody\n\nCONCLUSION EDIT";
    const merged = "title\n\nINTRO EDIT\n\nbody\n\nCONCLUSION EDIT";

    const save = vi
      .fn()
      // First attempt (our draft, against v1) loses the race to their save.
      .mockRejectedValueOnce(new MarkdownFileConflictError(page(theirs, "v2")))
      // Retry with the merged text against their version succeeds.
      .mockResolvedValueOnce(page(merged, "v3"));

    const outcome = await saveWithAutoMerge(save, {
      path: "doc.md",
      content: ours,
      base,
      expectedVersion: "v1",
    });

    expect(outcome).toEqual({
      kind: "saved",
      savedDocument: page(merged, "v3"),
      autoMerged: true,
    });
    expect(save).toHaveBeenNthCalledWith(2, "doc.md", merged, "v2");
  });

  it("returns a conflict when edits overlap the same lines", async () => {
    const base = "alpha\nbeta\ngamma";
    const ours = "alpha\nOUR BETA\ngamma";
    const theirs = "alpha\nTHEIR BETA\ngamma";

    const save = vi
      .fn()
      .mockRejectedValueOnce(new MarkdownFileConflictError(page(theirs, "v2")));

    const outcome = await saveWithAutoMerge(save, {
      path: "doc.md",
      content: ours,
      base,
      expectedVersion: "v1",
    });

    expect(outcome.kind).toBe("conflict");
    if (outcome.kind !== "conflict") throw new Error("expected conflict");
    expect(outcome.conflict.version).toBe("v2");
    // The resolution merges against their version (what we'll save on top of).
    expect(outcome.conflict.base).toBe(theirs);
    expect(
      outcome.conflict.regions.some((region) => region.type === "conflict"),
    ).toBe(true);
    // Did not blindly overwrite their version.
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("re-merges when a third save lands during the auto-merge retry", async () => {
    const base = "one\ntwo\nthree";
    const ours = "ZERO\none\ntwo\nthree"; // we prepend a line
    const theirsA = "one\ntwo\nthree\nFOUR"; // they appended
    const theirsB = "one\ntwo\nthree\nFOUR\nFIVE"; // another append before our retry

    const save = vi
      .fn()
      .mockRejectedValueOnce(new MarkdownFileConflictError(page(theirsA, "v2")))
      .mockRejectedValueOnce(new MarkdownFileConflictError(page(theirsB, "v3")))
      .mockImplementationOnce(async (_p, content: string) =>
        page(content, "v4"),
      );

    const outcome = await saveWithAutoMerge(save, {
      path: "doc.md",
      content: ours,
      base,
      expectedVersion: "v1",
    });

    expect(outcome.kind).toBe("saved");
    if (outcome.kind !== "saved") throw new Error("expected saved");
    expect(outcome.savedDocument.content).toBe(
      "ZERO\none\ntwo\nthree\nFOUR\nFIVE",
    );
    expect(outcome.autoMerged).toBe(true);
  });

  it("gives up with `exhausted` after repeated clean-merge races", async () => {
    // Every attempt conflicts with a fresh non-overlapping append, so the merge
    // is always clean but never lands within the attempt budget.
    let n = 0;
    const save = vi.fn(async () => {
      n += 1;
      throw new MarkdownFileConflictError(
        page(`one\ntwo\nthree\nappend ${n}`, `v${n + 1}`),
      );
    });

    const outcome = await saveWithAutoMerge(
      save,
      {
        path: "doc.md",
        content: "ZERO\none\ntwo\nthree",
        base: "one\ntwo\nthree",
        expectedVersion: "v1",
      },
      3,
    );

    expect(outcome.kind).toBe("exhausted");
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("propagates non-conflict errors", async () => {
    const save = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      saveWithAutoMerge(save, {
        path: "doc.md",
        content: "x",
        base: "y",
      }),
    ).rejects.toThrow("network down");
  });
});
