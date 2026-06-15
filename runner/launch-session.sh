#!/usr/bin/env bash
# Launch the strict runner session under the user's Claude subscription.
#   ./runner/launch-session.sh <clone-path> <state-dir>
#
# The session is gated by runner/guard.py (PreToolUse) so it can only edit the
# doc and run the wait script. It runs inside tmux so the kickoff prompt can be
# auto-submitted: Claude Code does NOT auto-run a positional prompt in an
# interactive session, so the session would otherwise sit idle at a blank prompt.
set -euo pipefail

CLONE="${1:?usage: launch-session.sh <clone-path> <state-dir>}"
STATE="${2:?usage: launch-session.sh <clone-path> <state-dir>}"

CLONE="$(cd "$CLONE" && pwd -P)"
mkdir -p "$STATE"
STATE="$(cd "$STATE" && pwd -P)"
RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$RUNNER_DIR/.." && pwd -P)"

command -v tmux >/dev/null 2>&1 || { echo "tmux is required: brew install tmux"; exit 1; }

# Ensure the margins-runner skill is discoverable to the session (the strict
# session is told to "use the margins-runner skill" — it must be installed).
SKILL_LINK="$HOME/.claude/skills/margins-runner"
if [ ! -e "$SKILL_LINK" ]; then
  mkdir -p "$HOME/.claude/skills"
  ln -sfn "$RUNNER_DIR/../skills/margins-runner" "$SKILL_LINK"
  echo "installed margins-runner skill -> $SKILL_LINK"
fi

SESSION="margins-runner-$(basename "$CLONE")"
KICK="Use the margins-runner skill: enter the wait/apply loop now and keep running."

# Run from THIS repo (where runner/ lives) so runner/wait-for-task.sh and the
# guard hook ($CLAUDE_PROJECT_DIR/runner/guard.py) resolve, even when the watched
# content clone is a different repo. The clone and state dir are granted via
# --add-dir; the guard confines every file edit to them by absolute path.
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x 220 -y 50
tmux send-keys -t "$SESSION" "cd '$REPO_ROOT' && \
  MARGINS_RUNNER_CLONE='$CLONE' MARGINS_RUNNER_STATE='$STATE' MARGINS_RUNNER_INBOX='$STATE/inbox.json' \
  claude --settings '$RUNNER_DIR/settings.json' --add-dir '$CLONE' --add-dir '$STATE'" Enter

# Let Claude boot, then submit the kickoff prompt (positional args don't auto-run).
sleep 8
tmux send-keys -t "$SESSION" "$KICK"
sleep 1
tmux send-keys -t "$SESSION" Enter

echo "Responder running in tmux session '$SESSION' (interactive Claude, your subscription)."
echo "  watch:  tmux attach -t $SESSION        (detach: Ctrl-b then d)"
echo "  stop:   tmux kill-session -t $SESSION"
