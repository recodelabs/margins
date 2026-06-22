/**
 * Small display formatters for the file list: human-readable file sizes and
 * relative timestamps. Kept dependency-free and pure so they're trivial to
 * unit-test (the relative-time helper takes `now` rather than reading the
 * clock).
 */

/** One decimal place, but drop a trailing `.0` (e.g. `1.0` → `1`). */
function trimDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Bytes as `B` / `KB` / `MB` (binary, 1024-based). Whole bytes show no
 * decimal; KB and MB show one significant decimal with a trailing `.0`
 * trimmed.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimDecimal(kb)} KB`;
  return `${trimDecimal(kb / 1024)} MB`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/**
 * Coarse relative time ("5 min ago", "3 hours ago", "yesterday", "2 weeks
 * ago", …). `now` is injected for testability. Future timestamps and anything
 * under ~45s collapse to "just now".
 */
export function formatRelativeTime(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((now.getTime() - then) / 1000);

  if (seconds < 45) return "just now";
  if (seconds < HOUR) {
    const mins = Math.round(seconds / MINUTE);
    return `${mins} min ago`;
  }
  if (seconds < DAY) {
    const hours = Math.round(seconds / HOUR);
    return plural(hours, "hour");
  }
  if (seconds < 2 * DAY) return "yesterday";
  if (seconds < WEEK) return plural(Math.round(seconds / DAY), "day");
  if (seconds < MONTH) return plural(Math.round(seconds / WEEK), "week");
  if (seconds < YEAR) return plural(Math.round(seconds / MONTH), "month");
  return plural(Math.round(seconds / YEAR), "year");
}
