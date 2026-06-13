import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  type DocumentEditorViewMode,
  getDocumentEditorViewModeFromLocation,
} from "./app-navigation";
import { createDocumentSessionStore } from "./document-session";
import { PreviewBackend } from "./preview-backend";
import type { CompleteReviewOptions, Page } from "./storage";

const DocumentWorkspace = lazy(() =>
  import("./DocumentWorkspace").then((module) => ({
    default: module.DocumentWorkspace,
  })),
);

const PREVIEW_DOCUMENT_PATH = "preview.md";
const PREVIEW_INITIAL_MARKDOWN = [
  "# Live Preview",
  "",
  "This draft only lives in memory. Edit it freely, switch between rich text and code view, and reload the page when you want a clean copy.",
  "",
  "- Comments and suggested changes use Roughdraft flavored Markdown.",
  "- Autosave updates the in-memory document, not disk or browser storage.",
  "",
  "> [!NOTE] Callouts use GitHub alert syntax and render with an icon, label, and tint.",
  "",
  "> [!WARNING] Edits commit straight to GitHub — there's no undo once you commit.",
  "",
  "{==Select this sentence==}{>>Try replying to this comment or suggesting a replacement.<<}{#preview-comment}",
  "",
  "These next two lines sit close together so their {==margin comments==}{>>This is the second comment — close to the third.<<}{#preview-comment-2} have to stack, the way a real review doc {==crowds its notes==}{>>And a third, crowding the second so the rail must avoid overlap.<<}{#preview-comment-3} together.",
  "",
  "---",
  "comments:",
  "  preview-comment:",
  "    by: Roughdraft",
  '    at: "2026-04-28T12:00:00.000Z"',
  "  preview-comment-2:",
  "    by: Roughdraft",
  '    at: "2026-04-28T12:00:00.000Z"',
  "  preview-comment-3:",
  "    by: Roughdraft",
  '    at: "2026-04-28T12:00:00.000Z"',
  "",
].join("\n");

function createPreviewPage(): Page {
  return {
    id: "preview",
    title: "Live Preview",
    content: PREVIEW_INITIAL_MARKDOWN,
    version: "memory:initial",
  };
}

export function PreviewPage() {
  const [backend] = useState(() => new PreviewBackend(createPreviewPage()));
  const [previewPage, setPreviewPage] = useState<Page>(() =>
    backend.getCurrentPage(),
  );
  const [previewForceResetKey, setPreviewForceResetKey] = useState<
    string | null
  >(null);
  const [editorViewMode, setEditorViewMode] = useState<DocumentEditorViewMode>(
    () => getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const [documentSession] = useState(() => createDocumentSessionStore());

  useEffect(() => () => backend.dispose(), [backend]);

  useEffect(() => {
    document.title = "Roughdraft Preview";
  }, []);

  const handleSaveDocument = useCallback(
    async (_id: string, content: string) => {
      const savedPage = await backend.saveMarkdownFile(
        PREVIEW_DOCUMENT_PATH,
        content,
      );
      setPreviewPage(savedPage);
    },
    [backend],
  );

  const handleResetPreview = useCallback(async () => {
    const freshBackendPage = createPreviewPage();
    const savedPage = await backend.saveMarkdownFile(
      PREVIEW_DOCUMENT_PATH,
      freshBackendPage.content,
    );
    setPreviewPage(savedPage);
    setPreviewForceResetKey(`preview-reset:${Date.now()}`);
  }, [backend]);

  const handleCompletePreviewReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      return backend.completeReview
        ? backend.completeReview(PREVIEW_DOCUMENT_PATH, options)
        : { delivered: false };
    },
    [backend],
  );

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      <Suspense fallback={null}>
        <DocumentWorkspace
          documentPage={previewPage}
          activeDocumentPath={PREVIEW_DOCUMENT_PATH}
          documentFilenameLabel={PREVIEW_DOCUMENT_PATH}
          documentEditorViewMode={editorViewMode}
          onDocumentEditorViewModeChange={setEditorViewMode}
          onSaveDocument={handleSaveDocument}
          documentSession={documentSession}
          documentDiskChangeState="clean"
          documentForceResetKey={previewForceResetKey}
          onReloadDocumentFromDisk={handleResetPreview}
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={() => {}}
          onCompleteReview={handleCompletePreviewReview}
          backend={backend}
        />
      </Suspense>
    </main>
  );
}
