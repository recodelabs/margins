# Deploying roughneck-web to Cloudflare Pages

roughneck-web is a static SPA (`app/`) plus one stateless auth Function
(`functions/api/auth/[[route]].ts`). Cloudflare Pages serves both on one domain — the
static build from a CDN and the Function at `/api/auth/*`. No server, no database.

## Prerequisites

- A GitHub App (see `app/README.md` → "GitHub App setup") with its **Client ID** and a
  **Client secret**. You'll add the production callback URL below once you know the domain.
- The repo pushed to GitHub (the `recodelabs/roughneck` repo).

## Repo artifacts (already committed)

- `wrangler.toml` — `pages_build_output_dir = "app/dist"`, a `compatibility_date`, and the
  project `name`.
- `app/public/_redirects` — SPA fallback (`/* /index.html 200`). Pages matches the
  `/api/auth/*` Function *before* this rule, so auth is unaffected.

## Option A — Dashboard (Git integration, recommended)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
   select `recodelabs/roughneck`.
2. Build settings:
   - **Production branch:** `main` (or deploy `feat/github-backend` as a preview first).
   - **Root directory:** `/` (repo root — so the `functions/` dir is found).
   - **Build command:** `cd app && npm install && npm run build`
   - **Build output directory:** `app/dist`
3. **Environment variables** (Settings → Environment variables, set for Production *and*
   Preview):
   - `GITHUB_CLIENT_ID` = your App's Client ID
   - `GITHUB_CLIENT_SECRET` = your App's Client secret (mark as a **Secret** / encrypted)
   - `VITE_GITHUB_MODE` = `1`  ← build-time flag; Vite inlines it so the app boots in GitHub mode
4. **Save and Deploy.** Note the resulting URL, e.g. `https://roughneck-web.pages.dev`.
5. **Point the GitHub App at it:** in the App settings, add the callback URL
   `https://<your-domain>/api/auth/callback` (keep the localhost one too for local dev). Make
   sure the App is **installed** on the repos you want to edit (Contents: read & write).
6. Visit the URL → Login with GitHub → pick a repo/branch → edit → commit.

## Option B — Wrangler CLI

```bash
npm i -g wrangler           # if needed
cd /path/to/roughneck
cd app && npm install && npm run build && cd ..
wrangler pages deploy app/dist        # uses wrangler.toml (name + output dir)
```
Set the env vars/secrets once via the dashboard (as in Option A step 3) or:
```bash
wrangler pages secret put GITHUB_CLIENT_SECRET --project-name roughneck-web
# GITHUB_CLIENT_ID and VITE_GITHUB_MODE can be plain env vars in the dashboard;
# VITE_GITHUB_MODE must be present at BUILD time, so prefer setting it in the dashboard
# (Option A) and building there, or export it before `npm run build` for CLI builds:
#   VITE_GITHUB_MODE=1 npm run build
```
Then add the production callback URL to the GitHub App (Option A step 5).

## How the pieces map at runtime

- `GET /api/auth/login` and `/api/auth/callback` → the Pages Function (reads
  `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` from the `env` binding; the secret never reaches
  the browser).
- Everything else → static assets from `app/dist`, with `_redirects` falling back to
  `index.html`.
- The browser holds the user token in `sessionStorage` and calls the GitHub API directly for
  all repo reads/writes.

## Verify after deploy

1. Open the domain → "Login with GitHub" → authorize.
2. Enter `owner/repo` + branch → markdown files list.
3. Open a file, add a CriticMarkup comment (authored as your GitHub login), edit, save.
4. Confirm the commit appears on GitHub on the chosen branch, authored by you.
5. Force a conflict: edit the same file on GitHub between open and save → the app should
   surface a conflict (not silently overwrite).

## Notes / gotchas

- **`VITE_GITHUB_MODE` must be set at build time.** If the deployed app loads the local-files
  homepage instead of the GitHub login, the build didn't see `VITE_GITHUB_MODE=1`.
- **Callback URL must match exactly**, including scheme and host. A mismatch yields a GitHub
  "redirect_uri" error.
- **Custom domain:** add it in Pages, then add `https://<custom-domain>/api/auth/callback` to
  the GitHub App as well.
- Base path is `/` (no subpath), so this works at a `*.pages.dev` host or a custom apex/subdomain
  without changing Vite's `base`.
