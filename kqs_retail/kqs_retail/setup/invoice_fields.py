# Copyright (c) 2026, KQS
"""Custom fields on POS/Sales Invoice for on-account tracking."""

from __future__ import annotations

import frappe

from kqs_retail.utils.customer_account import RETURN_CREDIT_DOCTYPES


def ensure_invoice_custom_fields() -> None:
	for dt in RETURN_CREDIT_DOCTYPES:
		fieldname = f"{dt}-kqs_on_account_unpaid"
		if frappe.db.exists("Custom Field", fieldname):
			continue
		frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": dt,
				"fieldname": "kqs_on_account_unpaid",
				"fieldtype": "Currency",
				"label": "On Account Unpaid",
				"insert_after": "outstanding_amount",
				"read_only": 1,
				"depends_on": "eval:!doc.is_return",
				"description": "Portion of this sale posted as customer Accounts Receivable (On Account).",
				"module": "KQS Layby",
			}
		).insert(ignore_permissions=True)
		frappe.clear_cache(doctype=dt)
