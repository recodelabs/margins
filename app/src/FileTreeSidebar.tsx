import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { GitHubDocNav } from "./DocumentWorkspace";
import { isMarkdownPath } from "./file-types";
import { gitHubHref } from "./github-route";
import {
  buildTree,
  type FileMeta,
  splitPath,
  type TreeNode,
} from "./github-tree";
import { cn } from "./lib/utils";
import {
  readPinnedFiles,
  readRecentFiles,
  recordRecentFile,
  repoKey,
  togglePinnedFile,
} from "./recent-files";
import { handleSessionExpiry } from "./session-expiry";
import {
  readStoredSidebarCollapsed,
  writeStoredSidebarCollapsed,
} from "./sidebar-visibility";
import type { StorageBackend } from "./storage";

interface FileTreeSidebarProps {
  backend: StorageBackend | null;
  /** Current GitHub location; the open file is highlighted and auto-revealed. */
  githubNav: GitHubDocNav | null;
  /**
   * SPA-navigate to `href` (the App owns the unsaved-changes guard, so this can
   * be a no-op if the user cancels a switch).
   */
  onNavigate: (href: string) => void;
}

const leafName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const parentDir = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/**
 * Persistent, collapsible file-tree sidebar for the workspace. Lets a reader
 * switch files without returning to the picker, with quick-access Pinned and
 * Recent sections. GitHub-mode only: it relies on the backend's recursive
 * `listMarkdownPaths`, which other backends don't provide — so it renders
 * nothing outside GitHub mode.
 */
