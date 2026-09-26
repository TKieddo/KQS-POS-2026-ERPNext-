# Copyright (c) 2026, KQS
"""Ensure Layby Settlement mode of payment — marks completion SI paid without till cash."""

from __future__ import annotations

import frappe

from kqs_retail.utils.layby_settlement import LAYBY_SETTLEMENT_MODE_CANDIDATES

CLEARING_ACCOUNT_NAME = "Layby Settlement Clearing"


def _find_liability_parent(company: str) -> str | None:
	"""Prefer Current Liabilities group under the company chart."""
	for name in (
		f"Current Liabilities - {frappe.db.get_value('Company', company, 'abbr') or ''}",
		"Current Liabilities",
	):
		name = name.strip(" -")
		parent = frappe.db.get_value(
			"Account",
			{"company": company, "name": name, "is_group": 1},
			"name",
		)
		if parent:
			return parent
	# Any Current Liability group, then any Liability group.
	for filters in (
		{"company": company, "is_group": 1, "account_type": "Current Liability"},
		{"company": company, "is_group": 1, "root_type": "Liability"},
	):
		parent = frappe.db.get_value("Account", filters, "name", order_by="lft asc")
		if parent:
			return parent
	return None


def ensure_layby_settlement_clearing_account(company: str | None = None) -> str | None:
	"""Liability clearing account — not Receivable (avoids 'Customer required' on POS SI)."""
	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	if not company:
		return None

	existing = frappe.db.get_value(
		"Account",
		{
			"company": company,
			"account_name": CLEARING_ACCOUNT_NAME,
			"is_group": 0,
		},
		"name",
	)
	if existing:
		return existing

	parent = _find_liability_parent(company)
	if not parent:
		frappe.log_error(
			title="KQS: no liability parent for Layby Settlement Clearing",
			message=f"company={company}",
		)
		return None

	abbr = frappe.db.get_value("Company", company, "abbr") or "KQS"
	doc = frappe.get_doc(
		{
			"doctype": "Account",
			"account_name": CLEARING_ACCOUNT_NAME,
			"parent_account": parent,
			"company": company,
			"is_group": 0,
			"root_type": "Liability",
			"account_type": "",
			"account_currency": frappe.db.get_value("Company", company, "default_currency"),
		}
	)
	doc.insert(ignore_permissions=True)
	# Name may become "Layby Settlement Clearing - ABBR"
	return doc.name if doc.name else f"{CLEARING_ACCOUNT_NAME} - {abbr}"


def ensure_layby_settlement_mode_of_payment(company: str | None = None) -> str | None:
	"""Create/repair Layby Settlement MoP linked to liability clearing — not Debtors."""
	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	if not company:
		return None

	mop_name = LAYBY_SETTLEMENT_MODE_CANDIDATES[0]
	clearing = ensure_layby_settlement_clearing_account(company)
	if not clearing:
		return None

	receivable = frappe.db.get_value("Company", company, "default_receivable_account")

	if frappe.db.exists("Mode of Payment", mop_name):
		doc = frappe.get_doc("Mode of Payment", mop_name)
		if doc.type != "General":
			doc.type = "General"
		company_rows = [row for row in doc.accounts if row.company == company]
		if not company_rows:
			doc.append("accounts", {"company": company, "default_account": clearing})
			doc.save(ignore_permissions=True)
		else:
			# Repair: was wrongly pointed at Debtors → causes Customer-required GL error.
			changed = False
			for row in company_rows:
				if receivable and row.default_account == receivable:
					row.default_account = clearing
					changed = True
				elif not row.default_account:
					row.default_account = clearing
					changed = True
			if changed or doc.type == "General":
				doc.save(ignore_permissions=True)
		return mop_name

	frappe.get_doc(
		{
			"doctype": "Mode of Payment",
			"mode_of_payment": mop_name,
			"type": "General",
			"accounts": [{"company": company, "default_account": clearing}],
		}
	).insert(ignore_permissions=True)
	return mop_name


def ensure_layby_settlement_setup(company: str | None = None) -> None:
	"""Hook helper: ensure MoP + clearing account (do not add to POS Profile tenders)."""
	ensure_layby_settlement_mode_of_payment(company)
