# Confine-to-Folder + Clean Relative URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make roughneck serve exactly one folder — clean relative URLs (`?path=icr-v1.md`), hard 403 on anything outside the folder, no token, LAN by default — without patching Roughdraft's internals.

**Architecture:** Replace the `child.js` launch with a roughneck-owned Node entry (`assets/roughneck-server.mjs`) that imports Roughdraft's exported `createApp()`, wraps it in a parent Express app with one guard middleware (block `/api/remote-document/*`, force `projectPath` to the launched folder, confine the doc `path`), and listens directly — bypassing Roughdraft's no-token-on-LAN guard. The bash CLI is updated to launch it and drop tokens; the `abs()` enhancer hack is reverted.

**Tech Stack:** Node 18+ (ESM, dynamic `import`), Express 5 (provided by Roughdraft), bash, curl. No new npm dependencies (Express comes from the installed Roughdraft; the entry imports it by absolute path).

**Spec:** `docs/superpowers/specs/2026-06-10-confine-to-folder-design.md`

---

## File Structure

- **Create** `assets/roughneck-server.mjs` — the in-process gatekeeper entry. One responsibility: stand up Roughdraft's app behind a confinement guard and listen.
- **Create** `test/confine.test.sh` — dependency-free integration test: boots the gatekeeper against a temp folder and asserts confinement / clean-URL / block behaviors via curl.
- **Modify** `roughneck` (bash CLI) — `start_server()` launches the gatekeeper instead of `child.js`; remove token generation/printing; keep bind flags.
- **Modify** `assets/roughneck-enhance.js` — revert the `abs()` helper and its 3 call sites back to relative paths.
- **Modify** `README.md` — drop token from documented URLs; note confinement + LAN-by-default.

---

## Task 1: Gatekeeper entry — `assets/roughneck-server.mjs`

**Files:**
- Create: `assets/roughneck-server.mjs`
- Create: `test/confine.test.sh`

The gatekeeper is exercised by an integration test (it has no pure units worth isolating —
its whole job is HTTP behavior against the real Roughdraft app). TDD here = write the failing
integration test, watch it fail because the entry doesn't exist, implement the entry, watch it pass.

- [ ] **Step 1: Write the failing integration test**

Create `test/confine.test.sh`:

```bash
#!/usr/bin/env bash
# Integration test for the roughneck gatekeeper (assets/roughneck-server.mjs).
# Boots it against a temp folder and asserts confinement + clean-URL behavior.
set -uo pipefail

RN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$RN_DIR/assets/roughneck-server.mjs"
RD_ROOT="$(npm root -g)/roughdraft"
PORT=7399
HOST=127.0.0.1
BASE="http://$HOST:$PORT"

fail=0
check(){ # check "name" "expected" "actual"
  if [ "$2" = "$3" ]; then printf 'ok   - %s\n' "$1"
  else printf 'FAIL - %s (expected %s, got %s)\n' "$1" "$2" "$3"; fail=1; fi
}

# --- fixture: a project folder with a doc, plus a sibling file OUTSIDE it ---
WORK="$(mktemp -d)"
PROJ="$WORK/project"
mkdir -p "$PROJ"
printf '# Inside\n' > "$PROJ/doc.md"
printf '# Outside\n' > "$WORK/secret.md"   # parent of PROJ — must stay unreachable

# --- boot the gatekeeper ---
node "$ENTRY" --port "$PORT" --project-dir "$PROJ" --host "$HOST" --rd-root "$RD_ROOT" \
  > "$WORK/server.log" 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null; rm -rf "$WORK"' EXIT
curl -s --retry 30 --retry-delay 1 --retry-connrefused -o /dev/null "$BASE/" \
  || { echo "server never came up"; cat "$WORK/server.log"; exit 1; }

code(){ curl -s -o /dev/null -w '%{http_code}' "$1"; }

# 1. relative path inside the folder reads OK (clean-URL model)
check "relative doc reads 200" 200 "$(code "$BASE/api/markdown-file?path=doc.md")"

# 2. confinement: naming the PARENT folder as projectPath is IGNORED — the request
#    is reinterpreted as <PROJ>/secret.md, which doesn't exist, so the parent's
#    secret.md is never exposed (404, not the file's 200).
check "parent projectPath ignored" 404 \
  "$(code "$BASE/api/markdown-file?path=secret.md&projectPath=$WORK")"

# 3. traversal via path escapes the folder -> 403
check "dotdot traversal blocked" 403 "$(code "$BASE/api/markdown-file?path=../secret.md")"

# 4. absolute path escapes -> 403
check "absolute path blocked" 403 "$(code "$BASE/api/markdown-file?path=/etc/hosts")"

# 5. remote-document surface is gone
check "remote-document blocked" 404 "$(code "$BASE/api/remote-document/whatever")"

# 6. status still reports the pinned folder
check "status projectDir pinned" "$PROJ" \
  "$(curl -s "$BASE/api/status" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write((JSON.parse(s).projectDir)||""))')"

exit $fail
```

