# Copyright (c) 2026, KQS
"""Layby Settlement mode — non-cash tender on completion Sales Invoice only."""

from __future__ import annotations

import frappe
from frappe.utils import flt

LAYBY_SETTLEMENT_MODE_CANDIDATES = ("Layby Settlement",)


def resolve_layby_settlement_mode() -> str | None:
	for name in LAYBY_SETTLEMENT_MODE_CANDIDATES:
		if frappe.db.exists("Mode of Payment", name):
			return name
	return None


def is_layby_settlement_mode(mode_of_payment: str | None) -> bool:
	if not mode_of_payment:
		return False
	resolved = resolve_layby_settlement_mode()
	return mode_of_payment == resolved or mode_of_payment in LAYBY_SETTLEMENT_MODE_CANDIDATES


def get_layby_settlement_payment_amount(doc) -> float:
	total = 0.0
	for row in doc.get("payments") or []:
		if is_layby_settlement_mode(row.mode_of_payment):
			total += flt(row.amount)
	return total


def ensure_settlement_mode_or_throw() -> str:
	"""Return MoP name; create if missing (completion must never fall back to Cash)."""
	from kqs_retail.setup.layby_settlement import ensure_layby_settlement_mode_of_payment

	name = ensure_layby_settlement_mode_of_payment()
	if not name:
		frappe.throw(frappe._("Layby Settlement mode of payment is not configured."))
	return name
