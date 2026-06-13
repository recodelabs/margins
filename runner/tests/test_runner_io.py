import tempfile
import unittest
from pathlib import Path

from runner.runner_io import StateIO


class TestStateIO(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.state = StateIO(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_no_done_initially(self):
        self.assertIsNone(self.state.read_done())

    def test_write_inbox_creates_file(self):
        task = {"instructionId": "i1", "docPath": "a.md", "type": "custom", "instruction": "x"}
        self.state.write_inbox(task)
        self.assertTrue(Path(self.state.inbox_path).is_file())
        self.assertTrue(self.state.task_pending())

    def test_read_done_round_trip(self):
        done = {"status": "done", "summary": "ok", "replyTo": "i1"}
        Path(self.state.done_path).write_text("  " + __import__("json").dumps(done))
        self.assertEqual(self.state.read_done(), done)

    def test_read_done_ignores_partial_write(self):
        # A half-written JSON file must not crash the poller.
        Path(self.state.done_path).write_text('{"status": "do')
        self.assertIsNone(self.state.read_done())

    def test_clear_task_removes_both_files(self):
        self.state.write_inbox({"instructionId": "i1", "docPath": "a.md", "type": "x", "instruction": "y"})
        Path(self.state.done_path).write_text('{"status":"done","summary":"s","replyTo":"i1"}')
        self.state.clear_task()
        self.assertFalse(Path(self.state.inbox_path).exists())
        self.assertFalse(Path(self.state.done_path).exists())
        self.assertFalse(self.state.task_pending())