Make it executable: `chmod +x test/confine.test.sh`

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/confine.test.sh`
Expected: FAIL — server never comes up / `assets/roughneck-server.mjs` does not exist
(node prints "Cannot find module …/roughneck-server.mjs"), script exits non-zero.

- [ ] **Step 3: Implement the gatekeeper**

Create `assets/roughneck-server.mjs`:

```js
// roughneck gatekeeper — stands up Roughdraft's exported app behind a confinement
// guard, then listens directly. Running our own listener (instead of Roughdraft's
// createServer) lets us bind the LAN without a token AND own the security boundary,
// so Roughdraft updates import cleanly. Launched by the roughneck CLI.
import http from "node:http";
import path from "node:path";
import express from "express";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const port = Number.parseInt(arg("--port", "7375"), 10);
const host = arg("--host", "0.0.0.0");
const projectDir = path.resolve(arg("--project-dir", process.cwd()));
const rdRoot = arg("--rd-root", "");
if (!rdRoot) { console.error("roughneck-server: --rd-root is required"); process.exit(1); }

// Import Roughdraft's app factory by absolute path. Fail LOUD if the export is gone
// after an upgrade — never degrade into an unconfined server.
let createApp;
try {
  ({ createApp } = await import(path.join(rdRoot, "packages/server/dist/index.js")));
} catch (e) {
  console.error("roughneck-server: cannot import Roughdraft createApp from " + rdRoot, e);
  process.exit(1);
}
if (typeof createApp !== "function") {
  console.error("roughneck-server: Roughdraft no longer exports createApp — aborting");
  process.exit(1);
}

const { app: rd } = createApp({ port, projectDir });

// True iff `resolved` is the folder itself or lives inside it.
function inside(resolved) {
  return resolved === projectDir || resolved.startsWith(projectDir + path.sep);
}

const parent = express();
parent.use((req, res, next) => {
  if (req.path.startsWith("/api/remote-document/")) return res.sendStatus(404);
  if (req.path.startsWith("/api/")) {
    const u = new URL(req.url, "http://localhost");
    const rel = u.searchParams.get("path");
    if (rel != null && !inside(path.resolve(projectDir, rel))) return res.sendStatus(403);
    u.searchParams.set("projectPath", projectDir); // pin: ignore client-supplied root
    req.url = u.pathname + u.search;               // rewrite so the mounted app re-parses
  }
  next();
});
parent.use(rd);

http.createServer(parent).listen(port, host, () => {
  console.log(`roughneck-server: ${host}:${port} -> ${projectDir}`);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/confine.test.sh`
Expected: all six lines print `ok - …`, script exits 0.

- [ ] **Step 5: Commit**

```bash
git add assets/roughneck-server.mjs test/confine.test.sh
git commit --no-gpg-sign -m "feat: in-process gatekeeper confining Roughdraft to one folder"
```

---

## Task 2: Launch the gatekeeper from the CLI; drop the token

**Files:**
- Modify: `roughneck` (function `start_server`, lines ~104-120; URL printing ~215-219)

- [ ] **Step 1: Add a failing assertion to the test — no token in the open URL**

Append to `test/confine.test.sh` before `exit $fail` (this also guards the CLI path):

```bash
# 7. CLI: the printed "open:" URL carries no token
OPEN_LINE="$(ROUGHNECK_PORT_BASE=7401 "$RN_DIR/roughneck" --no-open "$PROJ" 2>/dev/null | grep '^open:')"
case "$OPEN_LINE" in
  *token=*) echo "FAIL - open URL still contains a token: $OPEN_LINE"; fail=1 ;;
  *) echo "ok   - open URL has no token" ;;
