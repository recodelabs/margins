# Dependency & DX Audit — roughneck / margins

Date: 2026-06-10 · Scope: `/Users/claudius/github/roughneck` (app/, functions/, wrangler.toml, root CLI) · Read-only audit

## 1. Vulnerabilities — CLEAN

`cd app && npm audit` (verbatim): **`found 0 vulnerabilities`**. No CVEs/advisories at any severity. ✅

## 2. Outdated & suspicious dependencies

### Majors behind (`npm outdated`)

| Package | Current | Latest | Gap | Severity |
|---|---|---|---|---|
| `vite` | 6.4.3 | 8.0.16 | **2 majors** | Medium |
| `marked` | 15.0.12 | 18.0.5 | **3 majors** | Medium |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.2 | 2 majors | Medium |
| `typescript` | 5.9.3 | 6.0.3 | 1 major | Low |
| `@tiptap/*` (15 pkgs) | 3.22.4 | 3.26.0 | minors only, blocked by exact pin | Low |

- **Medium — `vite` two majors behind**: build tooling drifts hardest; vite 6 → 8 will eventually gate plugin and Node-version compatibility. Plan the bump.
- **Medium — duplicate `marked` majors**: app pins `marked@15.0.12` while `mermaid@11.15.0` bundles `marked@16.4.2` (`npm ls marked`). Two copies of a markdown parser ship in the bundle, and the direct dep is 3 majors behind (15 → 18).
- **Low — tiptap pin + 15-entry `overrides` block**: every `@tiptap/*` package is exact-pinned to `3.22.4` *and* duplicated in `overrides`. This is a defensible anti-skew tactic (prevents mixed ProseMirror/tiptap versions), but it's a maintenance hazard: every tiptap bump requires editing **30 lines in two blocks** in `app/package.json` (lines 21–35 and 50–65), and the overrides silently freeze transitive copies — `npm audit` fixes inside tiptap would be blocked. If the pins exist for a specific past bug, document why; otherwise switch to a single `^3.x` range, since npm dedupes matching ranges anyway.

### Suspected oddities — checked, mostly exonerated

- **`shadcn@^4.4.0` as runtime dep — legitimate, but verify intent.** It is *not* imported in TS (`grep 'from "shadcn"' app/src` → no hits), but `app/src/style.css:3` does `@import "shadcn/tailwind.css";`, and shadcn 4.x explicitly exposes an `"./tailwind.css"` export (`node_modules/shadcn/package.json` exports map, `"style": "./dist/tailwind.css"`). So the dependency is consumed at build time as a CSS theme. **Caveat (Low):** you're pulling the entire shadcn CLI (registry/MCP/icons code) into `dependencies` for one CSS file; consider `devDependencies` (it's only needed at build) and pin awareness — installed is 4.11.0.
- **`lucide-react@^1.8.0` — valid.** Version exists; installed 1.17.0 == npm latest (`npm view lucide-react version` → 1.17.0). Not a phantom version. ✅
- **`marked` + `turndown` + tiptap — three markdown layers, but coherent.** `app/src/markdown.ts` and `app/src/critic-markup/index.ts` use marked (MD→HTML) and turndown + `@joplin/turndown-plugin-gfm` (HTML→MD) as the round-trip pipeline around the tiptap WYSIWYG. This is a standard architecture, not dead weight — but it does mean three parsers to keep semantically in sync (lossiness bugs live here). Severity: Info/Low.

## 3. Lockfile & repo hygiene

- ✅ `app/package-lock.json` is committed (`git ls-files app/package-lock.json` → present).
- **Low — root `node_modules/` with no root `package.json`**: contains only `.cache/` and `.vite/` (12 KB, no packages, empty `.bin`) — cache droppings from running vite/wrangler dev from the repo root. Harmless and gitignored (`node_modules/` in `.gitignore`), but confusing; safe to delete.
- **Medium — `.wrangler/` is NOT gitignored**: `git ls-files .wrangler` → nothing committed *today*, but `git check-ignore .wrangler` shows no ignore rule. It currently survives `git status` only because it contains a single **empty** `tmp/` dir (git ignores empty dirs). The first `wrangler pages dev` run that writes state/log files there will show up as untracked and is one careless `git add -A` away from being committed. Add `.wrangler/` to `.gitignore`.
- **Low/Medium — junk shipped in `app/public/`** (everything here is copied verbatim into `dist/` and deployed): `ChatGPT Image Jun 10, 2026, 08_07_15 PM.png` (840 KB), `sneak-peek.png` (4.0 MB), `prompt.md`, `setup.md`, `install.sh`. ~5 MB of internal assets/docs publicly served from production. Move to `assets/` or `docs/`.

