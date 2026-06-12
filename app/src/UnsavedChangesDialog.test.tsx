import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnsavedChangesDialog,
  type UnsavedChangesDialogProps,
} from "./UnsavedChangesDialog";

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

function buttonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

function render(props: Partial<UnsavedChangesDialogProps> = {}) {
  const handlers = {
    onCommitAndLeave: vi.fn(),
    onLeaveWithoutSaving: vi.fn(),
    onStay: vi.fn(),
  };
  act(() => {
    root.render(
      <UnsavedChangesDialog
        open
        manualCommit
        committing={false}
        error={null}
        {...handlers}
        {...props}
      />,
    );
  });
  return handlers;
}

describe("UnsavedChangesDialog", () => {
  it("shows the three actions with the manual-commit primary label", () => {
    render({ manualCommit: true });
    expect(buttonByText("Stay")).not.toBeNull();
    expect(buttonByText("Leave without saving")).not.toBeNull();
    expect(buttonByText("Commit & leave")).not.toBeNull();
  });

  it("uses 'Save & leave' when not in manual-commit mode", () => {
    render({ manualCommit: false });
    expect(buttonByText("Save & leave")).not.toBeNull();
    expect(buttonByText("Commit & leave")).toBeNull();
  });

  it("fires the matching handler for each button", () => {
    const handlers = render();
    act(() => buttonByText("Commit & leave")?.click());
    expect(handlers.onCommitAndLeave).toHaveBeenCalledTimes(1);
    act(() => buttonByText("Leave without saving")?.click());
    expect(handlers.onLeaveWithoutSaving).toHaveBeenCalledTimes(1);
    act(() => buttonByText("Stay")?.click());
    expect(handlers.onStay).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons and shows 'Committing…' while committing", () => {
    render({ committing: true });
    expect(buttonByText("Committing…")).not.toBeNull();
    expect(buttonByText("Stay")?.disabled).toBe(true);
    expect(buttonByText("Leave without saving")?.disabled).toBe(true);
    expect(buttonByText("Committing…")?.disabled).toBe(true);
  });

  it("renders an inline error when provided", () => {
    render({ error: "Commit failed (500)" });
    expect(document.body.textContent).toContain("Commit failed (500)");
  });
});
