# Roughneck Security Audit

Scope: browser-only GitHub-backed markdown reviewer (React SPA in `app/`), OAuth token
exchange (`auth/exchange.ts`, `functions/api/auth/[[route]].ts`), and the legacy shell CLI
(`./roughneck` + `assets/`). Analysis only; no files were modified. Authorized audit of the
owner's own code.

Severity legend: Critical / High / Medium / Low. Each finding labels **Fact** (verifiable from
code) vs **Judgment** (my risk assessment).

> Note: this report deliberately does **not** reproduce the live OAuth client secret found in
> `app/.env`; it is referenced by location only. See M-5.

---

## 1. XSS surfaces

### H-1 — Mermaid `securityLevel: "loose"` + `innerHTML` injection of diagram SVG (High)

**Fact.** Mermaid is initialized with `securityLevel: "loose"` in both render paths, and the
resulting SVG string is injected with `innerHTML`:

- SPA: `app/src/MermaidOverlays.tsx:184` (`securityLevel: "loose"`), injected at
  `MermaidOverlays.tsx:327` (`box.innerHTML = svg`) and `MermaidOverlays.tsx:66`
  (`stage.innerHTML = svg`, the zoom modal).
- Legacy CLI enhancement: `assets/roughneck-enhance.js:109` (`securityLevel: 'loose'`),
  injected at `roughneck-enhance.js:155` (`box.innerHTML = svg`) and
  `roughneck-enhance.js:75` (`stage.innerHTML = svg`).

**Fact.** Mermaid diagram source comes from arbitrary third-party GitHub markdown
(`pre > code.language-mermaid` blocks scanned out of the rendered document).

**Judgment.** `securityLevel: "loose"` is the explicitly-discouraged setting for untrusted
input: it enables HTML in node labels (rendered into `<foreignObject>`) and `click`/`href`
interactions, dramatically weakening Mermaid's built-in sanitization. An attacker-authored
diagram (e.g. a flowchart node label containing an `<img onerror=...>` payload, or a `click`
directive with a `javascript:` target) can produce SVG markup that executes script when injected
via `innerHTML`. In the SPA the in-document overlay sets `pointerEvents:none`
(`MermaidOverlays.tsx:333`), but the zoom **modal** (`stage.innerHTML = svg`,
`MermaidOverlays.tsx:66`) leaves the SVG fully interactive, and `onerror`-style label payloads
fire on render with no interaction at all. A successful XSS runs in the app origin and can read
`sessionStorage["roughneck.gh.token"]` (`app/src/github-auth.ts:1,20,27`) — a GitHub token with
repo write access — and exfiltrate it. This is the highest-impact issue in the codebase.

**Recommendation.** Use `securityLevel: "strict"`, and/or run the SVG through DOMPurify
(configured for SVG) before `innerHTML`. DOMPurify is not currently a dependency.

### Note — Markdown body is largely protected (mitigated, see Strength S-1)

**Fact.** `marked` (v15) is used with `gfm:true` and a custom renderer (`app/src/markdown.ts:552-558`).
marked v15 does **not** sanitize HTML, and there is **no DOMPurify** anywhere in `app/`
(confirmed: not in `package.json`). However, the rendered HTML is never injected via
`dangerouslySetInnerHTML` (confirmed: zero occurrences in `app/src`). It is fed to Tiptap via
`insertContent`/`setContent` (`app/src/PageCard.tsx:714`, `:1297`; `app/src/EditorContextMenu.tsx:611`),
which parses through the ProseMirror schema and drops unknown tags/attributes and event handlers.

**Judgment.** This round-trip is the de-facto sanitizer for the document body. Residual risk is
limited but worth noting: the protection is a side-effect of the editor schema, not an explicit
sanitization step, so a future schema/extension change (or any new direct-DOM render path) could
reopen body XSS. The Mermaid path (H-1) bypasses this entirely because it reads raw `<code>`
text and renders to the DOM itself.

### Note — `javascript:` links (Low, mitigated)

**Fact.** The marked renderer emits `<a href="...">` with only HTML-escaping of the href
(`app/src/markdown.ts:344`); it does not block `javascript:` schemes. Tiptap link extension is
`@tiptap/extension-link@3.22.4` configured with `openOnClick:false` (`app/src/editor-extensions.ts:783-787`).