## 4. Tooling gaps

- **High — no linter/formatter anywhere**: no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, or `biome.json` in `app/` or root (verified by ls/glob). Nothing enforces code style or catches lint-class bugs (unused vars, exhaustive-deps, a11y).
- **High — no CI**: no `.github/` directory at all. The repo has a real vitest suite (`app/src/*.test.ts`, ≥5 files, `npm test` script) and a typecheck baked into `npm run build` (`tsc -b && vite build`) — but **nothing runs either on push/PR**. Deploys are wrangler-manual or Pages-auto with zero gates; a red test suite can ship to production. A ~20-line GitHub Actions workflow (`npm ci && npm test && npm run build` in `app/`) would close this.
- ✅ `app/tsconfig.json` has `"strict": true` (line 11). Minor: no `noUnusedLocals`/`noUncheckedIndexedAccess`, and `skipLibCheck: true` — fine, but lint would normally cover the first.

## 5. Docs accuracy & naming drift

- **High — `docs/deploy-cloudflare.md` contradicts the repo on two load-bearing facts:**
  1. *"Repo artifacts (already committed): `app/public/_redirects` — SPA fallback (`/* /index.html 200`)"* — **the file does not exist** (`git ls-files | grep -i redirect` → nothing; `app/public/` has no `_redirects`). Either the doc is stale or SPA deep-link reloads are relying on Pages' implicit SPA fallback rather than the documented rule. Anyone debugging routing from this doc will chase a phantom file.
  2. The doc deploys to project **`roughneck-web`** (`wrangler pages secret put GITHUB_CLIENT_SECRET --project-name roughneck-web`, example URL `roughneck-web.pages.dev`) — but `wrangler.toml` says **`name = "marginsmd"`**. Following Option B verbatim puts the secret on the **wrong (possibly nonexistent) Pages project** while `wrangler pages deploy` targets `marginsmd`. This is an actionable footgun, not just drift.
  - Otherwise the doc matches reality: `functions/api/auth/[[route]].ts` exists and reads `env.GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (lines 3, 14, 22); `VITE_GITHUB_MODE` is genuinely consumed (`app/src/detect-backend.ts:21,90`); `pages_build_output_dir = "app/dist"` matches.
- **Medium — root `README.md` documents only the legacy LAN-CLI** (`roughneck` bash script: serve folder over LAN, mermaid zoom, wikilinks). It never mentions the deployed Cloudflare app, "margins", or even links to `app/README.md` / `docs/deploy-cloudflare.md`. A visitor to the repo cannot discover that the main artifact is a deployed web app.
- **Medium — five-way naming drift** for one product: **roughneck** (repo, root CLI, `app/README.md` title "roughneck — GitHub-backed markdown reviewer", vite plugin `roughneck-auth-dev`), **roughneck-web** (deploy doc), **margins** (UI wordmark, `wrangler.toml` comment, `app/public/margins.svg`, recent commit messages), **marginsmd** (Pages project `name`), **@roughdraft/app** (`app/package.json` name) — plus the upstream product "Roughdraft". Pick one canonical name; at minimum make the deploy doc match `wrangler.toml`.
- Stale detail: deploy doc references a `feat/github-backend` preview branch (likely merged/gone).

## 6. License

`LICENSE` is MIT. Spot-check of key deps (shadcn MIT, tiptap MIT, marked MIT, lucide ISC-style, mermaid MIT) shows no obvious copyleft concerns. No issues.

## Strengths (max 3)

1. **Zero npm audit vulnerabilities** across the full dependency tree — rare for an editor app pulling tiptap, mermaid, and codemirror.
2. **Lockfile committed + `strict: true` TypeScript + a real vitest suite** with build-time typecheck (`tsc -b` in the build script) — the raw materials for CI already exist.
3. **Clean, minimal deploy architecture** that the code actually matches: static SPA + one stateless Pages Function, secrets kept server-side in the `env` binding, no backend state.

## Top fixes, in order

1. Fix `docs/deploy-cloudflare.md`: project name `marginsmd` (not `roughneck-web`) and remove/restore the `_redirects` claim. (High)
2. Add minimal GitHub Actions CI: `npm ci && npm test && npm run build` in `app/`. (High)
3. Add `.wrangler/` to `.gitignore`; delete stale root `node_modules/`. (Medium)
4. Adopt a linter/formatter (Biome is one file, zero deps). (High-effort-low, big payoff)
5. Plan vite 6→8 and marked 15→18 bumps; reconsider the tiptap exact-pin/overrides block; move `shadcn` to devDependencies; purge ~5 MB of junk from `app/public/`. (Medium/Low)
