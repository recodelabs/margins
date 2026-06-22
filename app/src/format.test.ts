import { describe, expect, it } from "vitest";
import { formatFileSize, formatRelativeTime } from "./format";

describe("formatFileSize", () => {
  it("formats bytes under 1 KB with no decimals", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes with one decimal, trimming a trailing .0", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-22T12:00:00Z");

  it("returns 'just now' for very recent times", () => {
    expect(formatRelativeTime("2026-06-22T11:59:30Z", now)).toBe("just now");
  });

  it("returns minutes for times under an hour", () => {
    expect(formatRelativeTime("2026-06-22T11:55:00Z", now)).toBe("5 min ago");
  });

  it("returns hours for times under a day", () => {
    expect(formatRelativeTime("2026-06-22T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-06-22T11:00:00Z", now)).toBe("1 hour ago");
  });

  it("returns days for times under a week", () => {
    expect(formatRelativeTime("2026-06-20T12:00:00Z", now)).toBe("2 days ago");
    expect(formatRelativeTime("2026-06-21T12:00:00Z", now)).toBe("yesterday");
  });

  it("returns weeks, months, and years for older times", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00Z", now)).toBe("3 weeks ago");
    expect(formatRelativeTime("2026-03-22T12:00:00Z", now)).toBe(
      "3 months ago",
    );
    expect(formatRelativeTime("2024-06-22T12:00:00Z", now)).toBe("2 years ago");
  });
});
