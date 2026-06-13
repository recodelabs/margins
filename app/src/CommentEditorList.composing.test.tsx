import { describe, expect, it, vi } from "vitest";
import { emitComposingState } from "./CommentEditorList";

describe("emitComposingState", () => {
  it("reports true when any comment is being edited", () => {
    const cb = vi.fn();
    emitComposingState(["c1"], cb);
    expect(cb).toHaveBeenCalledWith(true);
  });
  it("reports false when none are being edited", () => {
    const cb = vi.fn();
    emitComposingState([], cb);
    expect(cb).toHaveBeenCalledWith(false);
  });
  it("does nothing when no callback is provided", () => {
    expect(() => emitComposingState(["c1"], undefined)).not.toThrow();
  });
});
