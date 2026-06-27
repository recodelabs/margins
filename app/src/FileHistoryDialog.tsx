import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type DiffRow, diffLines } from "./diff";
import { formatRelativeTime } from "./format";
import type { FileCommit } from "./storage";

export interface FileHistoryDialogProps {
  /** Path of the file whose history to show. */
  path: string;
  /** Current (possibly uncommitted) editor content, for the "Working copy" diff. */
  currentContent: string;
  /** Fetch recent commits for the file, newest first. */
  listFileHistory: (path: string) => Promise<FileCommit[]>;
  /** Fetch the file's content at a given commit/ref. */
  readFileAtRef: (path: string, ref: string) => Promise<string>;
  /** Build a "view commit on GitHub" URL. */
  commitUrl?: (sha: string) => string;
  /** Reference time for relative timestamps (injectable for tests). */
  now?: Date;
  onClose: () => void;
}

/** "working" selects the uncommitted editor content; otherwise a commit sha. */
type SelectionKey = string;
const WORKING: SelectionKey = "working";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function CommitButton({
  title,
  subtitle,
  detail,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
        selected
          ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40"
          : "border-transparent hover:bg-muted/60"
      }`}
    >
      <span className="truncate text-xs font-medium text-foreground">
        {title}
      </span>
      <span className="truncate text-[0.68rem] text-muted-foreground">
        {subtitle}
      </span>
      {detail ? (
        <span className="truncate font-mono text-[0.62rem] text-muted-foreground/80">
          {detail}
        </span>
      ) : null}
    </button>
  );
}

function DiffView({ rows }: { rows: DiffRow[] }) {
  if (rows.every((row) => row.type === "context")) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        No changes in this revision.
      </p>
    );
  }
  return (
    <div className="font-mono text-[0.72rem] leading-5">
      {rows.map((row, i) => {
        const prefix =
          row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
        const tone =
          row.type === "add"
            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
            : row.type === "del"
              ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
              : "text-muted-foreground";
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional and stable for this render
            key={i}
            data-testid={`diff-row-${row.type}`}
            data-line-text={row.text}
            className={`flex gap-2 whitespace-pre-wrap break-words px-3 ${tone}`}
          >
            <span aria-hidden="true" className="select-none opacity-60">
              {prefix}
            </span>
            <span className="min-w-0 flex-1">{row.text || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FileHistoryDialog({
  path,
  currentContent,
  listFileHistory,
  readFileAtRef,
  commitUrl,
  now,
  onClose,
}: FileHistoryDialogProps) {
  const [commits, setCommits] = useState<FileCommit[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectionKey | null>(null);
  const [diff, setDiff] = useState<DiffRow[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const contentCache = useRef(new Map<string, string>());
  const referenceTime = now ?? new Date();

  // Load the commit history once, then default to the newest commit.
  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    setHistoryError(null);
    listFileHistory(path)
      .then((result) => {
        if (cancelled) return;
        setCommits(result);
        setSelected(result[0]?.sha ?? null);
      })
      .catch((error) => {
        if (!cancelled) setHistoryError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [path, listFileHistory]);

  // Recompute the diff whenever the selection changes.
  useEffect(() => {
    if (selected === null || commits === null) return;
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);

    const readContent = async (sha: string): Promise<string> => {
      const cached = contentCache.current.get(sha);
      if (cached !== undefined) return cached;
      const text = await readFileAtRef(path, sha);
      contentCache.current.set(sha, text);
      return text;
    };

    (async () => {
      try {
        let base: string;
        let target: string;
        if (selected === WORKING) {
          target = currentContent;
          base = commits[0] ? await readContent(commits[0].sha) : "";
        } else {
          const index = commits.findIndex((c) => c.sha === selected);
          target = await readContent(selected);
          const predecessor = commits[index + 1];
          base = predecessor ? await readContent(predecessor.sha) : "";
        }
        if (!cancelled) setDiff(diffLines(base, target));
      } catch (error) {
        if (!cancelled) setDiffError(errorMessage(error));
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected, commits, currentContent, readFileAtRef, path]);

  const hasHistory = commits !== null && commits.length > 0;
  const selectedCommit =
    selected && selected !== WORKING
      ? (commits?.find((c) => c.sha === selected) ?? null)
      : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="file-history-dialog" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>File history</DialogTitle>
          <DialogDescription>
            Recent changes to{" "}
            <span className="font-mono text-foreground">{path}</span>. Pick a
            revision to see what changed.
          </DialogDescription>
        </DialogHeader>

        {historyError ? (
          <p className="py-6 text-sm text-destructive">{historyError}</p>
        ) : commits === null ? (
          <p className="py-6 text-sm text-muted-foreground">Loading history…</p>
        ) : !hasHistory ? (
          <p className="py-6 text-sm text-muted-foreground">
            No history for this file yet.
          </p>
        ) : (
          <div className="flex max-h-[60vh] gap-3">
            <div className="w-56 shrink-0 space-y-1 overflow-auto pr-1">
              <CommitButton
                title="Working copy"
                subtitle="Uncommitted changes"
                selected={selected === WORKING}
                onSelect={() => setSelected(WORKING)}
              />
              {commits.map((commit) => (
                <CommitButton
                  key={commit.sha}
                  title={commit.message || "(no message)"}
                  subtitle={`${commit.authorLogin ?? (commit.authorName || "unknown")} · ${formatRelativeTime(
                    commit.date,
                    referenceTime,
                  )}`}
                  detail={commit.sha.slice(0, 7)}
                  selected={selected === commit.sha}
                  onSelect={() => setSelected(commit.sha)}
                />
              ))}
            </div>

            <div className="min-w-0 flex-1 overflow-auto rounded-md border bg-background">
              {selectedCommit && commitUrl ? (
                <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
                  <span className="truncate text-[0.7rem] text-muted-foreground">
                    {selectedCommit.message}
                  </span>
                  <a
                    href={commitUrl(selectedCommit.sha)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-[0.68rem] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3" aria-hidden="true" />
                    View on GitHub
                  </a>
                </div>
              ) : null}
              {diffLoading ? (
                <p className="p-4 text-xs text-muted-foreground">
                  Loading diff…
                </p>
              ) : diffError ? (
                <p className="p-4 text-xs text-destructive">{diffError}</p>
              ) : diff ? (
                <DiffView rows={diff} />
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
