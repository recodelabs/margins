/**
 * Discover the repositories the GitHub App has been granted access to, and the
 * branches of a chosen repo, so the picker can offer searchable dropdowns
 * instead of bare text inputs.
 *
 * This is a GitHub *App* (user-to-server token), so "repos the app has been
 * shared with" means the App's installation repositories — not the user's
 * entire `/user/repos`. We enumerate the user's installations and the repos
 * accessible within each. All calls go directly from the browser, consistent
 * with the rest of the app, and reuse {@link githubFetch} for rate-limit
 * handling.
 */
import { githubFetch } from "./github-fetch";

const API = "https://api.github.com";

export interface RepoOption {
  /** `owner/repo` */
  fullName: string;
  /** The repo's default branch, used to preselect a sensible branch. */
  defaultBranch: string;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}

/** Extract the `rel="next"` URL from a GitHub `Link` header, if present. */
function nextLink(res: Response): string | null {
  const link = res.headers.get("link");
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * GET `firstUrl` and follow `Link: rel="next"` pages, collecting items from
 * each page via `pick`. Throws on any non-OK response.
 */
async function paginate<T>(
  firstUrl: string,
  token: string,
  pick: (body: unknown) => T[],
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const res: Response = await githubFetch(url, { headers: headers(token) });
    if (!res.ok)
      throw new Error(`GitHub request failed (${res.status}): ${url}`);
    out.push(...pick(await res.json()));
    url = nextLink(res);
  }
  return out;
}

interface Installation {
  id: number;
}
interface InstallationRepo {
  full_name: string;
  default_branch: string;
  pushed_at: string | null;
}

/**
 * List every repository the signed-in user can access through this App's
 * installations, de-duplicated and sorted with the most recently pushed first.
 */
export async function listAccessibleRepos(
  token: string,
): Promise<RepoOption[]> {
  const installations = await paginate<Installation>(
    `${API}/user/installations?per_page=100`,
    token,
    (b) => (b as { installations?: Installation[] }).installations ?? [],
  );

  const byName = new Map<string, RepoOption & { pushedAt: number }>();
  for (const inst of installations) {
    const repos = await paginate<InstallationRepo>(
      `${API}/user/installations/${inst.id}/repositories?per_page=100`,
      token,
      (b) => (b as { repositories?: InstallationRepo[] }).repositories ?? [],
    );
    for (const r of repos) {
      if (byName.has(r.full_name)) continue;
      byName.set(r.full_name, {
        fullName: r.full_name,
        defaultBranch: r.default_branch || "main",
        pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : 0,
      });
    }
  }

  return [...byName.values()]
    .sort(
      (a, b) => b.pushedAt - a.pushedAt || a.fullName.localeCompare(b.fullName),
    )
    .map(({ fullName, defaultBranch }) => ({ fullName, defaultBranch }));
}

interface BranchEntry {
  name: string;
}

/** List the branch names of a repository, following pagination. */
export async function listBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<string[]> {
  const branches = await paginate<BranchEntry>(
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/branches?per_page=100`,
    token,
    (b) => (Array.isArray(b) ? (b as BranchEntry[]) : []),
  );
  return branches.map((b) => b.name);
}
