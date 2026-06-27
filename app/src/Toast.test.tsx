import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("renders the message and a commit link", () => {
    const { container, cleanup } = mount(
      <Toast
        message="Updated by the agent · did it"
        commitUrl="https://x/commit/abc"
        onDismiss={() => {}}
      />,
    );
    expect(container.textContent).toContain("Updated by the agent · did it");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://x/commit/abc");
    cleanup();
  });

  it("renders a pull request link when given a prUrl", () => {
    const { container, cleanup } = mount(
      <Toast
        message="Opened a pull request with your changes."
        prUrl="https://github.com/o/r/pull/7"
        onDismiss={() => {}}
      />,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://github.com/o/r/pull/7");
    expect(link?.textContent).toContain("pull request");
    cleanup();
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    const { container, cleanup } = mount(
      <Toast message="hi" onDismiss={onDismiss} />,
    );
    const button = container.querySelector("button");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("auto-dismisses after durationMs", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { cleanup } = mount(
      <Toast message="hi" durationMs={6000} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