export function FileTreeSidebar({
  backend,
  githubNav,
  onNavigate,
}: FileTreeSidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(
    readStoredSidebarCollapsed,
  );
  const collapsedHydratedRef = useRef(false);
  useEffect(() => {
    // Skip the initial render so merely mounting doesn't write to localStorage.
    if (!collapsedHydratedRef.current) {
      collapsedHydratedRef.current = true;
      return;
    }
    writeStoredSidebarCollapsed(collapsed);
  }, [collapsed]);

  const [allPaths, setAllPaths] = useState<FileMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [recent, setRecent] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);

  // GitHub-only: gate on the recursive listing the sidebar needs.
  const isGitHub =
    backend?.info.kind === "github" &&
    typeof backend.listMarkdownPaths === "function";
  const owner = githubNav?.owner ?? "";
  const repo = githubNav?.repo ?? "";
  const branch = githubNav?.branch ?? "main";
  const currentPath = githubNav?.path ?? "";
  const key = isGitHub && owner && repo ? repoKey(owner, repo) : "";

  // Fetch the flat path list whenever the repo/branch changes. The GitHub
  // ETag cache makes a repeat of the picker's listing come back 304.
  const fetchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!isGitHub || !backend?.listMarkdownPaths || !owner || !repo) {
      setAllPaths(null);
      return;
    }
    fetchAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    fetchAbortRef.current = abortCtrl;

    setLoading(true);
    setError(null);
    backend
      .listMarkdownPaths()
      .then((paths) => {
        if (abortCtrl.signal.aborted) return;
        setAllPaths(paths);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (abortCtrl.signal.aborted) return;
        if (handleSessionExpiry(e)) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      abortCtrl.abort();
    };
    // The backend is re-detected per repo+branch, so `listMarkdownPaths`'
    // identity changes whenever the repo or branch does — driving a refetch.
  }, [isGitHub, owner, repo, backend?.listMarkdownPaths]);

  // Load this repo's stored Recent / Pinned shortcuts.
  useEffect(() => {
    if (!key) {
      setRecent([]);
      setPinned([]);
      return;
    }
    setRecent(readRecentFiles(key));
    setPinned(readPinnedFiles(key));
  }, [key]);

  // Record the open file as recent and reveal its folder in the tree.
  useEffect(() => {
    if (!key || !currentPath) return;
    setRecent(recordRecentFile(key, currentPath));
    const ancestors = splitPath(parentDir(currentPath)).map((s) => s.path);
    if (ancestors.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const a of ancestors) next.add(a);
        return next;
      });
    }
  }, [key, currentPath]);

  const tree = useMemo(() => (allPaths ? buildTree(allPaths) : []), [allPaths]);
  const knownPaths = useMemo(
    () => new Set((allPaths ?? []).map((f) => f.path)),
    [allPaths],
  );

  const openPath = (path: string) => {
    onNavigate(gitHubHref({ owner, repo, branch, path }));
  };
  const toggleFolder = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const onTogglePin = (path: string) => {
    if (!key) return;
    setPinned(togglePinnedFile(key, path));
  };

  if (!isGitHub || !githubNav) return null;

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-slate-200 dark:border-slate-800 bg-[#FCFCFC] dark:bg-background py-2">
        <button
          type="button"
          data-testid="file-tree-expand"
          aria-label="Show file sidebar"
          title="Show files"
          className="inline-flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-black/[0.04] hover:text-slate-900 dark:text-stone-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100"
          onClick={() => setCollapsed(false)}
        >
          <PanelLeftOpen className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  // Pinned / recent shortcuts, filtered to files that still exist in the repo.
  const pinnedExisting = pinned.filter((p) => knownPaths.has(p));
  const pinnedSet = new Set(pinnedExisting);
  const recentExisting = recent.filter(
    (p) => knownPaths.has(p) && !pinnedSet.has(p),
  );

  return (
    <aside
      data-testid="file-tree-sidebar"
      aria-label="File sidebar"
      className="flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-[#FCFCFC] dark:bg-background"
    >
      {/* Header */}
      <div className="flex items-center gap-1 px-2.5 py-2 border-b border-slate-100 dark:border-slate-800">
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-300"
          title={`${owner}/${repo}`}
        >
          {repo}
        </span>
        <button
          type="button"
          data-testid="file-tree-collapse"
          aria-label="Hide file sidebar"
          title="Hide files"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-black/[0.04] hover:text-slate-900 dark:text-stone-500 dark:hover:bg-white/[0.06] dark:hover:text-slate-100"
          onClick={() => setCollapsed(true)}
        >
          <PanelLeftClose className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {error ? (
          <p className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}

        {/* Pinned */}
        {pinnedExisting.length > 0 ? (
          <ShortcutSection
            testid="file-tree-pinned"
            icon={<Pin className="size-3" aria-hidden="true" />}
            label="Pinned"
          >
            {pinnedExisting.map((path) => (
              <ShortcutRow
                key={path}
                path={path}
                active={path === currentPath}
                pinned
                onOpen={openPath}
                onTogglePin={onTogglePin}
              />
            ))}
          </ShortcutSection>
        ) : null}

        {/* Recent */}
        {recentExisting.length > 0 ? (
          <ShortcutSection
            testid="file-tree-recent"
            icon={<Clock className="size-3" aria-hidden="true" />}
            label="Recent"
          >
            {recentExisting.map((path) => (
              <ShortcutRow
                key={path}
                path={path}
                active={path === currentPath}
                pinned={false}
                onOpen={openPath}
                onTogglePin={onTogglePin}
              />
            ))}
          </ShortcutSection>
        ) : null}

        {/* Full tree */}
        <div className="mt-1">
          {(pinnedExisting.length > 0 || recentExisting.length > 0) && (
            <div className="px-3 pt-2 pb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Files
            </div>
          )}
          {loading && !allPaths ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Loading files…
            </div>
          ) : tree.length === 0 ? (
            <p className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
              No files.
            </p>
          ) : (
            <ul className="list-none">
              {tree.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  currentPath={currentPath}
                  expanded={expanded}
                  pinnedSet={pinnedSet}
                  onOpen={openPath}
                  onToggleFolder={toggleFolder}
                  onTogglePin={onTogglePin}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

function ShortcutSection({
  testid,
  icon,
  label,
  children,
}: {
  testid: string;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testid}>
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {icon}
        {label}
      </div>
      <ul className="list-none">{children}</ul>
    </div>
  );
}

function ShortcutRow({
  path,
  active,
  pinned,
  onOpen,
  onTogglePin,
}: {
  path: string;
  active: boolean;
  pinned: boolean;
  onOpen: (path: string) => void;
  onTogglePin: (path: string) => void;
}) {
  return (
    <li className="group/row relative">
      <button
        type="button"
        data-testid="file-tree-file"
        data-active={active || undefined}
        title={path}
        onClick={() => onOpen(path)}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 pl-3 pr-7 text-left text-xs transition-colors",
          active
            ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
            : "text-stone-600 hover:bg-black/[0.04] dark:text-stone-300 dark:hover:bg-white/[0.05]",
        )}
      >
        <FileText
          className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{leafName(path)}</span>
      </button>
      <PinButton path={path} pinned={pinned} onTogglePin={onTogglePin} />
    </li>
  );
}

function PinButton({
  path,
  pinned,
  onTogglePin,
}: {
  path: string;
  pinned: boolean;
  onTogglePin: (path: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid="file-tree-pin"
      aria-label={pinned ? "Unpin file" : "Pin file"}
      aria-pressed={pinned}
      title={pinned ? "Unpin" : "Pin"}
      onClick={(e) => {
        e.stopPropagation();
        onTogglePin(path);
      }}
      className={cn(
        "absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-stone-400 hover:text-slate-900 dark:hover:text-slate-100",
        pinned
          ? "text-blue-500 dark:text-blue-300"
          : "opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100",
      )}
    >
      <Pin
        className={cn("size-3", pinned && "fill-current")}
        aria-hidden="true"
      />
    </button>
  );
}

function TreeRow({
  node,
  depth,
  currentPath,
  expanded,
  pinnedSet,
  onOpen,
  onToggleFolder,
  onTogglePin,
}: {
  node: TreeNode;
  depth: number;
  currentPath: string;
  expanded: Set<string>;
  pinnedSet: Set<string>;
  onOpen: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onTogglePin: (path: string) => void;
}) {
  // 0.75rem base + 0.7rem per depth level for the indent guide.
  const indent = { paddingLeft: `${0.5 + depth * 0.7}rem` };

  if (node.kind === "folder") {
    const isOpen = expanded.has(node.path);
    return (
      <li>
        <button
          type="button"
          data-testid="file-tree-folder"
          data-expanded={isOpen || undefined}
          onClick={() => onToggleFolder(node.path)}
          style={indent}
          className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs font-medium text-stone-600 transition-colors hover:bg-black/[0.04] dark:text-stone-300 dark:hover:bg-white/[0.05]"
        >
          {isOpen ? (
            <ChevronDown
              className="size-3 shrink-0 text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="size-3 shrink-0 text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
          )}
          {isOpen ? (
            <FolderOpen
              className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
          ) : (
            <Folder
              className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
        {isOpen ? (
          <ul className="list-none">
            {node.children.map((child) => (
              <TreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                currentPath={currentPath}
                expanded={expanded}
                pinnedSet={pinnedSet}
                onOpen={onOpen}
                onToggleFolder={onToggleFolder}
                onTogglePin={onTogglePin}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const active = node.path === currentPath;
  return (
    <li className="group/row relative">
      <button
        type="button"
        data-testid="file-tree-file"
        data-active={active || undefined}
        title={node.path}
        onClick={() => onOpen(node.path)}
        style={indent}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 pr-7 text-left text-xs transition-colors",
          active
            ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
            : isMarkdownPath(node.name)
              ? "text-stone-700 hover:bg-black/[0.04] dark:text-stone-200 dark:hover:bg-white/[0.05]"
              : "text-stone-500 hover:bg-black/[0.04] dark:text-stone-400 dark:hover:bg-white/[0.05]",
        )}
      >
        <FileText
          className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      <PinButton
        path={node.path}
        pinned={pinnedSet.has(node.path)}
        onTogglePin={onTogglePin}
      />
    </li>
  );
}
