"""Runner configuration loaded from config.json."""

from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    clone_path: str
    state_dir: str
    branch: str = "main"
    poll_seconds: int = 120
    agent_by: str = "agent"
    task_timeout_seconds: int = 600


def load_config(path: str) -> Config:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    for required in ("clonePath", "stateDir"):
        if not data.get(required):
            raise ValueError(f"config.json missing required field: {required}")
    return Config(
        clone_path=data["clonePath"],
        state_dir=data["stateDir"],
        branch=data.get("branch", "main"),
        poll_seconds=int(data.get("pollSeconds", 120)),
        agent_by=data.get("agentBy", "agent"),
        task_timeout_seconds=int(data.get("taskTimeoutSeconds", 600)),
    )
