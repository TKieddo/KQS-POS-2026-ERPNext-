# Copyright (c) 2026, KQS
"""Ensure Store Credit mode of payment exists for POS redemption."""

from __future__ import annotations

import frappe

from kqs_retail.utils.store_credit import RETURN_CREDIT_DOCTYPES, STORE_CREDIT_MODE_CANDIDATES


def ensure_store_credit_mode_of_payment(company: str | None = None) -> str | None:
	"""Create Store Credit Mode of Payment linked to receivable account."""
	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	if not company:
		return None

	mop_name = STORE_CREDIT_MODE_CANDIDATES[0]
	receivable = frappe.db.get_value("Company", company, "default_receivable_account")
	if not receivable:
		frappe.log_error(
			title="KQS: missing receivable account for Store Credit",
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


def ensure_store_credit_setup(company: str | None = None) -> None:
	"""Hook helper: mode of payment + custom fields + sync POS profiles."""
	from kqs_retail.setup.pos_payments import sync_all_pos_profiles

	ensure_store_credit_custom_fields()
	ensure_store_credit_mode_of_payment(company)
	sync_all_pos_profiles(company)


def ensure_store_credit_custom_fields() -> None:
	"""Track store credit spent per return credit note (POS Invoice cannot use PR/JE refs)."""
	for dt in RETURN_CREDIT_DOCTYPES:
		fieldname = f"{dt}-kqs_store_credit_allocated"
		if frappe.db.exists("Custom Field", fieldname):
			continue
		frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": dt,
				"fieldname": "kqs_store_credit_allocated",
				"fieldtype": "Currency",
				"label": "Store Credit Allocated",
				"insert_after": "grand_total",
				"read_only": 1,
				"depends_on": "eval:doc.is_return",
				"module": "KQS Layby",
			}
		).insert(ignore_permissions=True)
		frappe.clear_cache(doctype=dt)
