# Copyright (c) 2026, KQS
"""
Default POS payment methods for every store profile.

Modes must exist in ERPNext (Accounting → Mode of Payment). This module adds any
missing rows to each POS Profile's Payments table — safe to re-run on migrate.
"""

from __future__ import annotations

import frappe
from frappe.utils import cint

from kqs_retail.utils.defaults import get_default_company

# First existing Mode of Payment name wins (handles M-Pesa vs Mpesa spelling in Desk).
KQS_DEFAULT_POS_PAYMENT_MODES: list[dict] = [
	{"candidates": ["Cash"], "default": True},
	{"candidates": ["Bank"], "default": False},
	{"candidates": ["Mpesa", "M-Pesa"], "default": False},
	{"candidates": ["Eco-Cash", "Ecocash"], "default": False},
	{"candidates": ["Store Credit", "Account Balance"], "default": False},
	{"candidates": ["On Account", "Account"], "default": False},
]


def _resolve_mode_of_payment(candidates: list[str]) -> str | None:
	for name in candidates:
		if frappe.db.exists("Mode of Payment", name):
			return name
	return None


def apply_manual_payment_policy(doc) -> bool:
	"""KQS policy: cashiers always enter tender — never auto-fill payment rows."""
	updated = False

	if doc.meta.has_field("set_grand_total_to_default_mop") and cint(doc.get("set_grand_total_to_default_mop")):
		doc.set_grand_total_to_default_mop = 0
		updated = True

	# ERPNext v15+ inverted checkbox on some sites.
	if doc.meta.has_field("disable_grand_total_to_default_mop") and not cint(
		doc.get("disable_grand_total_to_default_mop")
	):
		doc.disable_grand_total_to_default_mop = 1
		updated = True

	return updated


def enforce_manual_payment_entry(doc, method=None) -> None:
	"""Doc event: block re-enabling auto-fill on POS Profile save."""
	apply_manual_payment_policy(doc)


def enforce_all_pos_profiles_manual_payment() -> int:
	"""Ensure every POS Profile (including disabled) keeps manual-entry policy."""
	updated = 0
	for row in frappe.get_all("POS Profile", pluck="name"):
		doc = frappe.get_doc("POS Profile", row)
		if apply_manual_payment_policy(doc):
			doc.save(ignore_permissions=True)
			updated += 1
	return updated


def get_default_pos_payment_rows() -> list[dict]:
	"""Rows for POS Profile.payments — only modes that exist in the site."""
	rows: list[dict] = []
	for spec in KQS_DEFAULT_POS_PAYMENT_MODES:
		mop = _resolve_mode_of_payment(spec["candidates"])
		if not mop:
			continue
		rows.append({"mode_of_payment": mop, "default": 1 if spec.get("default") else 0})
	return rows


def sync_pos_profile_payments(profile_name: str) -> bool:
	"""Add KQS default payment methods to one POS Profile (does not remove extras)."""
	if not frappe.db.exists("POS Profile", profile_name):
		return False

	doc = frappe.get_doc("POS Profile", profile_name)
	updated = apply_manual_payment_policy(doc)

	desired = {row["mode_of_payment"]: row for row in get_default_pos_payment_rows()}
	if desired:
		existing = {row.mode_of_payment: row for row in doc.payments}
		for mop_name, row in desired.items():
			if mop_name in existing:
				if row.get("default") and not existing[mop_name].default:
					existing[mop_name].default = 1
					updated = True
				continue
			doc.append("payments", row)
			updated = True

	if updated:
		doc.save(ignore_permissions=True)
	return updated


def sync_all_pos_profiles(company: str | None = None) -> int:
	"""Sync default payment methods onto every active POS Profile."""
	company = company or get_default_company()
	filters: dict = {"disabled": 0}
	if company:
		filters["company"] = company

	updated = 0
	for row in frappe.get_all("POS Profile", filters=filters, fields=["name"]):
		if sync_pos_profile_payments(row.name):
			updated += 1
	return updated


def ensure_default_pos_payment_methods() -> None:
	"""Hook: after migrate — keep all store profiles aligned with KQS defaults."""
	from kqs_retail.setup.account_sale import ensure_account_sale_mode_of_payment
	from kqs_retail.setup.store_credit import ensure_store_credit_mode_of_payment

	ensure_store_credit_mode_of_payment()
	ensure_account_sale_mode_of_payment()
	sync_all_pos_profiles()
	enforce_all_pos_profiles_manual_payment()
