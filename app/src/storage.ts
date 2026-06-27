import type { ActivityEntry } from "./activity-log";
import type { FileMeta } from "./github-tree";

export interface Page {
  id: string;
  title: string;
  content: string;
  version?: string;
}

export interface MarkdownFileChangeEvent {
  path: string;
  exists: boolean;
  version: string | null;
}

export class MarkdownFileConflictError extends Error {
  current: Page;

  constructor(current: Page) {
    super("Markdown file changed on disk");
    this.name = "MarkdownFileConflictError";
    this.current = current;
  }
}

export class FileTooLargeError extends Error {
  path: string;
  size?: number;

  constructor(path: string, size?: number) {
    super("This file is too large to open in margins (over 1 MB).");
    this.name = "FileTooLargeError";
    this.path = path;
    this.size = size;
  }
}

export interface GitHubRateLimitInfo {
  /** HTTP status that signalled the limit (403 primary, 429 secondary). */
  status: number;
  /** Server-suggested wait, from a `Retry-After` header, in seconds. */
  retryAfterSeconds?: number;
  /** When the primary rate limit resets, from `x-ratelimit-reset`. */
  resetAt?: Date;
}

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Turn rate-limit metadata into a message a user can actually act on. */
export function formatRateLimitMessage(info: GitHubRateLimitInfo): string {
  const base = "GitHub's API rate limit has been reached.";
  if (info.retryAfterSeconds != null && info.retryAfterSeconds > 0) {
    const wait =
      info.retryAfterSeconds >= 60
        ? pluralize(Math.ceil(info.retryAfterSeconds / 60), "minute")
        : pluralize(info.retryAfterSeconds, "second");
    return `${base} Please wait ${wait} and try again.`;
  }
  if (info.resetAt) {
    return `${base} It resets at ${info.resetAt.toLocaleTimeString()}.`;
  }
  return `${base} Please wait a moment and try again.`;
}

/**
 * A GitHub request came back `401 Unauthorized`, meaning the stored OAuth token
 * has expired or been revoked. Callers surface this through {@link
 * handleSessionExpiry} (in `session-expiry.ts`), which boots the user back to
 * the sign-in screen instead of showing a raw `… failed (401)` error.
 */
export class SessionExpiredError extends Error {
  status: number;

  constructor(status = 401) {
    super("Your GitHub session has expired. Please sign in again.");
    this.name = "SessionExpiredError";
    this.status = status;
  }
}

export class GitHubRateLimitError extends Error {
  status: number;
  retryAfterSeconds?: number;
  resetAt?: Date;

  constructor(info: GitHubRateLimitInfo) {
    super(formatRateLimitMessage(info));
    this.name = "GitHubRateLimitError";
    this.status = info.status;
    this.retryAfterSeconds = info.retryAfterSeconds;
    this.resetAt = info.resetAt;
  }
}

/** One commit in a file's history, for the history & diff view. */
export interface FileCommit {
  /** Full commit SHA. */
  sha: string;
  /** First line of the commit message. */
  message: string;
  /** ISO 8601 committed date. */
  date: string;
  /** Commit author's display name (may be empty if GitHub omits it). */
  authorName: string;
  /** Author's GitHub login when the commit maps to a user, else null. */
  authorLogin: string | null;
}

export interface StoredAsset {
  markdownPath: string;
  previewUrl: string;
  mimeType: string;
}

export interface CompleteReviewResult {
  delivered: boolean;
}

export interface CompleteReviewOptions {
  overallComment?: string;
}

export interface ReviewWatchStatus {
  watching: boolean;
  watcherCount: number;
}

export interface BackendInfo {
  kind: "local-files" | "local-storage" | "remote" | "github" | "public";
  label: string;
  detail: string;
  projectPath?: string;
  sessionId?: string;
  originPath?: string;
  authorLabel?: string;
}

export type RemoteSessionStatus = "connected" | "disconnected";

