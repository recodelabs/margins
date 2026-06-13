export type InstructionType = "comments" | "rewrite" | "custom";

export interface UserInstructionEntry {
  id: string;
  at: string;
  by: string;
  role: "user";
  type: InstructionType;
  instruction: string;
}

export interface AgentReplyEntry {
  id: string;
  at: string;
  by: string;
  role: "agent";
  replyTo: string;
  status: "done" | "error";
  summary: string;
  commit?: string;
  error?: string;
}

export type ActivityEntry = UserInstructionEntry | AgentReplyEntry;

export type InstructionStatus = "pending" | "done" | "error";

export interface ConversationItem {
  instruction: UserInstructionEntry;
  reply: AgentReplyEntry | null;
  status: InstructionStatus;
}

/** Per-doc append-only log: `.margins/<docPath>.activity.jsonl`. */
export function activityLogPath(docPath: string): string {
  return `.margins/${docPath}.activity.jsonl`;
}

function isEntry(value: unknown): value is ActivityEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  return v.role === "user" || v.role === "agent";
}

/** Parse JSONL, skipping blank or malformed lines so one bad line can't break the log. */
export function parseActivityLog(text: string): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isEntry(parsed)) entries.push(parsed);
    } catch {
      // skip garbled line
    }
  }
  return entries;
}

/** Append one entry as a JSON line, ensuring exactly one trailing newline. */
export function appendActivityLine(text: string, entry: ActivityEntry): string {
  const base = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
  return `${base}${JSON.stringify(entry)}\n`;
}

/** Pair each user instruction with its agent reply (latest wins) and derive status. */
export function buildConversation(
  entries: ActivityEntry[],
): ConversationItem[] {
  const replies = new Map<string, AgentReplyEntry>();
  for (const entry of entries) {
    if (entry.role === "agent") replies.set(entry.replyTo, entry);
  }
  return entries
    .filter((e): e is UserInstructionEntry => e.role === "user")
    .map((instruction) => {
      const reply = replies.get(instruction.id) ?? null;
      return {
        instruction,
        reply,
        status: reply ? reply.status : ("pending" as InstructionStatus),
      };
    });
}
