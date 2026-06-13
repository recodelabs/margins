"""Pure activity-log format helpers — Python parity of app/src/activity-log.ts.

One append-only JSONL file per doc at `.margins/<docPath>.activity.jsonl`,
holding `user` instruction entries and `agent` reply entries.
"""

from __future__ import annotations

import json
from typing import Any


def activity_log_path(doc_path: str) -> str:
    """`.margins/<docPath>.activity.jsonl` — mirrors the doc's path."""
    return f".margins/{doc_path}.activity.jsonl"


def _is_entry(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if not isinstance(value.get("id"), str):
        return False
    role = value.get("role")
    if role == "user":
        return isinstance(value.get("type"), str) and isinstance(
            value.get("instruction"), str
        )
    if role == "agent":
        return (
            isinstance(value.get("replyTo"), str)
            and value.get("status") in ("done", "error")
            and isinstance(value.get("summary"), str)
        )
    return False


def parse_activity_log(text: str) -> list[dict]:
    """Parse JSONL line-by-line, skipping blank or malformed lines."""
    entries: list[dict] = []
    for line in text.split("\n"):
        trimmed = line.strip()
        if not trimmed:
            continue
        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError:
            continue
        if _is_entry(parsed):
            entries.append(parsed)
    return entries


def append_activity_line(text: str, entry: dict) -> str:
    """Append one compact JSON line, ensuring exactly one trailing newline."""
    base = text if text == "" or text.endswith("\n") else text + "\n"
    line = json.dumps(entry, separators=(",", ":"), ensure_ascii=False)
    return f"{base}{line}\n"


def find_pending(entries: list[dict]) -> list[dict]:
    """User instructions with no matching agent reply, in file order (oldest first)."""
    replied = {e["replyTo"] for e in entries if e.get("role") == "agent"}
    return [
        e for e in entries if e.get("role") == "user" and e.get("id") not in replied
    ]


def build_reply_entry(
    *,
    instruction_id: str,
    status: str,
    summary: str,
    by: str,
    at: str,
    uid: str,
    commit: str | None = None,
    error: str | None = None,
) -> dict:
    """Construct an `agent` reply entry (key order matches AgentReplyEntry)."""
    entry: dict = {
        "id": uid,
        "at": at,
        "by": by,
        "role": "agent",
        "replyTo": instruction_id,
        "status": status,
        "summary": summary,
    }
    if commit is not None:
        entry["commit"] = commit
    if error is not None:
        entry["error"] = error
    return entry
