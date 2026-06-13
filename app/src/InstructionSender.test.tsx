import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstructionSender } from "./InstructionSender";

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

function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

describe("InstructionSender", () => {
  it("loads and renders the existing history with derived status", async () => {
    const readActivityLog = vi.fn(async () => [
      {
        id: "a1",
        at: "t",
        by: "matt",
        role: "user",
        type: "rewrite",
        instruction: "tighten",
      },
    ]);
    await act(async () => {
      root.render(
        <InstructionSender
          docPath="docs/x.md"
          author="matt"
          readActivityLog={readActivityLog}
          appendActivityEntry={vi.fn()}
        />,
      );
    });
    expect(readActivityLog).toHaveBeenCalledWith("docs/x.md");
    expect(container.textContent).toContain("tighten");
    expect(container.textContent).toContain("Pending");
  });

  it("sends a typed instruction as a pending user entry, then reloads", async () => {
    const readActivityLog = vi.fn(async () => []);
    const appendActivityEntry = vi.fn(async () => {});
    await act(async () => {
      root.render(
        <InstructionSender
          docPath="docs/x.md"
          author="matt"
          readActivityLog={readActivityLog}
          appendActivityEntry={appendActivityEntry}
        />,
      );
    });

    const box = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!box) throw new Error("textarea not found");
    await act(async () => {
      buttonByText("Rewrite")?.click();
      typeInto(box, "tighten the intro");
    });
    await act(async () => {
      buttonByText("Send")?.click();
    });

    expect(appendActivityEntry).toHaveBeenCalledTimes(1);
    const [path, entry] = appendActivityEntry.mock.calls[0];
    expect(path).toBe("docs/x.md");
    expect(entry).toMatchObject({
      role: "user",
      type: "rewrite",
      by: "matt",
      instruction: "tighten the intro",
    });
    expect(typeof entry.id).toBe("string");
    expect(readActivityLog).toHaveBeenCalledTimes(2); // initial + after send
  });
});
