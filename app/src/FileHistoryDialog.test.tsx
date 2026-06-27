import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileHistoryDialog,
  type FileHistoryDialogProps,
} from "./FileHistoryDialog";
import type { FileCommit } from "./storage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const COMMITS: FileCommit[] = [
  {
    sha: "sha2",
    message: "Second change",
    date: "2026-06-20T10:00:00Z",
    authorName: "Octo Cat",
    authorLogin: "octocat",
  },
  {
    sha: "sha1",
    message: "First change",
    date: "2026-06-19T10:00:00Z",
    authorName: "Amadeus",
    authorLogin: null,
  },
];

const CONTENT: Record<string, string> = {
  sha2: "line one\nline two changed",
  sha1: "line one\nline two",
};

async function render(props: Partial<FileHistoryDialogProps> = {}) {
  const handlers = {
    path: "docs/x.md",
    currentContent: "line one\nline two changed",
    listFileHistory: vi.fn(async () => COMMITS),
    readFileAtRef: vi.fn(async (_path: string, ref: string) => CONTENT[ref]),
    commitUrl: (sha: string) => `https://github.com/o/r/commit/${sha}`,
    now: new Date("2026-06-20T11:00:00Z"),
    onClose: vi.fn(),
    ...props,
  };
  await act(async () => {
    root.render(<FileHistoryDialog {...handlers} />);
  });
  // Let the history fetch and the initial diff fetch settle.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return handlers;
}

function rowsByType(type: "add" | "del" | "context"): string[] {
  return Array.from(
    document.querySelectorAll(`[data-testid="diff-row-${type}"]`),
  ).map((el) => el.getAttribute("data-line-text") ?? "");
}

describe("FileHistoryDialog", () => {
  it("lists the file's commits", async () => {
    await render();
    expect(document.body.textContent).toContain("Second change");
    expect(document.body.textContent).toContain("First change");
  });

  it("shows the diff of the newest commit against its predecessor by default", async () => {
    await render();
    expect(rowsByType("context")).toContain("line one");
    expect(rowsByType("del")).toContain("line two");
    expect(rowsByType("add")).toContain("line two changed");
  });

  it("renders a message instead of a diff when the file has no history", async () => {
    await render({ listFileHistory: vi.fn(async () => []) });
    expect(document.body.textContent).toContain("No history");
  });
});
