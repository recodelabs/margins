import { describe, expect, it, vi } from "vitest";
import { alignElementToTarget, scrollOffsetToAlign } from "./comment-scroll";

describe("scrollOffsetToAlign", () => {
  it("returns the delta that moves `mover` up to `target` (mover below target)", () => {
    // mover at 500, target at 300 → scroll down 200 so mover rises to 300.
    expect(scrollOffsetToAlign(500, 300)).toBe(200);
  });

  it("returns a negative delta when the mover is above the target", () => {
    expect(scrollOffsetToAlign(100, 300)).toBe(-200);
  });

  it("returns 0 when already aligned", () => {
    expect(scrollOffsetToAlign(300, 300)).toBe(0);
  });
});

describe("alignElementToTarget", () => {
  function el(top: number, withScrollBy = false) {
    return {
      getBoundingClientRect: () => ({ top }),
      ...(withScrollBy ? { scrollBy: vi.fn() } : {}),
    } as unknown as HTMLElement & { scrollBy?: ReturnType<typeof vi.fn> };
  }

  it("scrolls the scroller by the alignment delta, smoothly", () => {
    const scroller = el(0, true);
    alignElementToTarget(scroller, el(500), el(300), false);
    expect(scroller.scrollBy).toHaveBeenCalledWith({
      top: 200,
      behavior: "smooth",
    });
  });

  it("uses an instant scroll under reduced motion", () => {
    const scroller = el(0, true);
    alignElementToTarget(scroller, el(500), el(300), true);
    expect(scroller.scrollBy).toHaveBeenCalledWith({
      top: 200,
      behavior: "auto",
    });
  });

  it("no-ops when already aligned (sub-pixel)", () => {
    const scroller = el(0, true);
    alignElementToTarget(scroller, el(300), el(300), false);
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });

  it("no-ops on missing elements or absent scrollBy", () => {
    expect(() =>
      alignElementToTarget(null, el(500), el(300), false),
    ).not.toThrow();
    const noScrollBy = el(0, false);
    expect(() =>
      alignElementToTarget(noScrollBy, el(500), el(300), false),
    ).not.toThrow();
  });
});
