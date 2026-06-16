"""Thin seam over the git commands the poller needs.

The clone is a normal local checkout with the user's GitHub auth already set up
(https credential helper or ssh). The poller is the ONLY component that runs git.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


class GitOps:
    def __init__(self, clone_path: str):
        self.clone = clone_path

    def _git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.clone,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout

    def pull(self, branch: str) -> None:
        """Reconcile the branch with origin by merging. Not fast-forward-only:
        the hosted app commits straight to origin, so the branch routinely
        diverges from local, and ff-only would stall the poller permanently."""
        self._git("checkout", branch)
        self.fetch_and_merge(branch)

    def fetch_and_merge(self, branch: str) -> None:
        """Fetch origin and merge it into the current branch. On conflict, abort
        and re-raise so a half-merged tree is never committed; the caller treats a
        conflict as a transient error and retries next cycle."""
        self._git("fetch", "origin", branch)
        try:
            self._git("merge", "--no-edit", f"origin/{branch}")
        except subprocess.CalledProcessError:
            self._git("merge", "--abort")
            raise

    def push(self, branch: str) -> None:
        self._git("push", "origin", branch)

    def try_push(self, branch: str) -> bool:
        """Push, returning False if rejected (e.g. origin advanced) instead of
        raising, so the caller can merge origin in and retry."""
        try:
            self._git("push", "origin", branch)
            return True
        except subprocess.CalledProcessError:
            return False

    def read_file(self, rel_path: str) -> str:
        return Path(self.clone, rel_path).read_text(encoding="utf-8")

    def write_file(self, rel_path: str, text: str) -> None:
        Path(self.clone, rel_path).write_text(text, encoding="utf-8")

    def checkout_file(self, rel_path: str) -> None:
        """Reset one file to its committed state (discard working-tree edits)."""
        self._git("checkout", "--", rel_path)

    def commit(self, rel_paths: list[str], message: str) -> str:
        """Stage the paths and commit; return the HEAD sha. A no-op commit
        (nothing changed) still returns the current HEAD sha rather than erroring."""
        self._git("add", "--", *rel_paths)
        status = self._git("status", "--porcelain")
        if status.strip():
            self._git("commit", "-m", message)
        return self._git("rev-parse", "HEAD").strip()

    def list_activity_logs(self) -> dict[str, str]:
        """Map every `.margins/**/*.activity.jsonl` (repo-relative path) to its text."""
        logs: dict[str, str] = {}
        root = Path(self.clone, ".margins")
        if not root.is_dir():
            return logs
        for path in sorted(root.rglob("*.activity.jsonl")):
            rel = os.path.relpath(path, self.clone)
            logs[rel] = path.read_text(encoding="utf-8")
        return logs
