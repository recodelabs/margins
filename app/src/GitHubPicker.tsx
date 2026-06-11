import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, Folder, Loader2 } from "lucide-react";
import { login, getStoredToken, clearToken } from "./github-auth";
import { GitHubBackend } from "./github-backend";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import { getFolderContents, splitPath } from "./github-tree";
import {
  gitHubHref,
  isMarkdownPath,
  parseGitHubLocation,
} from "./github-route";

// ---------------------------------------------------------------------------
// GitHub mark SVG (inline, no external dependency)
// ---------------------------------------------------------------------------
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="currentColor"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared logo treatment
// ---------------------------------------------------------------------------
function MarginsLogo() {
  return (
    <p className="font-nanum-pen-script text-[clamp(2.75rem,2.2rem+1.4vw,3.5rem)] leading-none text-[#1e3a6b] dark:text-[#a8c4ef]">
      margins
    </p>
  );
}

// ---------------------------------------------------------------------------
// Login screen (no token stored)
// ---------------------------------------------------------------------------
function LoginScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FCFCFC] dark:bg-background px-6 py-12 text-center text-slate-950 dark:text-slate-50">
      <div className="flex w-full max-w-xl flex-col items-center">
        <img
          src="/margins.svg"
          alt="margins"
          className="w-[clamp(16rem,52vw,28rem)] select-none dark:invert"
          draggable={false}
        />
        <h1 className="font-nanum-pen-script mt-6 text-[clamp(3.25rem,2.6rem+3vw,5rem)] leading-[0.95] text-[#1e3a6b] dark:text-[#a8c4ef]">
          Review your repo's markdown
        </h1>
        <p className="mt-5 max-w-md text-[clamp(1.05rem,1rem+0.3vw,1.2rem)] leading-relaxed text-slate-600 dark:text-slate-400">
          Browse, open, and annotate any{" "}
          <span className="rounded-sm bg-[#fff5c7] px-1 font-medium text-slate-950 dark:bg-amber-500/35 dark:text-slate-50">
            .md file
          </span>{" "}
          in a GitHub repository — right in your browser.
        </p>
        <Button
          className="mt-9 h-14 cursor-pointer gap-2.5 rounded-xl px-7 text-lg shadow-[0_12px_32px_rgba(0,0,0,0.16)] transition-transform hover:-translate-y-0.5"
          size="lg"
          onClick={login}
        >
          <GitHubMark className="size-5" />
          Continue with GitHub
        </Button>
        <p className="mt-6 max-w-md text-sm leading-relaxed text-stone-500 dark:text-stone-400">
          First time?{" "}
          <a
            href="https://github.com/apps/margins-md"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-700 underline decoration-stone-300 underline-offset-2 hover:text-slate-900 dark:text-slate-300 dark:decoration-stone-600 dark:hover:text-slate-100"
          >
            Install the margins app
          </a>{" "}
          on the repos you want to review — pick your account, choose
          repositories, then come back and sign in.
        </p>
        <p className="mt-8 text-xs font-medium tracking-wide text-stone-400 dark:text-stone-500">
          Free &amp; open source · your edits commit straight to GitHub ·{" "}
          <a
            href="https://github.com/recodelabs/roughneck"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-stone-300 underline-offset-2 hover:text-slate-700 dark:decoration-stone-600 dark:hover:text-slate-300"
          >
            GitHub
          </a>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repo browser (token present)
// ---------------------------------------------------------------------------

/** Read the current folder from the path-based URL. */
function getDirFromUrl(): string {
  const loc = parseGitHubLocation();
  // If the path looks like a markdown file (shouldn't happen in picker mode,
  // but guard anyway), treat the parent as the current folder.
  if (isMarkdownPath(loc.path)) {
    const lastSlash = loc.path.lastIndexOf("/");
    return lastSlash >= 0 ? loc.path.slice(0, lastSlash) : "";
  }
  return loc.path;
}

