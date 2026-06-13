import type { ActivityEntry, AgentReplyEntry } from "./activity-log";

/** Merge two entry lists by id: `primary` wins, then any `extra` entries whose
 * id isn't already present are appended (preserves order). */
export function mergeById(
  primary: ActivityEntry[],
  extra: ActivityEntry[],
): ActivityEntry[] {
  const ids = new Set(primary.map((e) => e.id));
  return [...primary, ...extra.filter((e) => !ids.has(e.id))];
}

/** Agent replies present in `next` but not in `prev` (matched by id). */
export function findNewAgentReplies(
  prev: ActivityEntry[],
  next: ActivityEntry[],
): AgentReplyEntry[] {
  const seen = new Set(prev.filter((e) => e.role === "agent").map((e) => e.id));
  return next.filter(
    (e): e is AgentReplyEntry => e.role === "agent" && !seen.has(e.id),
  );
}

/** A cheap, stable signature so a poll only fires the callback on real change. */
export function serializeForChangeCheck(entries: ActivityEntry[]): string {
  return entries
    .map((e) => (e.role === "agent" ? `${e.id}:${e.status}` : e.id))
    .join("\n");
}

/** The editor is "busy" if the user might lose work to an auto-apply. */
export function editorBusy(s: {
  dirty: boolean;
  saveState: string;
  composingComment: boolean;
}): boolean {
  return s.dirty || s.saveState !== "saved" || s.composingComment;
}

export type LiveUpdateAction = "apply" | "conflict" | "none";

/** What a freshly-arrived agent reply should trigger, given editor busyness. */
export function liveUpdateActionFor(
  reply: AgentReplyEntry,
  busy: boolean,
): LiveUpdateAction {
  if (reply.status === "done" && reply.commit) {
    return busy ? "conflict" : "apply";
  }
  return "none";
}
