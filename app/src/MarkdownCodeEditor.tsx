import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml, yamlFrontmatter } from "@codemirror/lang-yaml";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { type CodeHighlight, codeHighlightForPath } from "./file-types";
import { cn } from "./lib/utils";

interface MarkdownCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * File path/name, used to pick the syntax-highlighting grammar. Omit to keep
   * the historical Markdown (+ YAML frontmatter) default.
   */
  path?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  testId?: string;
}

/**
 * CodeMirror language for a highlight kind. `.txt`/`.fsh` ("plain") get no
 * grammar — there is no CodeMirror parser for FHIR Shorthand.
 */
function languageExtensionFor(highlight: CodeHighlight): Extension | null {
  switch (highlight) {
    case "markdown":
      return yamlFrontmatter({ content: markdown() });
    case "yaml":
      return yaml();
    case "json":
      return json();
    case "plain":
      return null;
  }
}

export function createMarkdownCodeEditorExtensions(
  readOnly: boolean,
  onDocumentChange: (value: string) => void,
  lastValueRef: { current: string },
  highlight: CodeHighlight = "markdown",
): Extension[] {
  const language = languageExtensionFor(highlight);
  return [
    basicSetup,
    ...(language ? [language] : []),
    EditorView.lineWrapping,
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;

      const nextValue = update.state.doc.toString();
      if (nextValue === lastValueRef.current) return;

      lastValueRef.current = nextValue;
      onDocumentChange(nextValue);
    }),
    EditorView.theme({
      "&": {
        backgroundColor: "transparent",
        color: "inherit",
        fontFamily:
          'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: "0.95rem",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.75",
        overflow: "auto",
      },
      ".cm-content": {
        minHeight: "70vh",
        padding: "0",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        border: "none",
        color: "rgb(148 163 184)",
        marginRight: "0.75rem",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--cm-selection-bg, rgb(224 242 254))",
      },
      ".cm-gutterElement": {
        padding: "0 0.5rem 0 0",
      },
      ".cm-foldGutter": {
        display: "none",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "rgb(100 116 139)",
      },
      "&.cm-focused": {
        outline: "none",
      },
    }),
  ];
}

export function MarkdownCodeEditor({
  value,
  onChange,
  path,
  autoFocus = false,
  readOnly = false,
  className,
  testId,
}: MarkdownCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);
  const lastValueRef = useRef(value);
  const highlight: CodeHighlight = path
    ? codeHighlightForPath(path)
    : "markdown";

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) return;

    const view = new EditorView({
      parent: hostElement,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: createMarkdownCodeEditorExtensions(
          readOnly,
          (nextValue) => onChangeRef.current(nextValue),
          lastValueRef,
          highlight,
        ),
      }),
    });

    editorViewRef.current = view;
    lastValueRef.current = view.state.doc.toString();

    if (autoFocus) {
      view.focus();
    }

    return () => {
      editorViewRef.current = null;
      view.destroy();
    };
  }, [autoFocus, readOnly, highlight]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      lastValueRef.current = value;
      return;
    }

    lastValueRef.current = value;
    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    });
  }, [value]);

  return (
    <div
      ref={hostRef}
      className={cn("markdown-code-editor", className)}
      data-testid={testId}
    />
  );
}
