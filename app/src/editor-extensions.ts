import { Extension, Mark, mergeAttributes, Node } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type {
  Mark as ProseMirrorMark,
  Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { parseCalloutMarker } from "./callout";
import { rawMarkdownBlockAttribute } from "./markdown";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentRef: {
      setCommentRef: (attributes: { commentIds: string[] }) => ReturnType;
      removeCommentId: (commentId: string) => ReturnType;
      unsetCommentRef: () => ReturnType;
    };
    criticChange: {
      setCriticChange: (attributes: CriticChangeAttrs) => ReturnType;
      unsetCriticChange: () => ReturnType;
      acceptCriticChange: (changeId: string) => ReturnType;
      rejectCriticChange: (changeId: string) => ReturnType;
    };
  }
}

export type CriticChangeKind =
  | "addition"
  | "deletion"
  | "substitution-old"
  | "substitution-new";

export interface CriticChangeAttrs {
  kind: CriticChangeKind;
  changeId: string;
  authorType?: "user" | "ai";
  authorId?: string | null;
  createdAt: string;
}

export const SUGGESTED_PARAGRAPH_SENTINEL = "\u2060";

const CommentRef = Mark.create({
  name: "commentRef",
  priority: 1100,
  inclusive: false,
  spanning: true,

  addAttributes() {
    return {
      commentIds: {
        default: [],
        parseHTML: (element) => {
          const ids = element.getAttribute("data-comment-ids");

          if (!ids) return [];

          try {
            return JSON.parse(ids);
          } catch {
            return [];
          }
        },
        renderHTML: (attributes) =>
          attributes.commentIds?.length
            ? { "data-comment-ids": JSON.stringify(attributes.commentIds) }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-ids]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "comment-anchor",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentRef:
        (attributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      removeCommentId:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks.commentRef;

          if (!markType) return false;

          let found = false;

          state.doc.descendants((node, pos) => {
            if (!node.isText) return;

            const mark = node.marks.find(
              (candidate) =>
                candidate.type === markType &&
                Array.isArray(candidate.attrs.commentIds) &&
                candidate.attrs.commentIds.includes(commentId),
            );

            if (!mark) return;

            found = true;

            const from = pos;
            const to = pos + node.nodeSize;
            const nextIds = (mark.attrs.commentIds as string[]).filter(
              (id) => id !== commentId,
            );

            tr.removeMark(from, to, markType);

            if (nextIds.length > 0) {
              tr.addMark(from, to, markType.create({ commentIds: nextIds }));
            }
          });

          if (found && dispatch) {
            dispatch(tr);
          }

          return found;
        },
      unsetCommentRef:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

function isCriticChangeKind(value: unknown): value is CriticChangeKind {
  return (
    value === "addition" ||
    value === "deletion" ||
    value === "substitution-old" ||
    value === "substitution-new"
  );
}

function readCriticChangeAttrs(element: HTMLElement): CriticChangeAttrs | null {
  const kind = element.getAttribute("data-critic-change-kind");
  const changeId = element.getAttribute("data-critic-change-id");
  const createdAt = element.getAttribute("data-critic-change-at");

  if (!isCriticChangeKind(kind) || !changeId || !createdAt) {
    return null;
  }

  const rawBy = element.getAttribute("data-critic-change-by") || "user";
  const authorType = rawBy.toUpperCase() === "AI" ? "ai" : "user";

  return {
    kind,
    changeId,
    authorType,
    authorId: authorType === "ai" ? null : rawBy,
    createdAt,
  };
}

function collectCriticChangeRanges(doc: ProseMirrorNode, changeId: string) {
  const markType = doc.type.schema.marks.criticChange;
  const ranges: Array<{
    from: number;
    to: number;
    kind: CriticChangeKind;
    mark: ProseMirrorMark;
  }> = [];

  if (!markType) return ranges;

  doc.descendants((node, pos) => {
    if (!node.isText) return;

    const mark = node.marks.find(
      (candidate) =>
        candidate.type === markType &&
        candidate.attrs.changeId === changeId &&
        isCriticChangeKind(candidate.attrs.kind),
    );

    if (!mark) return;

    const kind = mark.attrs.kind as CriticChangeKind;
    const previous = ranges[ranges.length - 1];

    if (
      previous &&
      previous.to === pos &&
      previous.kind === kind &&
      previous.mark.eq(mark)
    ) {
      previous.to = pos + node.nodeSize;
      return;
    }

    ranges.push({
      from: pos,
      to: pos + node.nodeSize,
      kind,
      mark,
    });
  });

  return ranges;
}

function findSuggestedParagraphSentinels(
  doc: ProseMirrorNode,
  from: number,
  to: number,
) {
  const positions: number[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return;

    let index = node.text.indexOf(SUGGESTED_PARAGRAPH_SENTINEL);
    while (index >= 0) {
      positions.push(pos + index);
      index = node.text.indexOf(SUGGESTED_PARAGRAPH_SENTINEL, index + 1);
    }
  });

  return positions;
}

function isOnlyTextblockContent(
  doc: ProseMirrorNode,
  from: number,
  to: number,
) {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);

  return (
    $from.sameParent($to) &&
    $from.parent.isTextblock &&
    from === $from.start() &&
    to === $from.end()
  );
}

const CriticChange = Mark.create({
  name: "criticChange",
  priority: 1090,
  inclusive: false,
  spanning: true,

  addAttributes() {
    return {
      kind: {
        default: "addition",
        parseHTML: (element) =>
          readCriticChangeAttrs(element as HTMLElement)?.kind ?? "addition",
        renderHTML: (attributes) => ({
          "data-critic-change-kind": attributes.kind,
        }),
      },
      changeId: {
        default: null,
        parseHTML: (element) =>
          readCriticChangeAttrs(element as HTMLElement)?.changeId ?? null,
        renderHTML: (attributes) =>
          attributes.changeId
            ? { "data-critic-change-id": attributes.changeId }
            : {},
      },
      authorType: {
        default: "user",
        parseHTML: (element) =>
          readCriticChangeAttrs(element as HTMLElement)?.authorType ?? "user",
        renderHTML: () => ({}),
      },
      authorId: {
        default: "user",
        parseHTML: (element) =>
          readCriticChangeAttrs(element as HTMLElement)?.authorId ?? "user",
        renderHTML: (attributes) => ({
          "data-critic-change-by":
            attributes.authorType === "ai"
              ? "AI"
              : attributes.authorId || "user",
        }),
      },
      createdAt: {
        default: null,
        parseHTML: (element) =>
          readCriticChangeAttrs(element as HTMLElement)?.createdAt ?? null,
        renderHTML: (attributes) =>
          attributes.createdAt
            ? { "data-critic-change-at": attributes.createdAt }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-critic-change-kind]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: `critic-change critic-change-${HTMLAttributes["data-critic-change-kind"]}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCriticChange:
        (attributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      unsetCriticChange:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      acceptCriticChange:
        (changeId) =>
        ({ state, dispatch }) => {
          const markType = state.schema.marks.criticChange;
          if (!markType) return false;

          const ranges = collectCriticChangeRanges(state.doc, changeId);
          if (ranges.length === 0) return false;

          const tr = state.tr;

          for (const range of [...ranges].reverse()) {
            if (
              range.kind === "deletion" ||
              range.kind === "substitution-old"
            ) {
              tr.delete(range.from, range.to);
            } else {
              const sentinelPositions = findSuggestedParagraphSentinels(
                state.doc,
                range.from,
                range.to,
              );

              for (const position of [...sentinelPositions].reverse()) {
                tr.delete(
                  position,
                  position + SUGGESTED_PARAGRAPH_SENTINEL.length,
                );
              }

              const from = tr.mapping.map(range.from, -1);
              const to = tr.mapping.map(range.to, -1);
              tr.removeMark(from, to, markType);
            }
          }

          if (dispatch) dispatch(tr);
          return true;
        },
      rejectCriticChange:
        (changeId) =>
        ({ state, dispatch }) => {
          const markType = state.schema.marks.criticChange;
          if (!markType) return false;

          const ranges = collectCriticChangeRanges(state.doc, changeId);
          if (ranges.length === 0) return false;

          const tr = state.tr;

          for (const range of [...ranges].reverse()) {
            if (
              range.kind === "addition" ||
              range.kind === "substitution-new"
            ) {
              const sentinelPositions = findSuggestedParagraphSentinels(
                state.doc,
                range.from,
                range.to,
              );
              if (
                sentinelPositions.length > 0 &&
                isOnlyTextblockContent(state.doc, range.from, range.to)
              ) {
                const $from = state.doc.resolve(range.from);
                tr.delete($from.before(), $from.after());
              } else {
                tr.delete(range.from, range.to);
              }
            } else {
              tr.removeMark(range.from, range.to, markType);
            }
          }

          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});

interface CommentHighlightMeta {
  selectedCommentId: string | null;
  hoveredCommentId: string | null;
}

interface CommentHighlightPluginState extends CommentHighlightMeta {
  decorations: DecorationSet;
}

interface CriticChangeHighlightMeta {
  selectedChangeId: string | null;
  hoveredChangeId: string | null;
}

interface CriticChangeHighlightPluginState extends CriticChangeHighlightMeta {
  decorations: DecorationSet;
}

export const commentHighlightPluginKey =
  new PluginKey<CommentHighlightPluginState>("commentHighlight");
export const criticChangeHighlightPluginKey =
  new PluginKey<CriticChangeHighlightPluginState>("criticChangeHighlight");

function createCommentHighlightDecorations(
  doc: ProseMirrorNode,
  selectedCommentId: string | null,
  hoveredCommentId: string | null,
) {
  const commentMarkType = doc.type.schema.marks.commentRef;
  const changeMarkType = doc.type.schema.marks.criticChange;
  const decorations: Decoration[] = [];

  if (!commentMarkType) {
    return DecorationSet.create(doc, decorations);
  }

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (!node.isText) return;

    const commentIds = [
      ...new Set(
        node.marks.flatMap((mark: ProseMirrorMark) =>
          mark.type === commentMarkType && Array.isArray(mark.attrs.commentIds)
            ? mark.attrs.commentIds
            : [],
        ),
      ),
    ];

    if (commentIds.length === 0) return;

    const isSelected =
      !!selectedCommentId && commentIds.includes(selectedCommentId);
    const isHovered =
      !!hoveredCommentId && commentIds.includes(hoveredCommentId);
    const classNames = ["comment-decoration"];

    if (isSelected) {
      classNames.push("comment-decoration-active");
    } else if (isHovered) {
      classNames.push("comment-decoration-hovered");
    }

    if (
      changeMarkType &&
      node.marks.some((mark) => mark.type === changeMarkType)
    ) {
      classNames.push("comment-decoration-on-critic-change");
    }

    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, {
        class: classNames.join(" "),
        "data-testid": classNames.includes(
          "comment-decoration-on-critic-change",
        )
          ? "comment-decoration-on-critic-change"
          : "comment-decoration",
      }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

const CommentHighlight = Extension.create({
  name: "commentHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentHighlightPluginState>({
        key: commentHighlightPluginKey,
        state: {
          init: (_, state) => ({
            selectedCommentId: null,
            hoveredCommentId: null,
            decorations: createCommentHighlightDecorations(
              state.doc,
              null,
              null,
            ),
          }),
          apply: (tr, pluginState) => {
            const meta = tr.getMeta(commentHighlightPluginKey) as
              | CommentHighlightMeta
              | undefined;

            if (!meta && !tr.docChanged) {
              return pluginState;
            }

            const selectedCommentId =
              meta !== undefined
                ? meta.selectedCommentId
                : pluginState.selectedCommentId;
            const hoveredCommentId =
              meta !== undefined
                ? meta.hoveredCommentId
                : pluginState.hoveredCommentId;

            // No-op meta (selection state unchanged, doc unchanged): nothing to
            // recompute, so avoid the whole-document walk.
            if (
              !tr.docChanged &&
              selectedCommentId === pluginState.selectedCommentId &&
              hoveredCommentId === pluginState.hoveredCommentId
            ) {
              return pluginState;
            }

            return {
              selectedCommentId,
              hoveredCommentId,
              decorations: createCommentHighlightDecorations(
                tr.doc,
                selectedCommentId,
                hoveredCommentId,
              ),
            };
          },
        },
        props: {
          decorations: (state) =>
            commentHighlightPluginKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});

function createCriticChangeHighlightDecorations(
  doc: ProseMirrorNode,
  selectedChangeId: string | null,
  hoveredChangeId: string | null,
) {
  const changeMarkType = doc.type.schema.marks.criticChange;
  const decorations: Decoration[] = [];

  if (!changeMarkType) {
    return DecorationSet.create(doc, decorations);
  }

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (!node.isText) return;

    const changeIds = [
      ...new Set(
        node.marks.flatMap((mark: ProseMirrorMark) =>
          mark.type === changeMarkType &&
          typeof mark.attrs.changeId === "string"
            ? [mark.attrs.changeId]
            : [],
        ),
      ),
    ];

    if (changeIds.length === 0) return;

    const isSelected =
      !!selectedChangeId && changeIds.includes(selectedChangeId);
    const isHovered = !!hoveredChangeId && changeIds.includes(hoveredChangeId);

    if (!isSelected && !isHovered) return;

    const changeKind = node.marks.find(
      (mark) =>
        mark.type === changeMarkType &&
        typeof mark.attrs.changeId === "string" &&
        changeIds.includes(mark.attrs.changeId) &&
        isCriticChangeKind(mark.attrs.kind),
    )?.attrs.kind as CriticChangeKind | undefined;
    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, {
        "data-testid": isSelected
          ? "critic-change-decoration-active"
          : "critic-change-decoration-hovered",
        class: [
          isSelected
            ? "critic-change-decoration-active"
            : "critic-change-decoration-hovered",
          changeKind ? `critic-change-decoration-${changeKind}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

const CriticChangeHighlight = Extension.create({
  name: "criticChangeHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<CriticChangeHighlightPluginState>({
        key: criticChangeHighlightPluginKey,
        state: {
          init: (_, state) => ({
            selectedChangeId: null,
            hoveredChangeId: null,
            decorations: createCriticChangeHighlightDecorations(
              state.doc,
              null,
              null,
            ),
          }),
          apply: (tr, pluginState) => {
            const meta = tr.getMeta(criticChangeHighlightPluginKey) as
              | CriticChangeHighlightMeta
              | undefined;

            if (!meta && !tr.docChanged) {
              return pluginState;
            }

            const selectedChangeId =
              meta !== undefined
                ? meta.selectedChangeId
                : pluginState.selectedChangeId;
            const hoveredChangeId =
              meta !== undefined
                ? meta.hoveredChangeId
                : pluginState.hoveredChangeId;

            // No-op meta (selection state unchanged, doc unchanged): nothing to
            // recompute, so avoid the whole-document walk.
            if (
              !tr.docChanged &&
              selectedChangeId === pluginState.selectedChangeId &&
              hoveredChangeId === pluginState.hoveredChangeId
            ) {
              return pluginState;
            }

            // These decorations only ever cover the selected/hovered change, so
            // when neither is set the set is empty — skip the document walk
            // entirely (the common case while just editing).
            const decorations =
              selectedChangeId === null && hoveredChangeId === null
                ? DecorationSet.empty
                : createCriticChangeHighlightDecorations(
                    tr.doc,
                    selectedChangeId,
                    hoveredChangeId,
                  );

            return {
              selectedChangeId,
              hoveredChangeId,
              decorations,
            };
          },
        },
        props: {
          decorations: (state) =>
            criticChangeHighlightPluginKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});

const MarkdownLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
        renderHTML: (attributes) =>
          attributes.title ? { title: attributes.title } : {},
      },
      dataMarkdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src"),
        renderHTML: (attributes) =>
          attributes.dataMarkdownSrc
            ? { "data-markdown-src": attributes.dataMarkdownSrc }
            : {},
      },
      dataMarkdownAutolink: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-autolink"),
        renderHTML: (attributes) =>
          attributes.dataMarkdownAutolink
            ? { "data-markdown-autolink": attributes.dataMarkdownAutolink }
            : {},
      },
    };
  },
});

