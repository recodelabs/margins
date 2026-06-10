#!/usr/bin/env bash
# Integration test for the roughneck gatekeeper (assets/roughneck-server.mjs).
# Boots it against a temp folder and asserts confinement + clean-URL behavior.
set -uo pipefail

RN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$RN_DIR/assets/roughneck-server.mjs"
RD_ROOT="$(npm root -g)/roughdraft"
PORT="$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')"
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

# 7. percent-encoded dotdot traversal is decoded then blocked
check "pct-encoded dotdot blocked" 403 \
  "$(code "$BASE/api/markdown-file?path=%2e%2e%2fsecret.md")"

exit $fail