esac
"$RN_DIR/roughneck" stop "$PROJ" >/dev/null 2>&1 || true
```

- [ ] **Step 2: Run the test to verify the new check fails**

Run: `bash test/confine.test.sh`
Expected: lines 1-6 pass, line 7 prints `FAIL - open URL still contains a token` (the CLI
still launches `child.js` and appends `&token=…`).

- [ ] **Step 3: Rewrite `start_server` to launch the gatekeeper without a token**

In `roughneck`, replace the `start_server()` body (the `child.js` launch block) with:

```bash
# Starts a gatekeeper server for $1 bound to $2. Prints "port".
start_server(){
  local folder="$1" bind="$2" port pid tmp
  port="$(free_port)"
  ROUGHDRAFT_BIND_HOST="$bind" \
    nohup node "$RN_ASSETS/roughneck-server.mjs" \
      --port "$port" --project-dir "$folder" --host "$bind" --rd-root "$RD_ROOT" \
    > "$STATE_DIR/roughneck-$port.log" 2>&1 &
  pid=$!
  disown 2>/dev/null || true
  if ! curl -s --retry 20 --retry-delay 1 --retry-connrefused -o /dev/null "http://127.0.0.1:$port/"; then
    die "server failed to start (see $STATE_DIR/roughneck-$port.log)"
  fi
  tmp="$(mktemp)"
  jq --arg f "$folder" --argjson port "$port" --argjson pid "$pid" \
     '.[$f] = {port:$port, pid:$pid}' "$STATE" > "$tmp" && mv "$tmp" "$STATE"
  printf '%s' "$port"
}
```

- [ ] **Step 4: Update callers + URL printing to drop the token**

In `roughneck`, change `server_for_folder()` to print only the port (drop the token field):

```bash
# Prints "port" and returns 0 if a live server already serves $1, else returns 1.
server_for_folder(){
  local folder="$1" port pid status
  port="$(jq -r --arg f "$folder" '.[$f].port // empty' "$STATE")"
  [ -z "$port" ] && return 1
  pid="$(jq -r --arg f "$folder" '.[$f].pid // empty' "$STATE")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    status="$(curl -s "http://127.0.0.1:$port/api/status" 2>/dev/null)"
    if printf '%s' "$status" | jq -e --arg f "$folder" '.projectDir == $f' >/dev/null 2>&1; then
      printf '%s' "$port"; return 0
    fi
  fi
  return 1
}
```

Update the two read sites and URL builders. Replace:

```bash
read -r PORT TOKEN < <(server_for_folder "$FOLDER" || true)
if [ -z "${PORT:-}" ]; then
  read -r PORT TOKEN < <(start_server "$FOLDER" "$BIND")
  STARTED=1
else
  STARTED=0
fi
```

with:

```bash
PORT="$(server_for_folder "$FOLDER" || true)"
if [ -z "${PORT:-}" ]; then
  PORT="$(start_server "$FOLDER" "$BIND")"
  STARTED=1
else
  STARTED=0
fi
```

And replace the URL-building block:

```bash
if [ -n "$FILE_REL" ]; then
  URL="$BASE/?path=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$FILE_REL")&token=$TOKEN"
else
  URL="$BASE/?token=$TOKEN"
fi
```

with:

```bash
if [ -n "$FILE_REL" ]; then
  URL="$BASE/?path=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$FILE_REL")"
else
  URL="$BASE/"
fi
```

- [ ] **Step 5: Run the full test to verify it passes**

Run: `bash test/confine.test.sh`
Expected: all seven checks print `ok - …`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add roughneck test/confine.test.sh
git commit --no-gpg-sign -m "feat: launch gatekeeper from CLI, drop token from state and URLs"
```

---

## Task 3: Revert the `abs()` enhancer hack (back to relative links)

**Files:**
- Modify: `assets/roughneck-enhance.js` (the `abs()` helper + 3 call sites added earlier)

The gatekeeper now supplies the project root server-side, so doc links must be relative again.

- [ ] **Step 1: Remove the wikilink `abs()` helper and unwrap `navTo`**

In `assets/roughneck-enhance.js`, find:

```js
    // Roughdraft's AG() splits ?path= at the last slash to derive projectPath
    // (dirname) + documentPath (basename), so the link MUST be the absolute path.
    function abs(p) { return /^([a-zA-Z]:[\\/]|\/)/.test(p) ? p : projectDir.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, ''); }
    function navTo(path) { var u = new URL(window.location.href); u.pathname = '/'; u.searchParams.set('path', abs(path)); window.location.assign(u.pathname + u.search); }
```

Replace with:

```js
    function navTo(path) { var u = new URL(window.location.href); u.pathname = '/'; u.searchParams.set('path', path); window.location.assign(u.pathname + u.search); }
```

