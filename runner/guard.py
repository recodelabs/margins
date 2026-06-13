"""PreToolUse hook: hard allowlist for the strict runner session.

The session may ONLY:
  - Read/Edit/Write files inside the clone, or read/write the state dir
  - run one exact Bash wait command (and nothing else)
Everything else is denied. This is the safety guarantee: destructive tools are
never permitted, so a prompt-injection instruction has nothing to call.

Env (set by launch-session.sh):
  MARGINS_RUNNER_CLONE  - absolute path to the clone
  MARGINS_RUNNER_STATE  - absolute path to the state dir
"""

from __future__ import annotations

import json
import os
import sys

# The exact Bash invocations the session is allowed to run (the blocking wait).
WAIT_COMMANDS = (
    "bash runner/wait-for-task.sh",
    "bash ./runner/wait-for-task.sh",
)


def _within(path: str, base: str) -> bool:
    # Fail closed: an empty base (unset env var) must never match — otherwise
    # os.path.realpath("") would resolve to cwd and silently widen the sandbox.
    if not base or not path:
        return False
    real_base = os.path.realpath(base)
    real_path = os.path.realpath(path)
    return real_path == real_base or real_path.startswith(real_base + os.sep)


def enforce(tool_name: str, tool_input: dict, clone: str, state_dir: str) -> tuple[str, str]:
    """Return ("allow"|"deny", reason)."""
    if tool_name in ("Read", "Edit", "Write"):
        path = tool_input.get("file_path", "")
        if path and (_within(path, clone) or _within(path, state_dir)):
            return ("allow", "")
        return ("deny", f"{tool_name} is restricted to the clone and state dir")

    if tool_name == "Bash":
        command = (tool_input.get("command") or "").strip()
        if command in WAIT_COMMANDS:
            return ("allow", "")
        return ("deny", "the session may only run the wait script")

    return ("deny", f"tool '{tool_name}' is not permitted in strict runner mode")


def main() -> int:
    clone = os.environ.get("MARGINS_RUNNER_CLONE", "")
    state_dir = os.environ.get("MARGINS_RUNNER_STATE", "")
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}
    tool_name = payload.get("tool_name")
    if not isinstance(tool_name, str):
        tool_name = ""
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        tool_input = {}
    decision, reason = enforce(tool_name, tool_input, clone, state_dir)
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": decision,
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
