# Copyright (c) 2026, KQS
"""Custom fields on Customer for sell-on-account policy."""

import frappe


def ensure_customer_custom_fields() -> None:
	_ensure_allow_account_sales_field()


def _ensure_allow_account_sales_field() -> None:
	if frappe.db.exists("Custom Field", "Customer-kqs_allow_account_sales"):
		return
	frappe.get_doc(
		{
			"doctype": "Custom Field",
			"dt": "Customer",
			"fieldname": "kqs_allow_account_sales",
			"fieldtype": "Check",
			"label": "Allow Account Sales",
			"insert_after": "credit_limits",
			"description": "Allow POS sales with partial payment; remainder posts as Accounts Receivable within Credit Limit.",
			"module": "KQS Layby",
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype="Customer")
