import { afterEach, describe, expect, it } from "vitest";
import {
  COMMENTS_HIDDEN_STORAGE_KEY,
  readStoredCommentsHidden,
  shouldShowReviewRail,
  writeStoredCommentsHidden,
} from "./comment-visibility";

afterEach(() => {
  window.localStorage.clear();
});

describe("shouldShowReviewRail", () => {
  it("shows the rail when there are comments and they are not hidden", () => {
    expect(shouldShowReviewRail(2, 0, false)).toBe(true);
  });

  it("shows the rail when there are suggestions and they are not hidden", () => {
    expect(shouldShowReviewRail(0, 3, false)).toBe(true);
  });

  it("hides the rail when comments are hidden, even with annotations", () => {
    expect(shouldShowReviewRail(2, 3, true)).toBe(false);
  });

  it("hides the rail when there are no annotations", () => {
    expect(shouldShowReviewRail(0, 0, false)).toBe(false);
  });
});

describe("comments-hidden persistence", () => {
  it("defaults to shown when nothing is stored", () => {
    expect(readStoredCommentsHidden()).toBe(false);
  });

  it("round-trips the hidden preference through localStorage", () => {
    writeStoredCommentsHidden(true);
    expect(window.localStorage.getItem(COMMENTS_HIDDEN_STORAGE_KEY)).toBe("1");
    expect(readStoredCommentsHidden()).toBe(true);

    writeStoredCommentsHidden(false);
    expect(window.localStorage.getItem(COMMENTS_HIDDEN_STORAGE_KEY)).toBe("0");
    expect(readStoredCommentsHidden()).toBe(false);
  });

  it('treats any non-"1" stored value as shown', () => {
    window.localStorage.setItem(COMMENTS_HIDDEN_STORAGE_KEY, "true");
    expect(readStoredCommentsHidden()).toBe(false);
  });
});
