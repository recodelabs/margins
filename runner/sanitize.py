"""Defensive cleanup of agent doc edits before the poller commits them.

The strict session sometimes wraps a whole section — heading, paragraphs, a
fenced code block, even a nested inline highlight — in a single CriticMarkup
highlight ``{==...==}`` (the doc's "mark ADDED content" convention). CriticMarkup
highlights are *inline only*; when one spans a block boundary the roughdraft /
TipTap renderer can't parse it and leaks the raw ``{==`` onto the page.

This is a pure function the poller runs on the doc before committing, so the bug
never reaches the reader regardless of what the agent produced.
"""

from __future__ import annotations

import re

_OPEN = "{=="
_CLOSE = "==}"
_TOKEN = re.compile(r"\{==|==\}")


def _matched_pairs(text: str) -> list[tuple[int, int]]:
    """Pair every ``{==`` with its closing ``==}`` using a stack, so nested
    highlights (an outer wrapper containing an inner inline highlight) pair
    correctly. Returns (open_pos, close_pos) for each pair; unmatched tokens are
    ignored (fail-open — never corrupt the doc)."""
    stack: list[int] = []
    pairs: list[tuple[int, int]] = []
    for m in _TOKEN.finditer(text):
        if m.group() == _OPEN:
            stack.append(m.start())
        elif stack:
            pairs.append((stack.pop(), m.start()))
    return pairs


def _is_block_spanning(span: str) -> bool:
    """A highlight is block-spanning (and so unrenderable) if its inner text
    crosses a block boundary: a fenced code block or a blank line."""
    return "```" in span or "\n\n" in span


def unwrap_block_highlights(text: str) -> str:
    """Remove the ``{==`` / ``==}`` delimiters of every block-spanning highlight,
    keeping the inner content (including any nested inline highlights/comments).
    Inline highlights and all ``{>>...<<}`` comments are left untouched."""
    cuts: list[tuple[int, int]] = []
    for open_pos, close_pos in _matched_pairs(text):
        if _is_block_spanning(text[open_pos + len(_OPEN) : close_pos]):
            cuts.append((open_pos, open_pos + len(_OPEN)))
            cuts.append((close_pos, close_pos + len(_CLOSE)))
    for start, end in sorted(cuts, reverse=True):
        text = text[:start] + text[end:]
    return text
