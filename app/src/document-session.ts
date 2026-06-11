import { useSyncExternalStore } from "react";
import type { DocumentSaveController, DocumentSaveState } from "./PageCard";

/**
 * The single source of truth for a document editing session's save, dirty, and
 * draft state, plus the controller used to flush pending autosaves.
 *
 * These four facts are produced by the leaf editor (`PageCardEditorSurface`) and
 * consumed by ancestors: `DocumentWorkspace` (save-status UI, ⌘S/handoff flush)
 * and `App` (the `beforeunload` warning, overwrite-on-disk, and review handoff).
 * The store replaces the mirror copies that previously lived as `useState` and
 * refs in `PageCard`, `DocumentWorkspace`, and `App`.
 */
export interface DocumentSessionSnapshot {
  saveState: DocumentSaveState;
  dirty: boolean;
  draftContent: string | null;
  saveController: DocumentSaveController | null;
}

export interface DocumentSessionStore {
  getSnapshot: () => DocumentSessionSnapshot;
  subscribe: (listener: () => void) => () => void;
  setSaveState: (state: DocumentSaveState) => void;
  setDirty: (dirty: boolean) => void;
  setDraftContent: (content: string) => void;
  setController: (controller: DocumentSaveController | null) => void;
  /**
   * Reset save/dirty/draft to a freshly-loaded document. Leaves the active save
   * controller untouched — it tracks the editor's lifecycle, not the document.
   */
  reset: (content: string | null) => void;
}

export function createDocumentSessionStore(
  initialContent: string | null = null,
): DocumentSessionStore {
  let snapshot: DocumentSessionSnapshot = {
    saveState: "saved",
    dirty: false,
    draftContent: initialContent,
    saveController: null,
  };
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  // Only swap the snapshot reference when a field actually changes, so that
  // `getSnapshot` returns a stable reference for `useSyncExternalStore` and
  // no-op writes don't trigger spurious re-renders.
  const update = (patch: Partial<DocumentSessionSnapshot>) => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof DocumentSessionSnapshot)[]) {
      if (patch[key] !== snapshot[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = { ...snapshot, ...patch };
    emit();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSaveState: (saveState) => update({ saveState }),
    setDirty: (dirty) => update({ dirty }),
    setDraftContent: (draftContent) => update({ draftContent }),
    setController: (saveController) => update({ saveController }),
    reset: (content) =>
      update({ saveState: "saved", dirty: false, draftContent: content }),
  };
}

/**
 * Subscribe a component to a slice of the document session store. The selector
 * should return a primitive (or otherwise stable) value so the underlying
 * `useSyncExternalStore` does not loop on every render.
 */
export function useDocumentSession<T>(
  store: DocumentSessionStore,
  selector: (snapshot: DocumentSessionSnapshot) => T,
): T {
  return useSyncExternalStore(store.subscribe, () =>
    selector(store.getSnapshot()),
  );
}
