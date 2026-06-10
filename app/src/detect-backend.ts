import type { StorageBackend } from "./storage";
import { ApiBackend } from "./api-backend";
import { LocalStorageBackend } from "./local-storage-backend";
import { RemoteBackend } from "./remote-backend";
import { GitHubBackend } from "./github-backend";
import { captureTokenFromUrl, fetchLogin } from "./github-auth";

interface StatusPayload {
  backend?: string;
  projectDir?: string;
  stateless?: boolean;
  capabilities?: { remoteDocuments?: boolean };
}

export async function detectBackend(): Promise<StorageBackend> {
  if (import.meta.env.VITE_PREVIEW_WEB === "1") {
    return new LocalStorageBackend();
  }

  if (import.meta.env.VITE_GITHUB_MODE === "1") {
    const token = captureTokenFromUrl();
    const params = new URLSearchParams(window.location.search);
    const [owner, repo] = (params.get("repo") || "").split("/");
    const branch = params.get("ref") || "main";
    if (token && owner && repo) {
      const login = await fetchLogin(token).catch(() => "user");
      return new GitHubBackend({ token, owner, repo, branch, login });
    }
    // Not enough info yet (no token or repo) — fall through; the picker (Task 7) handles it.
  }

  const sessionId = readSessionIdFromUrl();
  const token = readTokenFromUrl();

  let statusPayload: StatusPayload | null = null;

  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      statusPayload = (await res.json()) as StatusPayload;
    }
  } catch {
    // network error — no server available
  }

  if (statusPayload) {
    if (sessionId && statusPayload.capabilities?.remoteDocuments) {
      try {
        return await RemoteBackend.create(sessionId, token);
      } catch (error) {
        console.error("Could not initialize remote backend:", error);
        throw error;
      }
    }

    if (statusPayload.backend === "local-files") {
      return new ApiBackend({
        kind: "local-files",
        label: "Local files",
        detail: statusPayload.stateless
          ? "Open a markdown file"
          : "Markdown file on disk",
        projectPath: statusPayload.projectDir,
      });
    }
  }

  return new LocalStorageBackend();
}

function readSessionIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const session = params.get("session")?.trim();
  return session && session.length > 0 ? session : null;
}

function readTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("token")?.trim() ?? "";
}

export function isGitHubMode(): boolean {
  return import.meta.env.VITE_GITHUB_MODE === "1";
}

export function gitHubSelectionFromUrl(): { token: string | null; repo: string; ref: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    token: captureTokenFromUrl(),
    repo: params.get("repo") || "",
    ref: params.get("ref") || "main",
  };
}
