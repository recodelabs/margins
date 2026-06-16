# REC-477 — Show available repos & branches when logged in

## Problem

After logging in, the repo picker (`app/src/GitHubPicker.tsx`) offers two plain text
inputs: `owner/repo` and a branch name. Users must know and type the exact repository
and branch. The request: populate a searchable dropdown of the repositories the GitHub
App has been granted access to, and — once a repo is chosen — a dropdown of that repo's
actual branches. Free typing and type-to-search must still work.

## Context

- **Auth model:** GitHub **App** user-to-server OAuth (`app/README.md` §1). Token lives
  in `sessionStorage` (`app/src/github-auth.ts`); all GitHub calls are made directly from
  the browser. There is no server-side storage; the only Worker route is the OAuth token
  exchange (`functions/api/auth/[[route]].ts`). The App is granted **Contents: read/write**
  + **Metadata: read** per-repository at install time — i.e. repos are explicitly "shared
  with the app."
- **Current state:** `repo` (`owner/repo` string) and `ref` (branch) are local component
  state in `GitHubPicker.tsx` (~lines 145–150), rendered as `<input>`s (~lines 337–365),
  and reflected into the URL via `github-route.ts`.
- **HTTP helpers:** `githubGet` / `githubFetch` (`app/src/github-fetch.ts`) already handle
  rate-limit detection and ETag caching. Reuse them.
- **UI primitives:** Base UI 1.5 (`@base-ui/react`). It ships an **`Autocomplete`** component
  (`@base-ui/react/autocomplete`) — free-text input + filtered option list — which is the
  exact fit ("type to search, but still type your own value"). The repo already wraps Base
  UI `Select` in `app/src/components/ui/select.tsx`; we follow the same wrapper style.

## Why "available repos" = installation repositories

Because this is a GitHub **App** (not a classic OAuth App), the precise meaning of "repos
the app has been shared with" is the App's *installation repositories*, not the user's
entire `/user/repos`. The correct endpoints (user-to-server token):

1. `GET /user/installations` → installations the user can access.
2. `GET /user/installations/{installation_id}/repositories?per_page=100` → repos the user
   can access **for that installation** (paginated via the `Link` header).

This returns exactly the repos the App can actually read/write, avoiding listing repos the
App was never granted.

## Approach (recommended)

Client-side only — consistent with the existing "browser talks to GitHub directly"
architecture. No new Worker endpoints.

### New module: `app/src/github-repos.ts`
- `listAccessibleRepos(token): Promise<RepoOption[]>` — enumerates installations, then their
  repositories, de-dupes, sorts (recently-pushed first). `RepoOption = { fullName, defaultBranch }`.
- `listBranches(token, owner, repo): Promise<string[]>` — `GET /repos/{owner}/{repo}/branches?per_page=100`,
  paginated. Returns branch names.
- Both reuse `githubGet`, follow `Link` pagination, and **fail soft**: on error (rate limit,
  no installations, network) they surface the error to the caller but the UI keeps working
  as a free-text field.

### New component: `app/src/components/ui/autocomplete.tsx`
Thin wrapper over `@base-ui/react/autocomplete` styled to match `select.tsx` (same border,
popup, highlight tokens). Generic enough to drive both the repo and branch fields.

### Modify: `app/src/GitHubPicker.tsx`
- Replace the repo `<input>` with the repo autocomplete. On mount (authenticated), fetch
  `listAccessibleRepos`; show as filterable options; preserve free typing of `owner/repo`.
- Replace the branch `<input>` with the branch autocomplete. When `repo` is a valid
  `owner/repo`, fetch `listBranches` (debounced, abortable like the existing tree fetch);
  show options; keep free typing. When the repo's `defaultBranch` is known and the user
  hasn't chosen a branch, preselect it instead of hard-coded `"main"`.
- Loading spinners + non-blocking error messages. All current behavior (URL sync, tree
  listing) is unchanged downstream.

### Tests: `app/src/github-repos.test.ts`
- Installation + repo enumeration across multiple installations.
- `Link`-header pagination for repos and branches.
- Error/empty-installations fallback returns `[]` (or throws a typed error the UI tolerates)
  without breaking manual entry.

## Alternatives considered

- **`GET /user/repos`** — simpler, one endpoint, but for a GitHub App user token it does not
  cleanly express "shared with the app" and can over/under-list. Rejected in favor of the
  installation endpoints. (Can be added as a fallback if `/user/installations` is empty.)
- **Add `cmdk` / a new combobox dep** — unnecessary; Base UI 1.5 already provides
  `Autocomplete`. Rejected (avoid new dependency).
- **New Worker endpoints to proxy GitHub** — breaks the "no backend, browser-direct"
  architecture for no benefit. Rejected.

## Out of scope

- Caching repo/branch lists beyond the existing ETag layer.
- Org/owner grouping UI beyond a flat sorted list.
- Changing the token/session model.
