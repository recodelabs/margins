import { useCallback, useEffect, useState } from "react";
import {
  type ActivityEntry,
  buildConversation,
  type InstructionType,
} from "./activity-log";
import { Button } from "./components/ui/button";

export interface InstructionSenderProps {
  docPath: string;
  author: string;
  readActivityLog: (docPath: string) => Promise<ActivityEntry[]>;
  appendActivityEntry: (docPath: string, entry: ActivityEntry) => Promise<void>;
  liveEntries?: ActivityEntry[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  done: "Done",
  error: "Error",
};

export function InstructionSender({
  docPath,
  author,
  readActivityLog,
  appendActivityEntry,
  liveEntries,
}: InstructionSenderProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [type, setType] = useState<InstructionType>("custom");
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    readActivityLog(docPath)
      .then((next) => {
        if (!cancelled) setEntries(next);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [docPath, readActivityLog]);

  useEffect(() => reload(), [reload]);

  const send = async () => {
    const text = instruction.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      by: author,
      role: "user",
      type,
      instruction: text,
    };
    try {
      await appendActivityEntry(docPath, entry);
      setInstruction("");
      setType("custom");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const conversation = buildConversation(liveEntries ?? entries);

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant={type === "comments" ? "default" : "outline"}
          onClick={() => setType("comments")}
        >
          Apply comments
        </Button>
        <Button
          type="button"
          variant={type === "rewrite" ? "default" : "outline"}
          onClick={() => setType("rewrite")}
        >
          Rewrite
        </Button>
      </div>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Instruction for the agent…"
        className="min-h-16 w-full resize-y rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-slate-300/70"
      />
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={send}
          disabled={!instruction.trim() || sending}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
      {conversation.length > 0 ? (
        <ul className="flex flex-col gap-1.5 border-t border-slate-100 dark:border-slate-800 pt-2">
          {conversation.map((item) => (
            <li key={item.instruction.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                  <span className="font-medium">{item.instruction.type}</span>:{" "}
                  {item.instruction.instruction}
                </span>
                <span className="shrink-0 text-stone-500 dark:text-stone-400">
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              {item.reply ? (
                <div className="mt-0.5 text-stone-500 dark:text-stone-400">
                  {item.reply.summary || item.reply.error}
                  {item.reply.commit
                    ? ` · ${item.reply.commit.slice(0, 7)}`
                    : ""}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
