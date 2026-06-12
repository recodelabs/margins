import { describe, expect, it, vi } from "vitest";
import { scrollCommentAnchorIntoView } from "./comment-scroll";

function fakeAnchor() {
  return { scrollIntoView: vi.fn() } as unknown as HTMLElement;
}

describe("scrollCommentAnchorIntoView", () => {
  it("smooth-centers the anchor when reduced motion is not preferred", () => {
    const anchor = fakeAnchor();
    scrollCommentAnchorIntoView(anchor, false);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("uses an instant scroll when reduced motion is preferred", () => {
    const anchor = fakeAnchor();
    scrollCommentAnchorIntoView(anchor, true);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
  });

  it("does nothing for a null anchor", () => {
    expect(() => scrollCommentAnchorIntoView(null, false)).not.toThrow();
  });

  it("does nothing when scrollIntoView is unavailable (e.g. jsdom)", () => {
    const anchor = {} as unknown as HTMLElement;
    expect(() => scrollCommentAnchorIntoView(anchor, false)).not.toThrow();
  });
});