export function GitHubPicker() {
  const token = getStoredToken();
  const initialLoc = parseGitHubLocation();

  const logout = () => {
    clearToken();
    window.location.assign("/");
  };

  const [repo, setRepo] = useState(
    initialLoc.owner && initialLoc.repo
      ? `${initialLoc.owner}/${initialLoc.repo}`
      : "",
  );
  const [ref, setRef] = useState(initialLoc.branch || "main");
  const [currentDir, setCurrentDir] = useState(() => getDirFromUrl());
  const [allPaths, setAllPaths] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for browser Back/Forward so path-based dir stays in sync
  useEffect(() => {
    const onPopState = () => {
      setCurrentDir(getDirFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Fetch the flat path list whenever token+repo+ref changes
  const fetchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const [owner, name] = repo.split("/");
    if (!token || !owner || !name) {
      setAllPaths(null);
      setError(null);
      return;
    }

    fetchAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    fetchAbortRef.current = abortCtrl;

    setLoading(true);
    setError(null);
    setAllPaths(null);

    const backend = new GitHubBackend({ token, owner, repo: name, branch: ref, login: "" });
    backend
      .listMarkdownPaths()
      .then((p) => {
        if (abortCtrl.signal.aborted) return;
        setAllPaths(p);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (abortCtrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      abortCtrl.abort();
    };
  }, [token, repo, ref]);

  // Derive owner/name from the repo input field
  const [repoOwner, repoName] = repo.split("/");

  // Navigate into a subfolder — update state + pushState
  const drillInto = (folderPath: string) => {
    setCurrentDir(folderPath);
    window.history.pushState(
      null,
      "",
      gitHubHref({ owner: repoOwner ?? "", repo: repoName ?? "", branch: ref, path: folderPath }),
    );
  };

  // Navigate up one level
  const drillUp = () => {
    const parent = currentDir.includes("/")
      ? currentDir.slice(0, currentDir.lastIndexOf("/"))
      : "";
    drillInto(parent);
  };

  // Navigate to an arbitrary folder segment
  const drillTo = (folderPath: string) => {
    drillInto(folderPath);
  };

  // Open a file — navigate to the document workspace
  const openFile = (filePath: string) => {
    window.location.assign(
      gitHubHref({ owner: repoOwner ?? "", repo: repoName ?? "", branch: ref, path: filePath }),
    );
  };

  if (!token) {
    return <LoginScreen />;
  }

  // Compute breadcrumb segments for the current dir
  const breadcrumbSegments = splitPath(currentDir);

  // Compute folder contents for the current view
  const entries = allPaths ? getFolderContents(allPaths, currentDir) : [];
  const owner = repoOwner ?? "";
  const displayRepoName = repoName ?? repo;

  return (
    <div className="flex min-h-screen flex-col bg-[#FCFCFC] dark:bg-background px-6 pt-8 pb-12 text-slate-950 dark:text-slate-50">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between">
          <MarginsLogo />
          <button
            type="button"
            onClick={logout}
            className="text-xs font-medium text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-slate-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-slate-100"
          >
            Sign out
          </button>
        </div>

        {/* Repo + branch inputs */}
        <div className="mt-8 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="gh-repo-input"
              className="text-xs font-medium text-stone-500 dark:text-stone-400"
            >
              Repository
            </label>
            <input
              id="gh-repo-input"
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value);
                // Reset dir when repo changes
                setCurrentDir("");
              }}
              placeholder="owner/repo"
              className="h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-950 dark:text-slate-50 outline-none focus:ring-2 focus:ring-slate-300/70 dark:focus:ring-slate-600/70 placeholder:text-stone-400"
              spellCheck={false}
              autoCapitalize="none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="gh-branch-input"
              className="text-xs font-medium text-stone-500 dark:text-stone-400"
            >
              Branch
            </label>
            <input
              id="gh-branch-input"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="main"
              className="h-10 w-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-950 dark:text-slate-50 outline-none focus:ring-2 focus:ring-slate-300/70 dark:focus:ring-slate-600/70 placeholder:text-stone-400"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Error state */}
        {error ? (
          <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}

        {/* Repo browser */}
        {repo && repo.includes("/") ? (
          <div className="mt-6 w-full">
            {/* Repo header */}
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-950 dark:text-slate-50">
                {owner}
                <span className="text-stone-400 dark:text-stone-500">/</span>
                {displayRepoName}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[0.72rem] font-medium text-stone-500 dark:text-stone-400">
                {ref}
              </span>
            </div>

            {/* Breadcrumb of current folder path */}
            {breadcrumbSegments.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
                <button
                  type="button"
                  className="cursor-pointer rounded px-1 py-0.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-slate-950 dark:hover:text-slate-50"
                  onClick={() => drillTo("")}
                >
                  {displayRepoName}
                </button>
                {breadcrumbSegments.map((seg, i) => (
                  <span key={seg.path} className="flex items-center gap-1">
                    <ChevronRight className="size-3 text-stone-300 dark:text-stone-600" aria-hidden="true" />
                    {i === breadcrumbSegments.length - 1 ? (
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {seg.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="cursor-pointer rounded px-1 py-0.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-slate-950 dark:hover:text-slate-50"
                        onClick={() => drillTo(seg.path)}
                      >
                        {seg.name}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : null}

            {/* Loading spinner */}
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-stone-400 dark:text-stone-500">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading files…
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                {/* Up row */}
                {currentDir ? (
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-sm text-stone-500 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors border-b border-slate-100 dark:border-slate-800"
                    onClick={drillUp}
                  >
                    <ArrowLeft className="size-4 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true" />
                    <span>
                      Up to{" "}
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {breadcrumbSegments.length > 1
                          ? breadcrumbSegments[breadcrumbSegments.length - 2].name
                          : repoName}
                      </span>
                    </span>
                  </button>
                ) : null}

                {/* Folder + file rows */}
                {entries.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-stone-400 dark:text-stone-500">
                    No markdown files here.
                  </div>
                ) : (
                  entries.map((entry, i) => {
                    const isLast = i === entries.length - 1;
                    if (entry.kind === "folder") {
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-sm text-slate-950 dark:text-slate-50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors",
                            !isLast && "border-b border-slate-100 dark:border-slate-800",
                          )}
                          onClick={() => drillInto(entry.path)}
                        >
                          <Folder
                            className="size-4 shrink-0 text-stone-400 dark:text-stone-500"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-left font-medium">
                            {entry.name}
                          </span>
                          <ChevronRight
                            className="size-4 shrink-0 text-stone-300 dark:text-stone-600"
                            aria-hidden="true"
                          />
                        </button>
                      );
                    }
                    // file entry
                    return (
                      <button
                        key={entry.path}
                        type="button"
                        className={cn(
                          "group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-sm text-slate-950 dark:text-slate-50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors",
                          !isLast && "border-b border-slate-100 dark:border-slate-800",
                        )}
                        onClick={() => openFile(entry.path)}
                      >
                        <FileText
                          className="size-4 shrink-0 text-stone-400 dark:text-stone-500"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {entry.name}
                        </span>
                        <span className="shrink-0 text-xs text-stone-300 dark:text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity">
                          Open
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