/**
 * Behavioural capabilities a backend opts into, so callers can branch on what a
 * backend *can do* instead of switching on `info.kind` / `instanceof`.
 */
export interface BackendCapabilities {
  /** Exposes a meaningful `documentPath()` for the currently-open document. */
  documentPath: boolean;
  /** Saving requires an explicit user commit (e.g. GitHub) rather than autosave. */
  manualCommit: boolean;
  /** Tracks a live remote session and notifies via `onSessionStatusChange`. */
  remoteSession: boolean;
  /** Supports creating a brand-new markdown file via `createMarkdownFile`. */
  createFile: boolean;
  /** Supports reading/appending a per-file agent activity log. */
  activityLog: boolean;
}

export interface StorageBackend {
  info: BackendInfo;
  capabilities: BackendCapabilities;
  canManageProjects: boolean;
  getMarkdownFile(relativePath: string): Promise<Page>;
  saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page>;
  /**
   * Creates a new markdown file at `relativePath` with the given content and
   * commits it. Rejects if the path already exists. Required (not optional) so
   * every backend provides an explicit path — like `saveMarkdownFile`/`saveAsset`,
   * unsupported backends reject. Callers gate on `capabilities.createFile`.
   */
  createMarkdownFile(relativePath: string, content: string): Promise<Page>;
  /**
   * Reads the per-file agent activity log (empty when absent). Present when
   * `capabilities.activityLog`.
   */
  readActivityLog(docPath: string): Promise<ActivityEntry[]>;
  /**
   * Appends one entry to the per-file activity log and commits it. Present when
   * `capabilities.activityLog`.
   */
  appendActivityEntry(docPath: string, entry: ActivityEntry): Promise<void>;
  /** Path/filename of the open document; present when `capabilities.documentPath`. */
  documentPath?(): string;
  /** Subscribe to session status; present when `capabilities.remoteSession`. */
  onSessionStatusChange?(
    listener: (status: RemoteSessionStatus) => void,
  ): () => void;
  watchMarkdownFile?(
    relativePath: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ): () => void;
  /**
   * Poll the doc's activity log; fire `onChange` with the parsed entries
   * whenever the log changes. Present when `capabilities.activityLog`.
   */
  watchActivityLog?(
    docPath: string,
    onChange: (entries: ActivityEntry[]) => void,
  ): () => void;
  /**
   * Recursively list every supported file path (with size) in the repo, for
   * the workspace file-tree sidebar and the picker. Only the GitHub backend
   * exposes a recursive listing today; callers gate on its presence.
   */
  listMarkdownPaths?(): Promise<FileMeta[]>;
  /** Absolute URL for a commit sha (for "view commit" links). */
  commitUrl?(sha: string): string;
  /**
   * Recent commits touching `relativePath`, newest first. Present on backends
   * that expose file history (currently GitHub); callers gate on its presence.
   */
  listFileHistory?(relativePath: string, limit?: number): Promise<FileCommit[]>;
  /** Read a file's content at a specific commit/ref. Pairs with `listFileHistory`. */
  readFileAtRef?(relativePath: string, ref: string): Promise<string>;
  completeReview?(
    relativePath: string,
    options?: CompleteReviewOptions,
  ): Promise<CompleteReviewResult>;
  getReviewWatchStatus?(relativePath: string): Promise<ReviewWatchStatus>;
  saveAsset(file: File): Promise<StoredAsset>;
  resolveFileUrl(path: string): string | null;
  /**
   * Fetch an asset's bytes with the backend's credentials and return a
   * directly-renderable URL (a `data:` URL). Needed for private repos, whose
   * `resolveFileUrl` raw URLs 404 in an `<img>` tag because they carry no auth.
   * `path` is repo-root-relative. Returns null if unavailable or on failure.
   */
  readAssetDataUrl?(path: string): Promise<string | null>;
  openProject(path: string): Promise<void>;
}
