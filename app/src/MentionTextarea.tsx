import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type ActiveMentionQuery,
  applyMention,
  filterMentionCandidates,
  getActiveMentionQuery,
} from "./comment-mentions";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";

interface MentionTextareaProps {
  value: string;
  placeholder?: string;
  className?: string;
  rows?: number;
  testId?: string;
  /** Logins offered when the user types `@`. */
  mentionCandidates: readonly string[];
  /** Registers the underlying element with the owner's ref map. */
  registerRef?: (node: HTMLTextAreaElement | null) => void;
  onValueChange: (value: string) => void;
  /** Enter (without Shift) when the mention menu is closed. */
  onSubmit: () => void;
  /** Escape when the mention menu is closed. */
  onCancel: () => void;
  onSelect?: () => void;
}

/**
 * A textarea with an inline `@mention` autocomplete. The menu owns ArrowUp/Down,
 * Enter/Tab and Escape while it is open, so those keys pick a suggestion instead
 * of submitting or cancelling the comment; once it is closed the keys fall
 * through to `onSubmit`/`onCancel`, preserving the composer's existing shortcuts.
 */
export function MentionTextarea({
  value,
  placeholder,
  className,
  rows,
  testId,
  mentionCandidates,
  registerRef,
  onValueChange,
  onSubmit,
  onCancel,
  onSelect,
}: MentionTextareaProps) {
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  const [range, setRange] = useState<ActiveMentionQuery | null>(null);
  const [matches, setMatches] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);

  const menuOpen = range !== null && matches.length > 0;

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      elementRef.current = node;
      registerRef?.(node);
    },
    [registerRef],
  );

  const closeMenu = useCallback(() => {
    setRange(null);
    setMatches([]);
    setActiveIndex(0);
  }, []);

  const recompute = useCallback(
    (text: string, caret: number) => {
      if (mentionCandidates.length === 0) {
        closeMenu();
        return;
      }
      const nextRange = getActiveMentionQuery(text, caret);
      if (!nextRange) {
        closeMenu();
        return;
      }
      const nextMatches = filterMentionCandidates(
        mentionCandidates,
        nextRange.query,
      );
      if (nextMatches.length === 0) {
        closeMenu();
        return;
      }
      setRange(nextRange);
      setMatches(nextMatches);
      setActiveIndex(0);
    },
    [closeMenu, mentionCandidates],
  );

  const selectCandidate = useCallback(
    (login: string) => {
      if (!range) return;
      const { text, caret } = applyMention(
        value,
        range.start,
        range.end,
        login,
      );
      onValueChange(text);
      closeMenu();
      setPendingCaret(caret);
    },
    [closeMenu, onValueChange, range, value],
  );

  // Restore the caret after a mention insertion changes the controlled value.
  useEffect(() => {
    if (pendingCaret === null) return;
    const element = elementRef.current;
    if (element) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex((index) => (index + 1) % matches.length);
          return;
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex(
            (index) => (index - 1 + matches.length) % matches.length,
          );
          return;
        case "Enter":
        case "Tab":
          if (event.shiftKey) break;
          event.preventDefault();
          event.stopPropagation();
          selectCandidate(matches[activeIndex] ?? matches[0]);
          return;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          return;
        default:
          break;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  const syncCaret = (
    event: { currentTarget: HTMLTextAreaElement } | undefined,
  ) => {
    const element = event?.currentTarget;
    if (!element) return;
    recompute(element.value, element.selectionStart ?? element.value.length);
  };

  return (
    <div className="relative">
      <Textarea
        data-testid={testId}
        ref={setRefs}
        value={value}
        placeholder={placeholder}
        rows={rows}
        className={className}
        onPointerDown={(event: ReactPointerEvent<HTMLTextAreaElement>) => {
          event.stopPropagation();
          onSelect?.();
        }}
        onClick={(event) => {
          event.stopPropagation();
          syncCaret(event);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => syncCaret(event)}
        onFocus={() => onSelect?.()}
        onChange={(event) => {
          onValueChange(event.target.value);
          syncCaret(event);
        }}
      />
      {menuOpen ? (
        <div
          data-testid={testId ? `${testId}-mentions` : undefined}
          className="absolute top-full left-0 z-50 mt-1 max-h-48 w-56 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          role="listbox"
        >
          {matches.map((login, index) => (
            <button
              key={login}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center px-3 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200",
                index === activeIndex
                  ? "bg-slate-100 dark:bg-slate-700"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700/60",
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={(event) => {
                // Keep focus in the textarea so caret restoration works.
                event.preventDefault();
                event.stopPropagation();
                selectCandidate(login);
              }}
            >
              <span className="text-slate-400 dark:text-slate-500">@</span>
              {login}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
