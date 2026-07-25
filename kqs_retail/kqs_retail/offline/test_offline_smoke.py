# Copyright (c) 2026, KQS
"""Lightweight checks for offline event routing (no DB)."""

from __future__ import annotations


def test_event_types_match_doctype_options():
	from pathlib import Path
	import json

	json_path = (
		Path(__file__).resolve().parents[1]
		/ "kqs_layby"
		/ "doctype"
		/ "offline_sync_log"
		/ "offline_sync_log.json"
	)
	meta = json.loads(json_path.read_text(encoding="utf-8"))
	field = next(f for f in meta["fields"] if f["fieldname"] == "event_type")
	options = set(field["options"].split("\n"))
	expected = {
		"sale",
		"layby_create",
		"layby_payment",
		"layby_cancel",
		"layby_forfeit",
		"layby_amend",
		"return",
		"ar_payment",
	}
	assert options == expected


def test_sale_helper_importable():
	# Import path used by push_offline_event
	from kqs_retail.offline import sale  # noqa: F401
	from kqs_retail.offline import lease  # noqa: F401
	assert callable(sale.create_sales_invoice_from_offline)
	assert callable(lease.acquire_lease)
