import { describe, expect, it } from "vitest";
import {
  editorBusy,
  findNewAgentReplies,
  liveUpdateActionFor,
  mergeById,
  serializeForChangeCheck,
} from "./activity-live";
import type { ActivityEntry } from "./activity-log";

const userEntry = (id: string): ActivityEntry => ({
  id,
  at: "t",
  by: "u",
  role: "user",
  type: "custom",
  instruction: "x",
});
const agentEntry = (
  id: string,
  replyTo: string,
  status: "done" | "error" = "done",
  commit?: string,
): ActivityEntry => ({
  id,
  at: "t",
  by: "agent",
  role: "agent",
  replyTo,
  status,
  summary: "did it",
  ...(commit ? { commit } : {}),
});

describe("mergeById", () => {
  it("primary wins on duplicate id", () => {
    const primary = [{ ...userEntry("i1"), instruction: "primary" }];
    const extra = [{ ...userEntry("i1"), instruction: "extra" }];
    const result = mergeById(primary, extra);
    expect(result).toHaveLength(1);
    expect(result[0].instruction).toBe("primary");
  });

  it("extra-only entries are appended after primary", () => {
    const primary = [userEntry("i1")];
    const extra = [userEntry("i1"), userEntry("i2")];
    const result = mergeById(primary, extra);
    expect(result.map((e) => e.id)).toEqual(["i1", "i2"]);
  });

  it("empty primary returns extra", () => {
    const extra = [userEntry("i1"), userEntry("i2")];
    expect(mergeById([], extra).map((e) => e.id)).toEqual(["i1", "i2"]);
  });

  it("empty extra returns primary", () => {
    const primary = [userEntry("i1")];
    expect(mergeById(primary, []).map((e) => e.id)).toEqual(["i1"]);
  });
});

describe("findNewAgentReplies", () => {
  it("returns agent replies present in next but not prev", () => {
    const prev = [userEntry("i1")];
    const next = [userEntry("i1"), agentEntry("a1", "i1")];
    expect(findNewAgentReplies(prev, next).map((r) => r.id)).toEqual(["a1"]);
  });

  it("ignores already-seen replies and user entries", () => {
    const prev = [userEntry("i1"), agentEntry("a1", "i1")];
    const next = [userEntry("i1"), agentEntry("a1", "i1"), userEntry("i2")];
    expect(findNewAgentReplies(prev, next)).toEqual([]);
  });

  it("returns multiple new replies", () => {
    const prev: ActivityEntry[] = [];
    const next = [agentEntry("a1", "i1"), agentEntry("a2", "i2")];
    expect(findNewAgentReplies(prev, next).map((r) => r.id)).toEqual([
      "a1",
      "a2",
    ]);
  });
});

describe("serializeForChangeCheck", () => {
  it("is stable for the same entries and changes when a reply is appended", () => {
    const a = [userEntry("i1")];
    const b = [userEntry("i1")];
    const c = [userEntry("i1"), agentEntry("a1", "i1")];
    expect(serializeForChangeCheck(a)).toBe(serializeForChangeCheck(b));
    expect(serializeForChangeCheck(a)).not.toBe(serializeForChangeCheck(c));
  });
});

describe("editorBusy", () => {
  it("is false only when clean, saved and not composing", () => {
    expect(
      editorBusy({ dirty: false, saveState: "saved", composingComment: false }),
    ).toBe(false);
    expect(
      editorBusy({ dirty: true, saveState: "saved", composingComment: false }),
    ).toBe(true);
    expect(
      editorBusy({
        dirty: false,
        saveState: "saving",
        composingComment: false,
      }),
    ).toBe(true);
    expect(
      editorBusy({ dirty: false, saveState: "saved", composingComment: true }),
    ).toBe(true);
  });
});

describe("liveUpdateActionFor", () => {
  it("applies a done reply with a commit when idle", () => {
    expect(
      liveUpdateActionFor(agentEntry("a1", "i1", "done", "sha"), false),
    ).toBe("apply");
  });
  it("conflicts a done reply when busy", () => {
    expect(
      liveUpdateActionFor(agentEntry("a1", "i1", "done", "sha"), true),
    ).toBe("conflict");
  });
  it("does nothing for an error reply", () => {
    expect(liveUpdateActionFor(agentEntry("a1", "i1", "error"), false)).toBe(
      "none",
    );
  });
  it("does nothing for a done reply with no commit", () => {
    expect(liveUpdateActionFor(agentEntry("a1", "i1", "done"), false)).toBe(
      "none",
    );
  });
});
