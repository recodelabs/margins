import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type PaletteCommand } from "./command-palette";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Items for the *current* page; the parent swaps these when pushing a page. */
  commands: PaletteCommand[];
  /** Run the chosen command. The parent decides whether that opens a sub-page. */
  onRun: (id: string) => void;
  /** Pop back to the previous page (Backspace on an empty query). Omit at root. */
  onBack?: () => void;
  placeholder?: string;
  /** Shows a loading row instead of "no results" while a page is fetching. */
  loading?: boolean;
  /** Message for the empty state (e.g. a load error). */
  emptyMessage?: string;
  /** Groups hidden until the user types, so e.g. a long file list isn't dumped. */
  hideGroupsWhenEmpty?: string[];
  /** Cap on rendered rows after ranking (keeps large lists snappy). */
  maxResults?: number;
}

interface GroupedCommands {
  group: string;
  items: { command: PaletteCommand; index: number }[];
}

/** Group a ranked, flat command list by `group`, preserving rank order. */
function groupByGroup(commands: PaletteCommand[]): GroupedCommands[] {
  const groups: GroupedCommands[] = [];
  commands.forEach((command, index) => {
    let group = groups.find((g) => g.group === command.group);
    if (!group) {
      group = { group: command.group, items: [] };
      groups.push(group);
    }
    group.items.push({ command, index });
  });
  return groups;
}

/**
 * The ⌘K command palette dialog (REC-504). A controlled, presentational list:
 * it fuzzy-filters and renders `commands`, drives keyboard selection, and hands
 * the chosen id back via `onRun`. Page navigation (branches/repos/files) is owned
 * by the parent, which swaps `commands` and provides `onBack`.
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onRun,
  onBack,
  placeholder = "Type a command or search files…",
  loading = false,
  emptyMessage = "No matching commands.",
  hideGroupsWhenEmpty,
  maxResults = 50,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const filtered = useMemo(() => {
    const hidden = new Set(hideGroupsWhenEmpty ?? []);
    const source =
      query.trim() === "" && hidden.size > 0
        ? commands.filter((c) => !hidden.has(c.group))
        : commands;
    return filterCommands(source, query).slice(0, maxResults);
  }, [commands, query, hideGroupsWhenEmpty, maxResults]);

  // Reset the query whenever the palette opens fresh. Page swaps (new `commands`
  // identity) clear the query too, so a pushed page starts from a clean search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open/page change
  useEffect(() => {
    setQuery("");
  }, [open, commands]);

  // Keep the active row in range as the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => (i >= filtered.length ? 0 : i));
  }, [filtered.length]);

  // Global ⌘K / Ctrl+K toggle. `⌘K` is not otherwise bound in the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  const runActive = useCallback(() => {
    const command = filtered[activeIndex];
    if (command) onRun(command.id);
  }, [filtered, activeIndex, onRun]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) =>
          filtered.length ? (i + 1) % filtered.length : 0,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) =>
          filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        runActive();
      } else if (event.key === "Backspace" && query === "" && onBack) {
        event.preventDefault();
        onBack();
      }
    },
    [filtered.length, runActive, query, onBack],
  );

  const grouped = useMemo(() => groupByGroup(filtered), [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        // Keep focus on the search input rather than the first list row.
        initialFocus={inputRef}
        aria-label="Command palette"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-activedescendant={
            filtered[activeIndex]
              ? `command-palette-option-${filtered[activeIndex].id}`
              : undefined
          }
          data-testid="command-palette-input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
          className="w-full border-b border-[#E7E2D8] bg-transparent px-4 py-3 text-sm text-stone-800 outline-none placeholder:text-stone-400 dark:border-slate-700 dark:text-slate-100"
        />
        {/* div + role=listbox: the combobox pattern needs an ARIA listbox, but
            ul/li carry their own implicit roles that conflict with it. */}
        <div
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto py-1"
        >
          {loading ? (
            <div className="px-4 py-3 text-sm text-stone-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-stone-400">
              {emptyMessage}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.group}>
                <div className="px-4 pt-2 pb-1 font-mono text-[0.65rem] tracking-wide text-stone-400 uppercase">
                  {group.group}
                </div>
                {group.items.map(({ command, index }) => {
                  const active = index === activeIndex;
                  return (
                    // Keyboard handling lives on the combobox input (arrows +
                    // Enter); the click is a pointer convenience.
                    // biome-ignore lint/a11y/useKeyWithClickEvents: keys handled on the input
                    <div
                      key={command.id}
                      id={`command-palette-option-${command.id}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={active}
                      data-testid={`command-palette-option-${command.id}`}
                      data-active={active || undefined}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => onRun(command.id)}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-1.5 text-sm ${
                        active
                          ? "bg-[#EEE9E1] text-stone-900 dark:bg-slate-800 dark:text-slate-50"
                          : "text-stone-700 dark:text-slate-200"
                      }`}
                    >
                      <span className="truncate">{command.title}</span>
                      {command.hint ? (
                        <span className="shrink-0 font-mono text-[0.7rem] text-stone-400">
                          {command.hint}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
