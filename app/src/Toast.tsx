import { useEffect } from "react";

export interface ToastProps {
  message: string;
  commitUrl?: string;
  durationMs?: number;
  onDismiss: () => void;
}

export function Toast({
  message,
  commitUrl,
  durationMs = 6000,
  onDismiss,
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 shadow-lg"
    >
      <div className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
        {message}
        {commitUrl ? (
          <a
            href={commitUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-2 whitespace-nowrap underline"
          >
            view commit ↗
          </a>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-amber-700 hover:opacity-70 dark:text-amber-300"
      >
        ✕
      </button>
    </div>
  );
}
