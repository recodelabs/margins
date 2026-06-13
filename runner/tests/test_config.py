import json
import tempfile
import unittest
from pathlib import Path

from runner.config import Config, load_config


class TestConfig(unittest.TestCase):
    def _write(self, data: dict) -> str:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, tmp)
        tmp.close()
        return tmp.name

    def test_loads_required_fields_and_defaults(self):
        path = self._write({"clonePath": "/tmp/clone", "stateDir": "/tmp/state"})
        cfg = load_config(path)
        self.assertEqual(cfg.clone_path, "/tmp/clone")
        self.assertEqual(cfg.state_dir, "/tmp/state")
        self.assertEqual(cfg.branch, "main")          # default
        self.assertEqual(cfg.poll_seconds, 120)        # default
        self.assertEqual(cfg.agent_by, "agent")        # default
        self.assertEqual(cfg.task_timeout_seconds, 600)  # default

    def test_overrides_defaults(self):
        path = self._write({
            "clonePath": "/c", "stateDir": "/s", "branch": "dev",
            "pollSeconds": 30, "agentBy": "amadeus", "taskTimeoutSeconds": 90,
        })
        cfg = load_config(path)
        self.assertEqual(cfg.branch, "dev")
        self.assertEqual(cfg.poll_seconds, 30)
        self.assertEqual(cfg.agent_by, "amadeus")
        self.assertEqual(cfg.task_timeout_seconds, 90)

    def test_missing_required_raises(self):
        path = self._write({"stateDir": "/s"})  # no clonePath
        with self.assertRaises(ValueError):
            load_config(path)
