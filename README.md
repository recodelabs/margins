# roughneck

A repo browser and enhancement layer for [Roughdraft](https://www.roughdraft.md/) — the local-first
markdown review app for coding agents.

`roughneck` lets you serve any folder's markdown over your LAN and review it in Roughdraft, with a
set of quality-of-life enhancements layered on top:

- **Repo file browser** at the server root (`/`) — browse folders & markdown files, click to open.
- **Mermaid diagrams** rendered inline, with **click-to-zoom** (pan + wheel zoom modal).
- **Obsidian `[[wikilinks]]`** rendered as real links (color, no brackets) that open the linked note.
- **Wider content column** (incl. when the comment view is open).
- **Light / Auto theme toggle** (defaults to light).
- **Reliability fixes** for Roughdraft's SPA routing (deep-link reloads, URL flip-flop).
- One server **per folder**, network-exposed (`0.0.0.0`) so other devices on your LAN can review.

## Install

Requires `node`, `jq`, `curl`, and a global Roughdraft install (`npm i -g roughdraft`).

```bash
git clone https://github.com/recodelabs/roughneck.git
ln -sf "$PWD/roughneck/roughneck" /opt/homebrew/bin/roughneck   # or anywhere on your PATH
```

## Usage

```bash
roughneck [--local] [--no-open] [FOLDER] [FILE.md]   # serve FOLDER (default: cwd); optionally open FILE
roughneck list                                       # show running servers
roughneck stop [FOLDER|all]                          # stop a server
roughneck enhance                                    # (re)apply the in-browser enhancements
```

- Default binds to `0.0.0.0` so devices on your LAN can reach it at `http://<host>.local:<port>/`.
  Use `--local` to bind loopback only.
- The root URL (`http://<host>.local:<port>/`) is the **repo browser**.
- A subtle **⬡ roughneck** chip (top-left, on doc pages) returns you to the browser.

## How it works

`roughneck` is a thin shell wrapper around Roughdraft's own server (`child.js`), plus a set of
**patches applied to the installed Roughdraft** on every run (idempotent, re-applied after upgrades,
with `.rn-bak` backups):

| Patch | Target | Why |
|---|---|---|
| Enhancement script | `app/dist/index.html` (injects `assets/roughneck-enhance.js`) | All the in-browser features below |
| SPA fallback fix | `server/dist/index.js` | `res.sendFile(absolutePath)` 404s under Express 5 → deep-link reloads broke |
| URL normalization | `app/dist/assets/index-*.js` (`patch-url.mjs`) | The app flip-flopped `/x` ↔ `/?path=/x` on reload and sometimes dropped to the landing page |

### The ProseMirror constraint (important for contributors)

Roughdraft renders documents in a **ProseMirror** editor that **actively reverts any change to its
own DOM** — inline styles, injected nodes, everything. So `roughneck-enhance.js` follows two rules:

1. **Never mutate the editor DOM.** Diagrams and wikilinks are drawn as **overlays appended to the
   page's scroll container** (so they scroll natively) and positioned over the source text.
2. **Reserve space / hide source via an external stylesheet**, not inline styles — ProseMirror can't
   see stylesheet rules, so it won't fight them. Per-element sizing is done with `nth-child` rules
   keyed to each block's position.

Everything is plain ES5-ish browser JS in `assets/roughneck-enhance.js`, organized in sections
(1: width, 2: theme, 3: mermaid, 4: wikilinks, 5: browser).

## Files

```
roughneck                       # the CLI
assets/roughneck-enhance.js     # in-browser enhancements (the bulk of the logic)
assets/mermaid.min.js           # bundled mermaid (fallback renderer; primary is mermaid via CDN)
assets/patch-url.mjs            # the SPA URL-normalization patch
```

## Notes / known limits

- Big documents (hundreds of KB) are slow to load — that's ProseMirror parsing, not roughneck.
- Mermaid loads from a CDN by default (falls back to the bundled copy); diagrams need network the
  first time unless the bundle is used.
- macOS-oriented (uses `scutil`, `/opt/homebrew`); easily adapted for Linux.

## License

TBD.