- [ ] **Step 2: Remove the folder-browser `abs()` helper and unwrap `openPath`**

Find:

```js
    function hasFiles(n) { if (n.files.length) return true; return Object.keys(n.dirs).some(function (k) { return hasFiles(n.dirs[k]); }); }
    // Absolute path required: Roughdraft derives projectPath from dirname(?path=).
    function abs(p) { return /^([a-zA-Z]:[\\/]|\/)/.test(p) ? p : projectDir.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, ''); }
    function openPath(path) { var u = new URL(window.location.href); u.pathname = '/'; u.searchParams.set('path', abs(path)); window.location.assign(u.pathname + u.search); }
```

Replace with:

```js
    function hasFiles(n) { if (n.files.length) return true; return Object.keys(n.dirs).some(function (k) { return hasFiles(n.dirs[k]); }); }
    function openPath(path) { var u = new URL(window.location.href); u.pathname = '/'; u.searchParams.set('path', path); window.location.assign(u.pathname + u.search); }
```

- [ ] **Step 3: Unwrap the anchor href**

Find:

```js
        a.textContent = '📄 ' + f.name; a.href = '/?path=' + encodeURIComponent(abs(f.path)); a.title = f.path;
```

Replace with:

```js
        a.textContent = '📄 ' + f.name; a.href = '/?path=' + encodeURIComponent(f.path); a.title = f.path;
```

- [ ] **Step 4: Verify no `abs(` references remain**

Run: `grep -n "abs(" assets/roughneck-enhance.js`
Expected: no output (exit 1) — every `abs()` reference is gone.

- [ ] **Step 5: Commit**

```bash
git add assets/roughneck-enhance.js
git commit --no-gpg-sign -m "revert: relative doc links in enhancer (gatekeeper pins the root)"
```

---

## Task 4: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Drop the token from documented URLs and state the new model**

In `README.md`, find the "Defaults:" help block (lines ~7-10 of the embedded usage) and the
description of how to open a doc. Ensure no example URL contains `?token=` or `&token=`, and
add one sentence under Defaults:

```markdown
Each server is **confined to FOLDER** — it can only read markdown inside it (paths that
escape return 403) — and runs **without a token**. Bound to your LAN (0.0.0.0) by default so
other devices can reach it at `http://<this-host>.local:<port>/?path=<relative.md>`; use
`--local` to bind loopback only.
```

- [ ] **Step 2: Verify no token references remain in the README**

Run: `grep -ni "token" README.md`
Expected: no output (exit 1).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit --no-gpg-sign -m "docs: README reflects confinement + no-token, relative URLs"
```

---

## Manual verification (after all tasks)

Run against the real ICR folder, from another device on the LAN:

```bash
roughneck --no-open /Users/claudius/github/icr/project
```

- [ ] Open `http://<host>:<port>/` — folder browser lists docs; clicking `icr-v1.md` opens it; the address bar shows `?path=icr-v1.md` (no absolute path, no token).
- [ ] `curl ".../api/markdown-file?path=CLAUDE.md&projectPath=/Users/claudius/github/icr"` → **not 200** (the supplied parent `projectPath` is ignored and reinterpreted inside `project/`, where `CLAUDE.md` doesn't exist → 404; the parent-folder hole from today is closed).
- [ ] Reachable from your phone/iPad on the LAN with the bare URL (no token); re-run with `--local` and confirm it's *not* reachable from the LAN.

---

## Self-Review

**Spec coverage:**
- Clean relative URLs → Task 1 (pin `projectPath`) + Task 3 (relative enhancer links). ✓
- Confinement / 403 on escape → Task 1 guard + tests 2-4. ✓
- Block `/api/remote-document/*` → Task 1 guard + test 5. ✓
- No token, LAN default, `--local` → Task 2 (drop token) + manual verification. ✓
- Keep importing Roughdraft updates → Task 1 imports `createApp`, fails loud if absent; no
  patch of Roughdraft internals for the boundary. ✓ (Spec "update resilience" smoke is covered
  by re-running `test/confine.test.sh` after an upgrade.)
- Revert `abs()` → Task 3. ✓

**Placeholder scan:** none — every code/command step shows full content.

**Type/name consistency:** entry CLI contract `--port/--project-dir/--host/--rd-root` is
identical in the entry (Task 1), the test harness (Task 1 Step 1), and the CLI launch (Task 2
Step 3). `inside()` / `projectDir` defined and used consistently within Task 1.
