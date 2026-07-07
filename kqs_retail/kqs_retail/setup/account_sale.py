# Copyright (c) 2026, KQS
"""Ensure On Account mode of payment exists for POS sell-on-account."""

from __future__ import annotations

import frappe

from kqs_retail.utils.customer_account import ACCOUNT_SALE_MODE_CANDIDATES


def ensure_account_sale_mode_of_payment(company: str | None = None) -> str | None:
	"""Create On Account Mode of Payment linked to receivable (AR debt at POS)."""
	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	if not company:
		return None

	mop_name = ACCOUNT_SALE_MODE_CANDIDATES[0]
	receivable = frappe.db.get_value("Company", company, "default_receivable_account")
	if not receivable:
		frappe.log_error(
			title="KQS: missing receivable account for On Account",
			message=f"company={company}",
		)
		return None

	if frappe.db.exists("Mode of Payment", mop_name):
		doc = frappe.get_doc("Mode of Payment", mop_name)
		if not any(row.company == company for row in doc.accounts):
			doc.append("accounts", {"company": company, "default_account": receivable})
			doc.save(ignore_permissions=True)
		return mop_name

	frappe.get_doc(
		{
			"doctype": "Mode of Payment",
			"mode_of_payment": mop_name,
			"type": "General",
			"accounts": [{"company": company, "default_account": receivable}],
		}
	).insert(ignore_permissions=True)
	return mop_name


def ensure_account_sale_setup(company: str | None = None) -> None:
	"""Hook helper: mode of payment + sync POS profiles."""
	from kqs_retail.setup.pos_payments import sync_all_pos_profiles

	ensure_account_sale_mode_of_payment(company)
	sync_all_pos_profiles(company)
