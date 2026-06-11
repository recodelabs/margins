import { describe, expect, it, vi } from "vitest";
import {
  type DocumentSaveController,
  createDocumentSessionStore,
} from "./document-session";

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
    });
  });
});
