import { describe, expect, it, vi } from "vitest";
import { emitComposingState } from "./CommentEditorList";

describe("emitComposingState", () => {
  it("reports true when any comment is being edited", () => {
    const cb = vi.fn();
    emitComposingState("id-1", ["c1"], cb);
    expect(cb).toHaveBeenCalledWith("id-1", true);
  });
  it("reports false when none are being edited", () => {
    const cb = vi.fn();
    emitComposingState("id-1", [], cb);
    expect(cb).toHaveBeenCalledWith("id-1", false);
  });
  it("does nothing when no callback is provided", () => {
    expect(() => emitComposingState("id-1", ["c1"], undefined)).not.toThrow();
  });
});
