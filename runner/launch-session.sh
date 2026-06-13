#!/usr/bin/env bash
# Launch the strict runner session under the user's Claude subscription.
#   ./runner/launch-session.sh <clone-path> <state-dir>
# The session is gated by runner/guard.py (PreToolUse) so it can only edit the
# doc and run the wait script. No Agent SDK, no `claude -p` — a normal session.
set -euo pipefail

CLONE="${1:?usage: launch-session.sh <clone-path> <state-dir>}"
STATE="${2:?usage: launch-session.sh <clone-path> <state-dir>}"

CLONE="$(cd "$CLONE" && pwd -P)"
mkdir -p "$STATE"
STATE="$(cd "$STATE" && pwd -P)"
RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$RUNNER_DIR/.." && pwd -P)"

export MARGINS_RUNNER_CLONE="$CLONE"
export MARGINS_RUNNER_STATE="$STATE"
export MARGINS_RUNNER_INBOX="$STATE/inbox.json"

# Run from THIS repo (where runner/ lives) so `runner/wait-for-task.sh` and the
# guard hook ($CLAUDE_PROJECT_DIR/runner/guard.py) resolve, even when the watched
# content clone is a different repo. The clone and the state dir are granted via
# --add-dir; the guard confines every file edit to them by absolute path, so the
# session still cannot touch this repo's own files.
cd "$REPO_ROOT"
exec claude \
  --settings "$RUNNER_DIR/settings.json" \
  --add-dir "$CLONE" \
  --add-dir "$STATE" \
  "Use the margins-runner skill: enter the wait/apply loop now and keep running."
