import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharePopover } from "./SharePopover";

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

const baseProps = {
  canEdit: true,
  shareUrl: "https://marginsmd.pages.dev/o/r/doc.md",
  content: "# Doc\n",
  onSetPublic: vi.fn(async () => {}),
};

function getShareToggle(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>(
    "[data-testid='share-public-toggle']",
  );
}

describe("SharePopover", () => {
  it("shows the Public toggle reflecting the doc's current flag", async () => {
    await act(async () => {
      root.render(
        <SharePopover
          {...baseProps}
          content={"---\npublic: true\n---\n# Doc\n"}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-testid='share-trigger']",
    );
    if (!trigger) throw new Error("share-trigger not found");
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const toggle = getShareToggle();
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(true);
  });

  it("calls onSetPublic(true) when toggled on", async () => {
    const onSetPublic = vi.fn(async () => {});
    await act(async () => {
      root.render(
        <SharePopover
          {...baseProps}
          content={"# Doc\n"}
          onSetPublic={onSetPublic}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-testid='share-trigger']",
    );
    if (!trigger) throw new Error("share-trigger not found");
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const toggle = getShareToggle();
    if (!toggle) throw new Error("share-public-toggle not found");
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSetPublic).toHaveBeenCalledWith(true);
  });

  it("disables the toggle for users without edit access", async () => {
    await act(async () => {
      root.render(<SharePopover {...baseProps} canEdit={false} />);
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-testid='share-trigger']",
    );
    if (!trigger) throw new Error("share-trigger not found");
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const toggle = getShareToggle();
    expect(toggle).not.toBeNull();
    expect(toggle?.disabled).toBe(true);
  });
});
