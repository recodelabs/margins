import { describe, expect, it, vi } from "vitest";
import { scrollCommentAnchorIntoView } from "./comment-scroll";

function fakeAnchor() {
  return { scrollIntoView: vi.fn() } as unknown as HTMLElement;
}

describe("scrollCommentAnchorIntoView", () => {
  it("scrolls the anchor into view only as needed (nearest), smoothly", () => {
    const anchor = fakeAnchor();
    scrollCommentAnchorIntoView(anchor, false);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
    });
  });

  it("uses an instant scroll when reduced motion is preferred", () => {
    const anchor = fakeAnchor();
    scrollCommentAnchorIntoView(anchor, true);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "nearest",
    });
  });

  it("does nothing for a null anchor", () => {
    expect(() => scrollCommentAnchorIntoView(null, false)).not.toThrow();
  });

  it("does nothing when scrollIntoView is unavailable (e.g. jsdom)", () => {
    const anchor = {} as unknown as HTMLElement;
    expect(() => scrollCommentAnchorIntoView(anchor, false)).not.toThrow();
  });

  it("centers the element when block: 'center' is requested (jump-to-comment)", () => {
    const anchor = fakeAnchor();
    scrollCommentAnchorIntoView(anchor, false, "center");
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });
});