const MarkdownCode = Code.extend({
  excludes: "bold italic strike link",
});

// Languages rendered as diagrams elsewhere (MermaidOverlays etc.) — a "copy"
// button over a rendered diagram is noise, so skip it for these.
const DIAGRAM_LANGUAGES = new Set(["mermaid", "wardley", "cytoscape"]);

const MarkdownCodeBlock = CodeBlock.extend({
  marks: "commentRef criticChange",

  // A hover "Copy" button on each code block. The button lives in the editing
  // NodeView only (outside `contentDOM`), so it never appears in `getHTML()` /
  // the serialized markdown — copy/serialization behaviour is unchanged.
  addNodeView() {
    return ({ node }) => {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      const applyLanguageClass = (language: unknown) => {
        code.className =
          typeof language === "string" && language
            ? `language-${language}`
            : "";
      };
      applyLanguageClass(node.attrs.language);
      pre.appendChild(code);

      const isDiagram =
        typeof node.attrs.language === "string" &&
        DIAGRAM_LANGUAGES.has(node.attrs.language);

      if (!isDiagram) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "code-copy-btn";
        button.textContent = "Copy";
        button.setAttribute("contenteditable", "false");
        button.setAttribute("aria-label", "Copy code");
        // Don't let pressing the button move the editor selection or blur it.
        button.addEventListener("mousedown", (event) => event.preventDefault());
        let resetTimer: number | undefined;
        const flash = (label: string) => {
          button.textContent = label;
          window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(() => {
            button.textContent = "Copy";
          }, 1500);
        };
        button.addEventListener("click", () => {
          const text = code.textContent ?? "";
          void navigator.clipboard
            ?.writeText(text)
            .then(() => flash("Copied"))
            .catch(() => flash("Failed"));
        });
        pre.appendChild(button);
      }

      return {
        dom: pre,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type.name !== node.type.name) return false;
          applyLanguageClass(updatedNode.attrs.language);
          return true;
        },
      };
    };
  },
});

