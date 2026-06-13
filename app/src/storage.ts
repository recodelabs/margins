import type { ActivityEntry } from "./activity-log";

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
  kind: "local-files" | "local-storage" | "remote" | "github";
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
  completeReview?(
    relativePath: string,
    options?: CompleteReviewOptions,
  ): Promise<CompleteReviewResult>;
  getReviewWatchStatus?(relativePath: string): Promise<ReviewWatchStatus>;
  saveAsset(file: File): Promise<StoredAsset>;
  resolveFileUrl(path: string): string | null;
  openProject(path: string): Promise<void>;
}
