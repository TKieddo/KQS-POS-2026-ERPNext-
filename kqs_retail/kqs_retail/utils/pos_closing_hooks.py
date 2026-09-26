# Copyright (c) 2026, KQS
"""POS Closing Entry hooks — always rewrite expected tender with till extras."""

from __future__ import annotations

from kqs_retail.utils.closing_till_totals import apply_till_extras_to_closing


def validate(doc, method=None) -> None:
	if doc.docstatus != 0:
		return
	if not doc.pos_opening_entry:
		return
	apply_till_extras_to_closing(doc, persist_breakdown=False)


def before_submit(doc, method=None) -> None:
	if not doc.pos_opening_entry:
		return
	apply_till_extras_to_closing(doc, persist_breakdown=True)