/**
 * Resolver the editor calls when an image's `src` fails to load — e.g. a
 * private-repo `raw.githubusercontent.com` URL that 404s without auth. Given the
 * original Markdown reference it returns a renderable URL (a `data:` URL with
 * the bytes fetched authenticated), or null if it can't be recovered.
 */
export type LoadAuthedImageSrc = (
  markdownSrc: string,
) => Promise<string | null>;

interface MarkdownImageOptions extends ImageOptions {
  loadAuthedImageSrc?: LoadAuthedImageSrc | null;
}

const MarkdownImage = Image.extend<MarkdownImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      loadAuthedImageSrc: null,
    } as MarkdownImageOptions;
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
        renderHTML: (attributes) =>
          attributes.title ? { title: attributes.title } : {},
      },
      dataMarkdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src"),
        renderHTML: (attributes) =>
          attributes.dataMarkdownSrc
            ? { "data-markdown-src": attributes.dataMarkdownSrc }
            : {},
      },
    };
  },

  // Render images through a NodeView so a failed load (private-repo raw URL,
  // expired link) can be retried via the authenticated resolver. We only swap
  // the DOM element's `src`; the node's attrs (and therefore the serialized
  // Markdown) keep the original reference, so nothing leaks a `data:` URL.
  addNodeView() {
    const loadAuthedImageSrc = this.options.loadAuthedImageSrc;
    return ({ node }) => {
      const img = document.createElement("img");
      let recovered = false;

      const apply = (attrs: Record<string, unknown>) => {
        const src = typeof attrs.src === "string" ? attrs.src : "";
        img.setAttribute("src", src);
        if (typeof attrs.alt === "string" && attrs.alt) img.alt = attrs.alt;
        else img.removeAttribute("alt");
        if (typeof attrs.title === "string" && attrs.title)
          img.title = attrs.title;
        else img.removeAttribute("title");
        const markdownSrc =
          typeof attrs.dataMarkdownSrc === "string"
            ? attrs.dataMarkdownSrc
            : "";
        if (markdownSrc) img.setAttribute("data-markdown-src", markdownSrc);
        else img.removeAttribute("data-markdown-src");
      };

      apply(node.attrs);

      img.addEventListener("error", () => {
        if (recovered || !loadAuthedImageSrc) return;
        recovered = true;
        const markdownSrc =
          (typeof node.attrs.dataMarkdownSrc === "string" &&
            node.attrs.dataMarkdownSrc) ||
          (typeof node.attrs.src === "string" && node.attrs.src) ||
          "";
        if (!markdownSrc) return;
        void loadAuthedImageSrc(markdownSrc).then((url) => {
          if (url) img.setAttribute("src", url);
        });
      });

      return {
        dom: img,
        update: (updatedNode) => {
          if (updatedNode.type.name !== node.type.name) return false;
          recovered = false;
          apply(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});

const RawMarkdownBlock = Node.create({
  name: "rawMarkdownBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      rawMarkdown: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute(rawMarkdownBlockAttribute) ?? "",
        renderHTML: (attributes) => ({
          [rawMarkdownBlockAttribute]: attributes.rawMarkdown ?? "",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[${rawMarkdownBlockAttribute}]`, priority: 1000 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes)];
  },
});

// Styles GitHub-style alert blockquotes (`> [!NOTE] …`) as callouts: a node
// decoration carries the type class (CSS does the icon/label/colours) and an
// inline decoration hides the literal `[!type]` marker. The blockquote node and
// its text are untouched, so the document still serialises to `> [!note] …`.
function createCalloutDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name !== "blockquote") return;

    const firstChild = node.firstChild;
    if (!firstChild || !firstChild.isTextblock) return;

    const marker = parseCalloutMarker(firstChild.textContent);
    if (!marker) return;

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `callout callout-${marker.type}`,
      }),
    );

    // The marker is the leading text of the first paragraph: blockquote at
    // `pos`, its paragraph at `pos+1`, the paragraph's content at `pos+2`.
    const markerFrom = pos + 2;
    decorations.push(
      Decoration.inline(markerFrom, markerFrom + marker.markerLength, {
        class: "callout-marker",
      }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

const Callout = Extension.create({
  name: "callout",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("callout"),
        props: {
          decorations: (state) => createCalloutDecorations(state.doc),
        },
      }),
    ];
  },
});

export function createEditorExtensions(
  placeholder: string,
  options?: { loadAuthedImageSrc?: LoadAuthedImageSrc | null },
) {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      code: false,
      codeBlock: false,
      link: false,
    }),
    Placeholder.configure({
      placeholder,
    }),
    MarkdownLink.configure({
      autolink: true,
      openOnClick: false,
      linkOnPaste: true,
    }),
    MarkdownCode,
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    CommentRef,
    CriticChange,
    RawMarkdownBlock,
    MarkdownCodeBlock,
    CommentHighlight,
    CriticChangeHighlight,
    Callout,
    MarkdownImage.configure({
      allowBase64: true,
      inline: false,
      loadAuthedImageSrc: options?.loadAuthedImageSrc ?? null,
    }),
  ];
}
