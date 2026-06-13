#!/usr/bin/env bash
# The ONLY shell command the strict runner session is permitted to run.
# Blocks until the poller drops an inbox task, then exits 0. Takes no arguments
# and can do nothing else — so allowing it grants the session no real power.
set -euo pipefail

INBOX="${MARGINS_RUNNER_INBOX:?MARGINS_RUNNER_INBOX must be set by launch-session.sh}"

while [ ! -f "$INBOX" ]; do
  sleep 2
done
