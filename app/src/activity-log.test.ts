import { describe, expect, it } from "vitest";
import {
  type ActivityEntry,
  activityLogPath,
  appendActivityLine,
  buildConversation,
  parseActivityLog,
} from "./activity-log";

const user = (id: string, instruction: string): ActivityEntry => ({
  id,
  at: "2026-06-13T12:00:00.000Z",
  by: "matt",
  role: "user",
  type: "rewrite",
  instruction,
});
const reply = (
  id: string,
  replyTo: string,
  status: "done" | "error",
): ActivityEntry => ({
  id,
  at: "2026-06-13T12:01:00.000Z",
  by: "agent",
  role: "agent",
  replyTo,
  status,
  summary: status === "done" ? "Tightened the intro." : "",
  ...(status === "error" ? { error: "boom" } : { commit: "6a0ac4b" }),
});

describe("activityLogPath", () => {
  it("mirrors the doc path under .margins with an .activity.jsonl suffix", () => {
    expect(activityLogPath("docs/notes.md")).toBe(
      ".margins/docs/notes.md.activity.jsonl",
    );
  });
});

describe("parseActivityLog", () => {
  it("parses valid lines and skips blank/garbled ones", () => {
    const text = [
      JSON.stringify(user("a1", "tighten")),
      "",
      "not json",
      '{"role":"nope"}',
      JSON.stringify(reply("r1", "a1", "done")),
    ].join("\n");
    const entries = parseActivityLog(text);
    expect(entries.map((e) => e.id)).toEqual(["a1", "r1"]);
  });

  it("returns [] for empty input", () => {
    expect(parseActivityLog("")).toEqual([]);
  });
});

describe("appendActivityLine", () => {
  it("appends one JSON line with a trailing newline", () => {
    const out = appendActivityLine("", user("a1", "x"));
    expect(out).toBe(`${JSON.stringify(user("a1", "x"))}\n`);
  });

  it("adds a missing separating newline before appending", () => {
    const out = appendActivityLine("line1", user("a1", "x"));
    expect(out).toBe(`line1\n${JSON.stringify(user("a1", "x"))}\n`);
  });
});

describe("buildConversation", () => {
  it("pairs instructions with their reply and derives status", () => {
    const convo = buildConversation([
      user("a1", "tighten"),
      reply("r1", "a1", "done"),
      user("a2", "apply"),
    ]);
    expect(convo).toEqual([
      {
        instruction: user("a1", "tighten"),
        reply: reply("r1", "a1", "done"),
        status: "done",
      },
      { instruction: user("a2", "apply"), reply: null, status: "pending" },
    ]);
  });

  it("marks an instruction errored when its reply is an error", () => {
    const convo = buildConversation([
      user("a1", "x"),
      reply("r1", "a1", "error"),
    ]);
    expect(convo[0].status).toBe("error");
  });
});
