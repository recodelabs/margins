import { type AppEnv, getInstallationToken } from "./installation-token";
import { readSharingFlags } from "./sharing-flags";
import { stripCriticMarkup } from "./strip-critic-markup";

const API = "https://api.github.com";

export interface PublicDocParams {
  owner: string;
  repo: string;
  path: string;
}

// Successful reads get only a short cache. Public sharing is a live toggle:
// a long TTL would keep an un-published doc readable for the whole window.
const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10",
    },
  });

// Never cache the fail-closed 404. A doc that was just made public can briefly
// 404 (GitHub's contents API lags a commit by a second or two); caching that
// would freeze a logged-out viewer on the sign-in picker until the TTL expired.
const notFound = (): Response =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

/** A path must be a relative markdown path — no traversal, no leading slash. */
export function isSafeMarkdownPath(path: string): boolean {
  if (!path || path.startsWith("/")) return false;
  if (path.split("/").some((seg) => seg === "..")) return false;
  if (/[?#]/.test(path)) return false;
  return /\.md$/i.test(path);
}

/**
 * Resolve a public read. Fail closed: any not-allowed/not-found/error condition
 * collapses to 404 so a private file is indistinguishable from a missing one.
 * Returns 400 only for a malformed request path.
 */
export async function handlePublicDoc(
  env: AppEnv,
  params: PublicDocParams,
): Promise<Response> {
  const { owner, repo, path } = params;
  if (!owner || !repo || !isSafeMarkdownPath(path)) {
    return new Response("Bad request", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let token: string;
  try {
    token = await getInstallationToken(env, owner, repo);
  } catch {
    return notFound(); // app not installed / lookup failure → indistinguishable
  }

  // Default branch (no `ref`): the contents API serves the repo's default branch.
  let file: { content?: string; encoding?: string };
  try {
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "marginsmd",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) return notFound();
    file = (await res.json()) as { content?: string; encoding?: string };
  } catch {
    return notFound();
  }
  if (!file.content || file.encoding !== "base64") return notFound();
  const markdown = new TextDecoder().decode(
    Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) =>
      c.charCodeAt(0),
    ),
  );

  const flags = readSharingFlags(markdown);
  if (!flags.public) return notFound();

  return json(
    {
      markdown: flags.comments ? markdown : stripCriticMarkup(markdown),
      comments: flags.comments,
      suggestions: false, // Phase 3
    },
    200,
  );
}
