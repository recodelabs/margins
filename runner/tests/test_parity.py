import json
import unittest

from runner.margins_log import (
    append_activity_line,
    build_reply_entry,
    find_pending,
    parse_activity_log,
)

# These two lines are shaped exactly as app/src/activity-log.ts emits/consumes.
SP1_USER_LINE = (
    '{"id":"7b1","at":"2026-06-13T12:00:00.000Z","by":"mberg",'
    '"role":"user","type":"comments","instruction":"apply the comments"}'
)
SP1_AGENT_LINE = (
    '{"id":"9c2","at":"2026-06-13T12:05:00.000Z","by":"agent",'
    '"role":"agent","replyTo":"7b1","status":"done","summary":"applied 3 comments","commit":"deadbeef"}'
)


class TestParity(unittest.TestCase):
    def test_parses_sp1_lines(self):
        entries = parse_activity_log(SP1_USER_LINE + "\n" + SP1_AGENT_LINE + "\n")
        self.assertEqual(len(entries), 2)
        # The agent reply resolves the user instruction -> nothing pending.
        self.assertEqual(find_pending(entries), [])

    def test_user_line_alone_is_pending(self):
        entries = parse_activity_log(SP1_USER_LINE + "\n")
        self.assertEqual([e["id"] for e in find_pending(entries)], ["7b1"])

    def test_appended_reply_is_valid_jsonl_and_reparses(self):
        reply = build_reply_entry(
            instruction_id="7b1", status="done", summary="applied 3 comments",
            by="agent", at="2026-06-13T12:05:00.000Z", uid="9c2", commit="deadbeef",
        )
        text = append_activity_line(SP1_USER_LINE + "\n", reply)
        # Every non-blank line must be valid JSON on its own.
        for line in text.splitlines():
            json.loads(line)
        reparsed = parse_activity_log(text)
        self.assertEqual(find_pending(reparsed), [])
