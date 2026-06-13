import subprocess
import tempfile
import unittest
from pathlib import Path

from runner.git_ops import GitOps


def _run(cwd, *args):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


class TestGitOps(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.clone = self._tmp.name
        _run(self.clone, "git", "init", "-q")
        _run(self.clone, "git", "config", "user.email", "t@t.t")
        _run(self.clone, "git", "config", "user.name", "t")
        Path(self.clone, ".margins", "docs").mkdir(parents=True)
        Path(self.clone, ".margins", "docs", "a.md.activity.jsonl").write_text(
            '{"id":"i1","at":"t","by":"u","role":"user","type":"custom","instruction":"x"}\n'
        )
        Path(self.clone, "a.md").write_text("# Hi\n")
        _run(self.clone, "git", "add", "-A")
        _run(self.clone, "git", "commit", "-q", "-m", "init")
        self.git = GitOps(self.clone)

    def tearDown(self):
        self._tmp.cleanup()

    def test_list_activity_logs(self):
        logs = self.git.list_activity_logs()
        self.assertIn(".margins/docs/a.md.activity.jsonl", logs)
        self.assertTrue(logs[".margins/docs/a.md.activity.jsonl"].startswith('{"id":"i1"'))

    def test_read_and_write_file(self):
        self.assertEqual(self.git.read_file("a.md"), "# Hi\n")
        self.git.write_file("a.md", "# Bye\n")
        self.assertEqual(self.git.read_file("a.md"), "# Bye\n")

    def test_checkout_file_discards_changes(self):
        self.git.write_file("a.md", "garbage\n")
        self.git.checkout_file("a.md")
        self.assertEqual(self.git.read_file("a.md"), "# Hi\n")

    def test_commit_returns_sha_and_records_change(self):
        self.git.write_file("a.md", "# Edited\n")
        sha = self.git.commit(["a.md"], "agent: edit")
        self.assertEqual(len(sha), 40)
        log = subprocess.run(
            ["git", "log", "-1", "--pretty=%s"], cwd=self.clone,
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        self.assertEqual(log, "agent: edit")

    def test_commit_noop_when_nothing_staged_changed(self):
        # Committing an unchanged file must not raise.
        sha = self.git.commit(["a.md"], "agent: noop")
        self.assertEqual(len(sha), 40)