**Judgment.** Tiptap v3's Link extension applies a default protocol allowlist (`isAllowedUri`)
that strips `javascript:` on parse, and `openOnClick:false` disables programmatic navigation, so
this is mitigated in practice. Low risk; relies on a library default rather than an explicit
project policy.

### Note — `critic-markup/index.ts` `innerHTML` reads are sinks-as-sources, not XSS

**Fact.** `app/src/critic-markup/index.ts:1038,1082,1213` read `element.innerHTML` and pass it to
`turndown` (HTML→markdown). These are reads of already-parsed DOM, not injection points.

---

## 2. OAuth flow

### M-1 — Access token placed in 302 `Location` header fragment (Medium)

**Fact.** The callback builds `Location: ${url.origin}/#token=<token>&state=<state>` and returns it
as a 302 redirect (`functions/api/auth/[[route]].ts:25-26`; dev mirror `app/vite.config.ts:33`).

**Judgment.** Although URL fragments are not sent to servers on the *subsequent* request, the
token here lives in the **response `Location` header** of the callback. Any edge/proxy/CDN/access
log that records response headers (or the GitHub App owner's own observability) captures a live
repo-write token in cleartext. `Cache-Control: no-store` is set (good) but does not prevent
logging. The SPA does strip the fragment quickly via `history.replaceState`
(`app/src/github-auth.ts:15`), limiting browser-history exposure. Preferred design: set the token
in a short-lived, `HttpOnly`, `Secure`, `SameSite` cookie from the callback, or POST it to an
opener via `postMessage`, rather than carrying it in a redirect URL.

### M-2 — No security headers / no CSP (Medium)

**Fact.** There is no `_headers` file in `app/public/` or `app/dist/` (confirmed: `find` returns
nothing), and `app/index.html` has no CSP `<meta http-equiv>` (confirmed: no match).

**Judgment.** Cloudflare Pages serves the SPA with no Content-Security-Policy, no
`X-Content-Type-Options`, no `Referrer-Policy`, no `X-Frame-Options`/frame-ancestors. A CSP that
restricts `script-src` and `connect-src` would be a strong second line of defense that
substantially reduces the blast radius of H-1 (e.g. blocking token exfiltration to an attacker
host, and blocking the jsdelivr CDN unless explicitly allowed). Its absence elevates the
practical impact of any XSS.

### L-1 — Error message returned verbatim on the 500 path (Low)

**Fact.** Both the Pages Function and the Vite dev middleware return the raw exception text to the
client on token-exchange failure: `functions/api/auth/[[route]].ts:28`
(`e instanceof Error ? e.message : String(e)`) and `app/vite.config.ts:37`.

**Judgment.** The thrown messages (`auth/exchange.ts:11,22,23`) do not include the client secret,
so this is information disclosure of internal error detail only (e.g. GitHub OAuth error codes).
Low. Return a generic message and log details server-side.

### L-2 — Client-side-only state; no PKCE (Low / informational)

**Fact.** `state` is generated client-side (`app/src/github-auth.ts:36`), stored in
`sessionStorage`, reflected opaquely by the login endpoint
(`functions/api/auth/[[route]].ts:16`), and verified only client-side
(`app/src/github-auth.ts:13-18`). The `/login` endpoint accepts an attacker-suppliable `state`
query param and passes it straight to GitHub. There is no PKCE.

**Judgment.** For a confidential-client web flow (client secret held server-side) this is an
acceptable CSRF model: an attacker cannot read the victim's `sessionStorage`, so a forged
callback fails the client-side state check. The login endpoint reflecting an arbitrary `state` is
not exploitable on its own (the attacker still cannot satisfy the victim's stored value). PKCE is
not required for a confidential client. No action required; documented for completeness.

### Note — Open redirect: not present (Fact)

`redirect_uri` and the final redirect target are both derived from `url.origin`
(`functions/api/auth/[[route]].ts:15,25`), which is the deployment's own origin and not
attacker-controlled. No open-redirect primitive.

---

## 3. Shell CLI (`./roughneck`) and patch mechanism

### M-3 — CDN-loaded Mermaid with no Subresource Integrity (Medium)

**Fact.** `assets/roughneck-enhance.js:106` dynamically imports Mermaid from
`https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs` with no integrity check;
the fallback `loadScript('/assets/mermaid.min.js')` (`roughneck-enhance.js:107`) also has no
integrity attribute. The version is range-pinned (`mermaid@11`), not exact.

**Judgment.** This script is injected into the Roughdraft page (`./roughneck:71`), which is served
over the LAN with the access token carried in the page URL (`./roughneck:216,218`,
`?token=$TOKEN`). A compromised jsdelivr asset (or the loose `@11` range pulling a malicious
release) executes arbitrary JS in that page and can read the token from the URL. `import()` cannot
carry an SRI hash, so the robust fix is to prefer the bundled local copy
(`assets/mermaid.min.js`, which is committed) and treat the CDN as optional, or pin an exact
version. Supply-chain risk, Medium.

### M-4 — Patching files inside a globally-installed npm package (Medium)

**Fact.** `./roughneck` rewrites files inside the global `roughdraft` install on every run:
`ensure_spa_fix` (`./roughneck:41-47`, `perl -0pi` over `packages/server/dist/index.js`),
`ensure_url_fix` (`:52-56`, runs `assets/patch-url.mjs` over `app/dist/assets/index-*.js`), and
`ensure_enhance_patch` (`:62-73`, copies `assets/mermaid.min.js` + `assets/roughneck-enhance.js`
into the package and injects a `<script>` into `index.html`). These re-apply after every
Roughdraft update (`./roughneck:171-173`).

**Judgment.** This is a persistence/supply-chain footgun: roughneck silently mutates a shared,
globally-installed package's distributed files, and re-injects its own JS whenever upstream wipes
it. If `assets/roughneck-enhance.js` (or the `RN_ASSETS` dir) is ever writable by another local
user or is tampered with, that JS is propagated into the Roughdraft app served to every LAN
client. `RN_DIR`/`RN_ASSETS` are resolved by following the symlink (`./roughneck:31-34`) with no
integrity/ownership check. Medium for a local-dev tool; the blast radius is LAN clients of the
served folder.

### L-3 — Roughdraft bound to `0.0.0.0` by default; token carried in URL (Low/Medium)

**Fact.** Default bind is `0.0.0.0` (`./roughneck:160`), exposing the served markdown folder to
the whole LAN; access is gated by a token (`openssl rand -hex 16`, `./roughneck:107`) placed in
the page URL query (`./roughneck:216,218`).

**Judgment.** The token has good entropy (Fact: 128-bit), but living in the URL means it leaks via
the Roughdraft server's own request logs, browser history, and any `Referer` to third-party
resources loaded by the page. `--local` exists to bind loopback but is opt-in. Low-to-Medium,
local-network scope.

### Command injection / quoting: largely clean (Fact, positive)

**Fact.** User-supplied path args are not passed through a shell: `abspath` uses
`python3 -c '...' "$1"` with the value as `argv` (`./roughneck:36`), URL-encoding likewise uses
`python3 -c` with `argv` (`./roughneck:216`), and `jq` values use `--arg`/`--argjson`. Variables
are consistently quoted, `set -uo pipefail` is set (`./roughneck:11`), and there is no `eval`.
No command-injection primitive was found via folder/file arguments.

**Judgment (Low).** Residual: the script trusts `PATH` for `jq`, `node`, `curl`, `perl`,
`python3`, `openssl`, `lsof`, `scutil`, `open` (no absolute paths / `command -v` resolution before
use), so a poisoned `PATH` in the invoking shell could substitute any of them. Standard local-tool
caveat; Low.

---

## 4. Secrets hygiene

### M-5 — Real OAuth client secret present in working-tree `app/.env` (Medium — rotate)

**Fact.** `app/.env` (gitignored) contains real, non-placeholder credentials: a populated
`GITHUB_CLIENT_ID` and a populated `GITHUB_CLIENT_SECRET` (40-hex-char value). The literal value
is intentionally omitted from this report.

**Fact (positive).** `.env` is correctly gitignored (`app/.gitignore:3`), is **not** tracked
(`git ls-files` shows only `app/.env.example`), and the secret does **not** appear in git history
(checked `git log --all -p -- app/.env` and a value grep across `git rev-list --all` — no hits).
`app/.env.example` ships with empty placeholder values.

**Judgment.** Git history is clean, which is the important thing. However a live client secret
sits in cleartext on disk. Recommend **rotating `GITHUB_CLIENT_SECRET`** and confirming the `.env`
file has never been included in any backup, container image, or shared archive. The client secret
authorizes OAuth code→token exchange for the app; its exposure allows impersonation of the app's
token issuance. Medium, action: rotate as a precaution and keep it out of any shared context.

### Note — secret stays server-side in code (Fact, positive)

The secret is read only by server-side code (`functions/api/auth/[[route]].ts:3,22`;
`auth/exchange.ts`) and the Vite dev middleware (`app/vite.config.ts:29`). It is not referenced by
any `VITE_`-prefixed variable and therefore is not inlined into the client bundle. Only
`VITE_GITHUB_MODE` is exposed to the SPA.

---

## 5. Vite dev middleware (`app/vite.config.ts`)

### Same shape as the Pages Function (Fact)

**Fact.** `authDevPlugin` (`app/vite.config.ts:7-45`) reimplements the login/callback flow
identically: it constructs the GitHub authorize redirect (`:14-23`), exchanges the code via the
shared `exchangeCodeForToken` (`:27-30`), and returns the token in a `Location: /#token=...`
fragment (`:33`). It inherits **M-1** (token in `Location` header) and **L-1** (raw error text to
client, `:37`).

**Judgment.** Dev-only (it runs under `configureServer`, not in the production Pages build), so the
exposure is limited to a developer's local machine. No additional production risk beyond what M-1
and L-1 already cover. One extra note: it builds the origin from the client-supplied `Host`
header (`:12-13`) — harmless for a localhost dev server, but the same pattern would be a host-header
concern if ever reused server-side.

---

## Strengths (max 3)

- **S-1 — Document-body HTML is sanitized by construction.** Rendered markdown HTML is never
  `dangerouslySetInnerHTML`'d (zero occurrences in `app/src`); it round-trips through the Tiptap/
  ProseMirror schema (`app/src/PageCard.tsx:714,1297`), which drops unknown tags, attributes, and
  event handlers. Raw HTML blocks (`<details>`, comments) are encoded as opaque
  `data-markdown-raw-block` attributes rather than injected (`app/src/markdown.ts:52-67`), and the
  renderer HTML-escapes hrefs/titles/text/code (`markdown.ts:316-355`). Comment bodies render as
  React text children (`app/src/App.tsx:1115,1131`), auto-escaped.

- **S-2 — Secret handling is disciplined.** The OAuth client secret is server-side only, is never
  exposed through a `VITE_` variable (so it stays out of the client bundle), `.env` is gitignored,
  and the secret is absent from git history.

- **S-3 — Auth responses are cache-safe and state-checked.** The callback/login responses set
  `Cache-Control: no-store` (`functions/api/auth/[[route]].ts:11`), the SPA validates OAuth `state`
  before accepting a token and strips the URL fragment via `history.replaceState` regardless of
  outcome (`app/src/github-auth.ts:13-19`), and the redirect target is derived from the request
  origin (no open redirect).

---

## Priority summary

| ID   | Severity | Issue |
|------|----------|-------|
| H-1  | High     | Mermaid `securityLevel:"loose"` + `innerHTML` of diagram SVG → stored XSS → token exfiltration (SPA + CLI) |
| M-1  | Medium   | Access token in 302 `Location` header fragment (log exposure) |
| M-2  | Medium   | No CSP / security headers on Cloudflare Pages |
| M-3  | Medium   | CDN-loaded Mermaid, no SRI, loose version range |
| M-4  | Medium   | Patching globally-installed npm package (persistence/supply-chain) |
| M-5  | Medium   | Live client secret in working-tree `app/.env` — rotate (history is clean) |
| L-1  | Low      | Raw error text returned on 500 path |
| L-2  | Low      | Client-side-only OAuth state; no PKCE (acceptable for confidential client) |
| L-3  | Low/Med  | Roughdraft bound 0.0.0.0 by default; token in URL |
| L-3b | Low      | Shell CLI trusts `PATH` for all external tools |

Top recommendation: fix H-1 (switch Mermaid to `strict` and/or DOMPurify the SVG) and add a CSP
(M-2) — together they close the only practical token-exfiltration path against untrusted repo
content.
