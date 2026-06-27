import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import type { PaletteCommand } from "./command-palette";

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
  vi.restoreAllMocks();
});

const commands: PaletteCommand[] = [
  { id: "save", title: "Save", group: "Actions" },
  { id: "theme", title: "Toggle theme", group: "Actions" },
  { id: "share", title: "Open share", group: "Actions" },
];

function getInput(): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>(
    "[data-testid='command-palette-input']",
  );
  if (!el) throw new Error("command-palette-input not found");
  return el;
}

function getOptionIds(): string[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>("[role='option']"),
  ].map((el) => el.id.replace("command-palette-option-", ""));
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(input: HTMLElement, k: string) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

async function renderPalette(
  props: Partial<Parameters<typeof CommandPalette>[0]> = {},
) {
  await act(async () => {
    root.render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        commands={commands}
        onRun={vi.fn()}
        {...props}
      />,
    );
  });
}

describe("CommandPalette", () => {
  it("renders the search input and all commands when open", async () => {
    await renderPalette();
    expect(getInput()).not.toBeNull();
    expect(getOptionIds()).toEqual(["save", "theme", "share"]);
  });

  it("opens on ⌘K when closed", async () => {
    const onOpenChange = vi.fn();
    await renderPalette({ open: false, onOpenChange });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("filters the list as the user types", async () => {
    await renderPalette();
    await act(async () => {
      typeInto(getInput(), "share");
    });
    expect(getOptionIds()).toEqual(["share"]);
  });

  it("runs the active command on Enter and moves with ArrowDown", async () => {
    const onRun = vi.fn();
    await renderPalette({ onRun });

    await act(async () => {
      key(getInput(), "Enter");
    });
    expect(onRun).toHaveBeenLastCalledWith("save");

    await act(async () => {
      key(getInput(), "ArrowDown");
    });
    await act(async () => {
      key(getInput(), "Enter");
    });
    expect(onRun).toHaveBeenLastCalledWith("theme");
  });

  it("calls onBack on Backspace with an empty query", async () => {
    const onBack = vi.fn();
    await renderPalette({ onBack });
    await act(async () => {
      key(getInput(), "Backspace");
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides configured groups until the user types", async () => {
    const withFiles: PaletteCommand[] = [
      ...commands,
      { id: "file:a", title: "a.md", group: "Files" },
      { id: "file:b", title: "b.md", group: "Files" },
    ];
    await renderPalette({
      commands: withFiles,
      hideGroupsWhenEmpty: ["Files"],
    });
    expect(getOptionIds()).toEqual(["save", "theme", "share"]);
    await act(async () => {
      typeInto(getInput(), "a.md");
    });
    expect(getOptionIds()).toContain("file:a");
  });

  it("caps the number of rendered rows via maxResults", async () => {
    const many: PaletteCommand[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      title: `Command ${i}`,
      group: "Actions",
    }));
    await renderPalette({ commands: many, maxResults: 3 });
    expect(getOptionIds()).toHaveLength(3);
  });

  it("runs a command when its row is clicked", async () => {
    const onRun = vi.fn();
    await renderPalette({ onRun });
    const option = document.body.querySelector<HTMLElement>(
      "[data-testid='command-palette-option-theme']",
    );
    if (!option) throw new Error("option not found");
    await act(async () => {
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRun).toHaveBeenCalledWith("theme");
  });
});
