import unittest

from runner.sanitize import unwrap_block_highlights


class TestUnwrapBlockHighlights(unittest.TestCase):
    def test_inline_highlight_untouched(self):
        text = "Some {==highlighted span==}{>>note<<} in a line."
        self.assertEqual(unwrap_block_highlights(text), text)

    def test_comment_markers_untouched(self):
        text = "A {>>standalone comment<<}{id=\"c1\"} stays."
        self.assertEqual(unwrap_block_highlights(text), text)

    def test_unwraps_highlight_with_code_fence(self):
        text = '{==**Intro.** Here it is:\n\n```json\n{"a": 1}\n```\n==}{>>ADDED<<}'
        out = unwrap_block_highlights(text)
        self.assertNotIn("{==", out)
        # delimiters gone, content + trailing comment preserved
        self.assertIn("**Intro.**", out)
        self.assertIn('```json', out)
        self.assertIn("{>>ADDED<<}", out)

    def test_unwraps_highlight_spanning_blank_line(self):
        text = "{==First para.\n\nSecond para.==}{>>ADDED<<}"
        out = unwrap_block_highlights(text)
        self.assertNotIn("{==", out)
        self.assertIn("First para.", out)
        self.assertIn("Second para.", out)

    def test_nested_inline_highlight_preserved_when_outer_unwrapped(self):
        # Outer block-spanning wrapper contains an inner inline highlight (e.g. a
        # user comment on a span inside a table). Only the outer is removed.
        text = (
            "{==**Section.** A table:\n\n"
            "| x | {==GRID3==}{>>use WorldPop<<} |\n\n"
            "more text.==}{>>ADDED<<}"
        )
        out = unwrap_block_highlights(text)
        # inner inline highlight survives intact
        self.assertIn("{==GRID3==}{>>use WorldPop<<}", out)
        # outer wrapper delimiters are gone (exactly one {== remains: the inner)
        self.assertEqual(out.count("{=="), 1)
        self.assertEqual(out.count("==}"), 1)
        self.assertIn("**Section.**", out)

    def test_multiple_block_highlights_all_unwrapped(self):
        text = (
            "{==A:\n\n```\nx\n```\n==}{>>n1<<}\n\n"
            "{==B:\n\n```\ny\n```\n==}{>>n2<<}"
        )
        out = unwrap_block_highlights(text)
        self.assertNotIn("{==", out)
        self.assertIn("{>>n1<<}", out)
        self.assertIn("{>>n2<<}", out)

    def test_unmatched_close_left_alone(self):
        text = "stray ==} marker and an inline {==ok==}."
        self.assertEqual(unwrap_block_highlights(text), text)

    def test_no_highlights_is_identity(self):
        text = "# Title\n\nPlain prose with `inline code` and a list:\n\n- a\n- b\n"
        self.assertEqual(unwrap_block_highlights(text), text)


if __name__ == "__main__":
    unittest.main()
