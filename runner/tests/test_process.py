import unittest

from runner.config import Config
from runner.poller import Deps, process_one


class FakeGit:
    def __init__(self, logs, files):
        self._logs = dict(logs)
        self._files = dict(files)
        self.pulled = False
        self.pushed = False
        self.checked_out = []
        self.commits = []  # (paths, message)

    def pull(self, branch):
        self.pulled = True

    def push(self, branch):
        self.pushed = True

    def list_activity_logs(self):
        return dict(self._logs)

    def read_file(self, path):
        return self._files.get(path, self._logs.get(path, ""))

    def write_file(self, path, text):
        if path in self._logs or path.endswith(".activity.jsonl"):
            self._logs[path] = text
        else:
            self._files[path] = text

    def checkout_file(self, path):
        self.checked_out.append(path)

    def commit(self, paths, message):
        self.commits.append((list(paths), message))
        return f"sha{len(self.commits)}" + "0" * 36


class FakeState:
    def __init__(self, done):
        self._done = done
        self.inbox = None
        self.cleared = False

    def write_inbox(self, task):
        self.inbox = task

    def task_pending(self):
        return self.inbox is not None and not self.cleared

    def read_done(self):
        return self._done

    def clear_task(self):
        self.cleared = True


CONFIG = Config(clone_path="/c", state_dir="/s", branch="main", agent_by="agent")


def _deps(git, state, done):
    return Deps(
        git=git,
        state=state,
        now=lambda: "2026-06-13T00:00:00.000Z",
        uuid=lambda: "uid-1",
        sleep=lambda s: None,
    )


class TestProcessOne(unittest.TestCase):
    def _logs_with_one_pending(self):
        return {
            ".margins/a.md.activity.jsonl":
                '{"id":"i1","at":"t","by":"u","role":"user","type":"comments","instruction":"apply"}\n'
        }

    def test_no_pending_returns_false(self):
        git = FakeGit({".margins/a.md.activity.jsonl":
            '{"id":"i1","at":"t","by":"u","role":"user","type":"custom","instruction":"x"}\n'
            '{"id":"a1","at":"t","by":"agent","role":"agent","replyTo":"i1","status":"done","summary":"s"}\n'
        }, {})
        state = FakeState(done=None)
        handled = process_one(_deps(git, state, None), CONFIG)
        self.assertFalse(handled)
        self.assertIsNone(state.inbox)

    def test_done_path_commits_doc_then_appends_reply(self):
        git = FakeGit(self._logs_with_one_pending(), {"a.md": "# Title\n"})
        state = FakeState(done={"status": "done", "summary": "applied 2 comments", "replyTo": "i1"})
        handled = process_one(_deps(git, state, state._done), CONFIG)

        self.assertTrue(handled)
        # Doc reset before handing to the session.
        self.assertEqual(git.checked_out, ["a.md"])
        # Inbox carried the instruction.
        self.assertEqual(state.inbox["instructionId"], "i1")
        self.assertEqual(state.inbox["docPath"], "a.md")
        # Two commits: the doc, then the log.
        self.assertEqual(git.commits[0][0], ["a.md"])
        self.assertEqual(git.commits[1][0], [".margins/a.md.activity.jsonl"])
        self.assertTrue(git.pushed)
        self.assertTrue(state.cleared)
        # The appended reply references the doc commit sha and is valid.
        from runner.margins_log import parse_activity_log, find_pending
        entries = parse_activity_log(git._logs[".margins/a.md.activity.jsonl"])
        self.assertEqual(find_pending(entries), [])      # i1 now resolved
        reply = [e for e in entries if e.get("role") == "agent"][0]
        self.assertEqual(reply["status"], "done")
        self.assertEqual(reply["summary"], "applied 2 comments")
        # The doc commit is the first commit; FakeGit returns "sha1" + 36 zeros.
        self.assertEqual(reply["commit"], "sha1" + "0" * 36)

    def test_error_done_appends_error_reply_without_doc_commit(self):
        git = FakeGit(self._logs_with_one_pending(), {"a.md": "# Title\n"})
        state = FakeState(done={"status": "error", "summary": "could not apply", "replyTo": "i1", "error": "ambiguous"})
        process_one(_deps(git, state, state._done), CONFIG)

        # Only the log is committed (no doc commit).
        self.assertEqual(len(git.commits), 1)
        self.assertEqual(git.commits[0][0], [".margins/a.md.activity.jsonl"])
        from runner.margins_log import parse_activity_log
        reply = [e for e in parse_activity_log(git._logs[".margins/a.md.activity.jsonl"]) if e.get("role") == "agent"][0]
        self.assertEqual(reply["status"], "error")
        self.assertEqual(reply["error"], "ambiguous")
        self.assertNotIn("commit", reply)
        self.assertTrue(state.cleared)
        self.assertTrue(git.pushed)

    def test_timeout_appends_error_reply(self):
        git = FakeGit(self._logs_with_one_pending(), {"a.md": "# Title\n"})
        state = FakeState(done=None)  # session never writes done.json
        process_one(_deps(git, state, None), CONFIG)
        from runner.margins_log import parse_activity_log
        reply = [e for e in parse_activity_log(git._logs[".margins/a.md.activity.jsonl"]) if e.get("role") == "agent"][0]
        self.assertEqual(reply["status"], "error")
        self.assertEqual(reply["error"], "timeout")
        self.assertTrue(state.cleared)
        self.assertTrue(git.pushed)
