import { describe, expect, it, vi } from "vitest";
import {
  createDocumentSessionStore,
  type DocumentSaveController,
} from "./document-session";

describe("document session: composingComment", () => {
  it("defaults to false", () => {
    expect(createDocumentSessionStore().getSnapshot().composingComment).toBe(
      false,
    );
  });

  it("setComposing(id, true) sets composingComment to true", () => {
    const store = createDocumentSessionStore();
    store.setComposing("a", true);
    expect(store.getSnapshot().composingComment).toBe(true);
  });

  it("setComposing(id, false) sets composingComment to false when only source", () => {
    const store = createDocumentSessionStore();
    store.setComposing("a", true);
    store.setComposing("a", false);
    expect(store.getSnapshot().composingComment).toBe(false);
  });

  it("stays true while any source remains composing", () => {
    const store = createDocumentSessionStore();
    store.setComposing("a", true);
    store.setComposing("b", true);
    store.setComposing("a", false);
    expect(store.getSnapshot().composingComment).toBe(true);
  });

  it("goes false when all sources report done", () => {
    const store = createDocumentSessionStore();
    store.setComposing("a", true);
    store.setComposing("b", true);
    store.setComposing("a", false);
    store.setComposing("b", false);
    expect(store.getSnapshot().composingComment).toBe(false);
  });

  it("reset clears composingComment", () => {
    const store = createDocumentSessionStore();
    store.setComposing("a", true);
    store.reset("new content");
    expect(store.getSnapshot().composingComment).toBe(false);
  });
});

const noopController: DocumentSaveController = {
  flushSave: async () => ({ status: "saved" }),
};

describe("createDocumentSessionStore", () => {
  it("starts saved, clean, and uninitialised", () => {
    const store = createDocumentSessionStore();
    expect(store.getSnapshot()).toEqual({
      saveState: "saved",
      dirty: false,
      draftContent: null,
      saveController: null,
      composingComment: false,
    });
  });

  it("seeds draft content from the initial value", () => {
    const store = createDocumentSessionStore("# Hello");
    expect(store.getSnapshot().draftContent).toBe("# Hello");
  });

  it("notifies subscribers when a field changes", () => {
    const store = createDocumentSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSaveState("saving");
    store.setDirty(true);
    store.setDraftContent("draft");
    store.setController(noopController);

    expect(listener).toHaveBeenCalledTimes(4);
    expect(store.getSnapshot()).toEqual({
      saveState: "saving",
      dirty: true,
      draftContent: "draft",
      saveController: noopController,
      composingComment: false,
    });
  });

  it("does not notify or change the snapshot reference on a no-op write", () => {
    const store = createDocumentSessionStore("doc");
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    store.setSaveState("saved"); // already "saved"
    store.setDirty(false); // already false
    store.setDraftContent("doc"); // already "doc"

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
  });

  it("keeps a stable snapshot reference until a real change occurs", () => {
    const store = createDocumentSessionStore();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);

    store.setDirty(true);
    const second = store.getSnapshot();
    expect(second).not.toBe(first);
    expect(store.getSnapshot()).toBe(second);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createDocumentSessionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setSaveState("saving");
    unsubscribe();
    store.setSaveState("saved");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reset restores saved/clean state and new draft, preserving the controller", () => {
    const store = createDocumentSessionStore("old");
    store.setSaveState("error");
    store.setDirty(true);
    store.setController(noopController);

    store.reset("new");

    expect(store.getSnapshot()).toEqual({
      saveState: "saved",
      dirty: false,
      draftContent: "new",
      saveController: noopController,
      composingComment: false,
    });
  });
});
