import unittest

from runner.margins_log import (
    activity_log_path,
    append_activity_line,
    build_reply_entry,
    find_pending,
    parse_activity_log,
)


class TestActivityLogPath(unittest.TestCase):
    def test_maps_under_dot_margins(self):
        self.assertEqual(
            activity_log_path("docs/intro.md"),
            ".margins/docs/intro.md.activity.jsonl",
        )


class TestParse(unittest.TestCase):
    def test_parses_user_and_agent_entries(self):
        text = (
            '{"id":"i1","at":"t","by":"u","role":"user","type":"comments","instruction":"go"}\n'
            '{"id":"a1","at":"t","by":"agent","role":"agent","replyTo":"i1","status":"done","summary":"did it"}\n'
        )
        entries = parse_activity_log(text)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["role"], "user")
        self.assertEqual(entries[1]["replyTo"], "i1")

    def test_skips_blank_and_garbled_lines(self):
        text = (
            "\n"
            "not json\n"
            '{"id":"i1","at":"t","by":"u","role":"user","type":"custom","instruction":"x"}\n'
            '{"role":"user","id":"bad"}\n'  # missing type/instruction -> invalid
        )
        entries = parse_activity_log(text)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["id"], "i1")

    def test_rejects_agent_with_bad_status(self):
        text = '{"id":"a1","at":"t","by":"agent","role":"agent","replyTo":"i1","status":"weird","summary":"s"}\n'
        self.assertEqual(parse_activity_log(text), [])


class TestAppend(unittest.TestCase):
    def test_appends_with_single_trailing_newline(self):
        entry = {"id": "a1", "role": "agent"}
        self.assertEqual(
            append_activity_line("", entry),
            '{"id":"a1","role":"agent"}\n',
        )

    def test_adds_missing_newline_before_appending(self):
        out = append_activity_line('{"id":"i1"}', {"id": "a1"})
        self.assertEqual(out, '{"id":"i1"}\n{"id":"a1"}\n')


class TestFindPending(unittest.TestCase):
    def test_returns_instructions_without_reply_oldest_first(self):
        entries = [
            {"id": "i1", "role": "user", "type": "comments", "instruction": "a"},
            {"id": "i2", "role": "user", "type": "rewrite", "instruction": "b"},
            {"id": "a1", "role": "agent", "replyTo": "i1", "status": "done", "summary": "s"},
        ]
        pending = find_pending(entries)
        self.assertEqual([p["id"] for p in pending], ["i2"])


class TestBuildReply(unittest.TestCase):
    def test_done_reply_includes_commit_not_error(self):
        entry = build_reply_entry(
            instruction_id="i1", status="done", summary="rewrote intro",
            by="agent", at="2026-06-13T00:00:00.000Z", uid="a1", commit="abc123",
        )
        self.assertEqual(
            entry,
            {
                "id": "a1", "at": "2026-06-13T00:00:00.000Z", "by": "agent",
                "role": "agent", "replyTo": "i1", "status": "done",
                "summary": "rewrote intro", "commit": "abc123",
            },
        )

    def test_error_reply_includes_error_not_commit(self):
        entry = build_reply_entry(
            instruction_id="i1", status="error", summary="failed",
            by="agent", at="t", uid="a1", error="boom",
        )
        self.assertNotIn("commit", entry)
        self.assertEqual(entry["error"], "boom")
        self.assertEqual(entry["status"], "error")
