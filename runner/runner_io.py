"""Inbox/done state handoff between the poller and the strict session.

State lives OUTSIDE the clone (default ~/.margins-runner/<repo>/) so it never
pollutes the repo. The poller writes inbox.json; the session writes done.json.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


class StateIO:
    def __init__(self, state_dir: str):
        self.state_dir = state_dir
        os.makedirs(state_dir, exist_ok=True)
        self.inbox_path = os.path.join(state_dir, "inbox.json")
        self.done_path = os.path.join(state_dir, "done.json")

    def write_inbox(self, task: dict) -> None:
        """Atomically write the task file (temp + rename) so the session never
        reads a half-written inbox."""
        tmp = self.inbox_path + ".tmp"
        Path(tmp).write_text(json.dumps(task), encoding="utf-8")
        os.replace(tmp, self.inbox_path)

    def task_pending(self) -> bool:
        return Path(self.inbox_path).is_file()

    def read_done(self) -> dict | None:
        """Return the parsed done sentinel, or None if absent or not yet fully
        written (partial writes parse as None, not a crash)."""
        try:
            text = Path(self.done_path).read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    def clear_task(self) -> None:
        for p in (self.inbox_path, self.done_path):
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
