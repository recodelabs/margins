import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  buildLocationForDocumentEditorViewMode,
  type DocumentEditorViewMode,
  formatWorkspacePathForDisplay,
  getDocumentEditorViewModeFromLocation,
  getPathLeaf,
  getRequestedPathState,
  joinPath,
  PREVIEW_PATH,
  ROUGHDRAFT_FLAVORED_MARKDOWN_PATH,
  syncRequestedPathInUrl,
} from "./app-navigation";
import { DocumentLoadError } from "./DocumentLoadError";
import type { GitHubDocNav } from "./DocumentWorkspace";
import { createDocumentSessionStore } from "./document-session";
import { detectBackend, isGitHubMode } from "./detect-backend";
import { GitHubPicker } from "./GitHubPicker";
import { Homepage, HomepageSubtitle } from "./Homepage";
import { getStoredToken } from "./github-auth";
import {
  isMarkdownPath,
  parseGitHubLocation,
} from "./github-route";
import type { DocumentSaveState } from "./PageCard";
import { PreviewPage } from "./PreviewPage";
import { RoughdraftFlavoredMarkdownPage } from "./RoughdraftFlavoredMarkdownPage";
import { runWithErrorFeedback } from "./run-with-error-feedback";
import {
  type CompleteReviewOptions,
  FileTooLargeError,
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "./storage";
import { UpdateNotice } from "./UpdateNotice";
import { fetchUpdateStatus, type UpdateStatus } from "./update-status";

// The editor workspace pulls in the heavy editor stack (TipTap, Turndown,
// CodeMirror). Load it lazily so the login screen and picker don't pay for the
// full bundle up front (see PERF-2).
const DocumentWorkspace = lazy(() =>
  import("./DocumentWorkspace").then((module) => ({
    default: module.DocumentWorkspace,
  })),
);

export type DocumentDiskChangeState =
  | "clean"
  | "changed"
  | "conflict"
  | "paused";

export function shouldWarnBeforeUnload({
  activeDocumentPath,
  isDirty,
  saveState,
  diskChangeState,
}: {
  activeDocumentPath: string | null;
  isDirty: boolean;
  saveState: DocumentSaveState;
  diskChangeState: DocumentDiskChangeState;
}) {
  return (
    !!activeDocumentPath &&
    (isDirty ||
      saveState === "saving" ||
      saveState === "unsaved" ||
      saveState === "error" ||
      diskChangeState !== "clean")
  );
}

export function App() {
  const initialRequestedPathState = getRequestedPathState();
  const [requestedPathState] = useState(initialRequestedPathState);
  const isRoughdraftFlavoredMarkdownRoute =
    window.location.pathname === ROUGHDRAFT_FLAVORED_MARKDOWN_PATH;
  const isPreviewRoute = window.location.pathname === PREVIEW_PATH;
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    initialRequestedPathState.documentPath,
  );
  const [documentSession] = useState(() => createDocumentSessionStore());
  const [documentDiskChangeState, setDocumentDiskChangeState] =
    useState<DocumentDiskChangeState>("clean");
  const [documentForceResetKey, setDocumentForceResetKey] = useState<
    string | null
  >(null);
  const [documentActionError, setDocumentActionError] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [documentEditorViewMode, setDocumentEditorViewMode] = useState(() =>
    getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const backendRef = useRef<StorageBackend | null>(null);
  const documentPageRef = useRef<Page | null>(null);
  const activeDocumentPathRef = useRef<string | null>(activeDocumentPath);

  backendRef.current = backend;
  documentPageRef.current = documentPage;
  activeDocumentPathRef.current = activeDocumentPath;

  const applyDocumentPage = useCallback(
    (nextDocument: Page) => {
      setDocumentPage(nextDocument);
      documentSession.setDraftContent(nextDocument.content);
    },
    [documentSession],
  );

  const loadDocument = useCallback(
    async (nextBackend: StorageBackend, relativePath: string) => {
      const nextDocument = await nextBackend.getMarkdownFile(relativePath);
      applyDocumentPage(nextDocument);
      setActiveDocumentPath(relativePath);
      documentSession.setDirty(false);
      setDocumentDiskChangeState("clean");
      return nextDocument;
    },
    [applyDocumentPage, documentSession],
  );

  useEffect(() => {
    let cancelled = false;

    const loadUpdateStatus = async () => {
      const nextUpdateStatus = await fetchUpdateStatus();
      if (!cancelled) {
        setUpdateStatus(nextUpdateStatus);
      }
    };

    void loadUpdateStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isGitHubMode()) return;
    const sourceUrl = new URL("/api/open-requests", window.location.origin);
    if (requestedPathState.rawPath) {
      sourceUrl.searchParams.set("path", requestedPathState.rawPath);
    }

    const source = new EventSource(`${sourceUrl.pathname}${sourceUrl.search}`);
    const handleOpenRequest = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          url?: unknown;
        };
        if (typeof payload.url !== "string" || !payload.url.trim()) return;

        const nextUrl = new URL(payload.url, window.location.origin);
        window.focus();
        if (nextUrl.href !== window.location.href) {
          window.location.assign(nextUrl.href);
        }
      } catch (error) {
        console.error("Failed to handle Roughdraft open request:", error);
      }
    };

    source.addEventListener("open-request", handleOpenRequest);

    return () => {
      source.removeEventListener("open-request", handleOpenRequest);
      source.close();
    };
  }, [requestedPathState.rawPath]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setLoadError(null);
      setDocumentPage(null);

      try {
        const detectedBackend = await detectBackend();
        if (cancelled) return;

        setBackend(detectedBackend);

        if (detectedBackend.capabilities.documentPath) {
          const documentPath = detectedBackend.documentPath?.() || "remote.md";
          await loadDocument(detectedBackend, documentPath);
          if (cancelled) return;
          setLoading(false);
          return;
        }

        if (!requestedPathState.rawPath) {
          setActiveDocumentPath(null);
          setLoading(false);
          return;
        }

        if (!isGitHubMode()) {
          syncRequestedPathInUrl(requestedPathState.rawPath);
        }

        if (
          !requestedPathState.projectPath ||
          !requestedPathState.documentPath
        ) {
          setActiveDocumentPath(null);
          setLoadError("Roughdraft now opens one .md file at a time.");
          setLoading(false);
          return;
        }

        if (detectedBackend.canManageProjects) {
          await detectedBackend.openProject(requestedPathState.projectPath);
        }

        if (cancelled) return;

        const docPath = isGitHubMode()
          ? parseGitHubLocation().path
          : requestedPathState.documentPath;
        await loadDocument(detectedBackend, docPath);
        if (cancelled) return;

        setLoading(false);
      } catch (error) {
        if (cancelled) return;

        console.error("Failed to open markdown file:", error);
        setActiveDocumentPath(null);
        setLoadError(
          error instanceof FileTooLargeError
            ? error.message
            : "Could not open that markdown file.",
        );
        setLoading(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [
    loadDocument,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  useEffect(() => {
    const workspaceTitlePath = activeDocumentPath
      ? formatWorkspacePathForDisplay(
          backend?.info.projectPath
            ? joinPath(backend.info.projectPath, activeDocumentPath)
            : requestedPathState.rawPath,
        )
      : null;

    document.title = isPreviewRoute
      ? "Roughdraft Preview"
      : isRoughdraftFlavoredMarkdownRoute
        ? "Roughdraft Flavored Markdown"
        : workspaceTitlePath
          ? `${workspaceTitlePath} · margins`
          : "margins";
  }, [
    activeDocumentPath,
    backend,
    isRoughdraftFlavoredMarkdownRoute,
    isPreviewRoute,
    requestedPathState.rawPath,
  ]);

  const handleSaveDocument = useCallback(
    async (id: string, content: string) => {
      if (!activeDocumentPath) return;
      const expectedVersion =
        documentPageRef.current?.id === id
          ? documentPageRef.current.version
          : undefined;

      const backend = backendRef.current;
      if (!backend) return;

      let savedDocument: Page;
      try {
        savedDocument = await backend.saveMarkdownFile(
          activeDocumentPath,
          content,
          expectedVersion,
        );
      } catch (error) {
        if (error instanceof MarkdownFileConflictError) {
          setDocumentDiskChangeState("conflict");
        }
        throw error;
      }

      applyDocumentPage(savedDocument);
      documentSession.setDirty(false);
      setDocumentDiskChangeState("clean");
    },
    [activeDocumentPath, applyDocumentPage, documentSession],
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const session = documentSession.getSnapshot();
      if (
        !shouldWarnBeforeUnload({
          activeDocumentPath: activeDocumentPathRef.current,
          isDirty: session.dirty,
          saveState: session.saveState,
          diskChangeState: documentDiskChangeState,
        })
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [documentDiskChangeState, documentSession]);

  const handleReloadDocumentFromDisk = useCallback(
    () =>
      runWithErrorFeedback(
        async () => {
          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          if (!currentBackend || !currentPath) return;

          setDocumentActionError(null);
          const nextDocument = await currentBackend.getMarkdownFile(currentPath);
          applyDocumentPage(nextDocument);
          documentSession.setDirty(false);
          setDocumentDiskChangeState("clean");
          setDocumentForceResetKey(
            `${currentPath}:${nextDocument.version ?? Date.now()}`,
          );
        },
        setDocumentActionError,
        "Could not reload the file from disk.",
      ),
    [applyDocumentPage, documentSession],
  );

  const handleKeepEditingWithoutAutosave = useCallback(() => {
    setDocumentDiskChangeState("paused");
  }, []);

  const handleOverwriteDocumentOnDisk = useCallback(
    () =>
      runWithErrorFeedback(
        async () => {
          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          const currentDocument = documentPageRef.current;
          if (!currentBackend || !currentPath || !currentDocument) return;

          setDocumentActionError(null);
          const content =
            documentSession.getSnapshot().draftContent ??
            currentDocument.content;
          const savedDocument = await currentBackend.saveMarkdownFile(
            currentPath,
            content,
          );

          applyDocumentPage(savedDocument);
          documentSession.setDirty(false);
          documentSession.setSaveState("saved");
          setDocumentDiskChangeState("clean");
          setDocumentForceResetKey(
            `${currentPath}:${savedDocument.version ?? Date.now()}:overwrite`,
          );
        },
        setDocumentActionError,
        "Could not overwrite the file on disk.",
      ),
    [applyDocumentPage, documentSession],
  );

  const handleCompleteReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      const currentBackend = backendRef.current;
      const currentPath = activeDocumentPathRef.current;
      const currentDocument = documentPageRef.current;
      if (!currentBackend || !currentPath || !currentDocument) {
        return { delivered: false };
      }

      const content =
        documentSession.getSnapshot().draftContent ?? currentDocument.content;
      const expectedVersion = currentDocument.version;

      const savedDocument = await currentBackend.saveMarkdownFile(
        currentPath,
        content,
        expectedVersion,
      );

      applyDocumentPage(savedDocument);
      documentSession.setDirty(false);
      setDocumentDiskChangeState("clean");

      return currentBackend.completeReview
        ? currentBackend.completeReview(currentPath, options)
        : { delivered: false };
    },
    [applyDocumentPage, documentSession],
  );

  useEffect(() => {
    if (!backend?.watchMarkdownFile || !activeDocumentPath) return;

    let disposed = false;
    const stopWatching = backend.watchMarkdownFile(
      activeDocumentPath,
      (event) => {
        if (disposed || event.path !== activeDocumentPath) return;

        const currentDocument = documentPageRef.current;
        if (event.version && currentDocument?.version === event.version) {
          return;
        }

        if (!event.exists) {
          setDocumentDiskChangeState("changed");
          return;
        }

        if (documentDiskChangeState === "paused") {
          return;
        }

        if (documentSession.getSnapshot().dirty) {
          setDocumentDiskChangeState("changed");
          return;
        }

        void (async () => {
          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          if (!currentBackend || !currentPath || disposed) return;

          try {
            const nextDocument =
              await currentBackend.getMarkdownFile(currentPath);
            if (disposed) return;
            applyDocumentPage(nextDocument);
            setDocumentDiskChangeState("clean");
          } catch (error) {
            console.error("Failed to reload changed markdown file:", error);
          }
        })();
      },
    );

    return () => {
      disposed = true;
      stopWatching();
    };
  }, [
    activeDocumentPath,
    applyDocumentPage,
    backend,
    documentDiskChangeState,
    documentSession,
  ]);

  const handleDocumentEditorViewModeChange = useCallback(
    (nextMode: DocumentEditorViewMode) => {
      setDocumentEditorViewMode((current) => {
        if (nextMode === current) return current;
        window.history.replaceState(
          null,
          "",
          buildLocationForDocumentEditorViewMode(nextMode),
        );
        return nextMode;
      });
    },
    [],
  );

  if (loading) {
    return (
      <div
        className="h-screen bg-[#FCFCFC] dark:bg-background"
        aria-hidden="true"
      />
    );
  }

  if (isRoughdraftFlavoredMarkdownRoute) {
    return <RoughdraftFlavoredMarkdownPage />;
  }

  if (isPreviewRoute) {
    return <PreviewPage />;
  }

  if (isGitHubMode()) {
    const loc = parseGitHubLocation();
    const hasToken = !!getStoredToken();
    if (!hasToken || !loc.owner || !loc.repo || !isMarkdownPath(loc.path)) {
      return <GitHubPicker />;
    }
  }

  if (loadError) {
    return <DocumentLoadError message={loadError} />;
  }

  if (!requestedPathState.rawPath) {
    return (
      <Homepage message={<HomepageSubtitle />} updateStatus={updateStatus} />
    );
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const documentFilenameLabel =
    getPathLeaf(documentAbsolutePath ?? activeDocumentPath) ?? "Untitled.md";

  // Build githubNav when in GitHub mode and a markdown file path is in the URL
  const githubNav: GitHubDocNav | null = (() => {
    if (!isGitHubMode()) return null;
    const loc = parseGitHubLocation();
    if (!loc.owner || !loc.repo || !isMarkdownPath(loc.path)) return null;
    return { owner: loc.owner, repo: loc.repo, branch: loc.branch, path: loc.path };
  })();

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      {updateStatus ? (
        <div className="pointer-events-none absolute top-4 right-4 z-40 max-w-sm">
          <div className="pointer-events-auto">
            <UpdateNotice updateStatus={updateStatus} />
          </div>
        </div>
      ) : null}
      <Suspense fallback={null}>
        <DocumentWorkspace
          documentPage={documentPage}
          activeDocumentPath={activeDocumentPath}
          documentFilenameLabel={documentFilenameLabel}
          documentEditorViewMode={documentEditorViewMode}
          onDocumentEditorViewModeChange={handleDocumentEditorViewModeChange}
          onSaveDocument={handleSaveDocument}
          documentSession={documentSession}
          documentDiskChangeState={documentDiskChangeState}
          documentForceResetKey={documentForceResetKey}
          documentActionError={documentActionError}
          onDismissDocumentActionError={() => setDocumentActionError(null)}
          onReloadDocumentFromDisk={handleReloadDocumentFromDisk}
          onKeepEditingWithoutAutosave={handleKeepEditingWithoutAutosave}
          onOverwriteDocumentOnDisk={handleOverwriteDocumentOnDisk}
          onCompleteReview={handleCompleteReview}
          backend={backend}
          manualCommit={backend?.capabilities.manualCommit ?? false}
          githubNav={githubNav}
        />
      </Suspense>
    </main>
  );
}
