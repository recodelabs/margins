import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CommentGroupAnchor,
  getCommentAnchorMeasurements,
  groupCommentAnchorMeasurements,
  resolveAnchorReferenceElement,
} from "./document-comments";

interface CommentAnchorLayoutState {
  commentGroups: CommentGroupAnchor[];
  contentHeight: number;
}

export function useCommentAnchorLayout(editor: Editor | null, enabled = true) {
  const frameRef = useRef<number | null>(null);
  const [layoutState, setLayoutState] = useState<CommentAnchorLayoutState>({
    commentGroups: [],
    contentHeight: 0,
  });

  const measureLayout = useCallback(() => {
    if (!enabled) {
      setLayoutState({
        commentGroups: [],
        contentHeight: 0,
      });
      return;
    }

    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = requestAnimationFrame(() => {
      let editorElement: HTMLElement | undefined;

      try {
        editorElement = editor?.view.dom as HTMLElement | undefined;
      } catch {
        editorElement = undefined;
      }

      if (!editorElement) {
        setLayoutState({
          commentGroups: [],
          contentHeight: 0,
        });
        return;
      }

      const editorRect = editorElement.getBoundingClientRect();
      const referenceTop =
        resolveAnchorReferenceElement(editorElement).getBoundingClientRect()
          .top;
      const anchorElements = editorElement.querySelectorAll<HTMLElement>(
        ".comment-anchor[data-comment-ids]",
      );
      const measurements = getCommentAnchorMeasurements(
        anchorElements,
        referenceTop,
        1,
      );

      setLayoutState({
        commentGroups: groupCommentAnchorMeasurements(measurements),
        contentHeight: editorRect.height,
      });
    });
  }, [editor, enabled]);

  useEffect(() => {
    measureLayout();

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [measureLayout]);

  useEffect(() => {
    if (!enabled || !editor) return;

    const handleEditorUpdate = () => {
      measureLayout();
    };

    const editorElement = editor.view.dom as HTMLElement;
    const resizeObserver = new ResizeObserver(() => {
      measureLayout();
    });

    resizeObserver.observe(editorElement);
    if (editorElement.parentElement) {
      resizeObserver.observe(editorElement.parentElement);
    }

    // Only the document changing (or the container resizing) can move anchors;
    // selection changes don't, so we deliberately skip "selectionUpdate" to
    // avoid remeasuring on every cursor move.
    editor.on("update", handleEditorUpdate);
    window.addEventListener("resize", handleEditorUpdate);

    if (document.fonts) {
      void document.fonts.ready.then(handleEditorUpdate);
    }

    return () => {
      resizeObserver.disconnect();
      editor.off("update", handleEditorUpdate);
      window.removeEventListener("resize", handleEditorUpdate);
    };
  }, [editor, enabled, measureLayout]);

  return {
    ...layoutState,
    measureLayout,
  };
}
