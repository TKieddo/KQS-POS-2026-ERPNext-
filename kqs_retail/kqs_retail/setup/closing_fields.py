# Copyright (c) 2026, KQS
"""Custom fields on POS Closing Entry for till cashup extras."""

from __future__ import annotations

import frappe

_FIELDS = [
	{
		"fieldname": "kqs_till_breakdown",
		"fieldtype": "Long Text",
		"label": "KQS Till Breakdown",
		"insert_after": "payment_reconciliation",
		"read_only": 1,
		"hidden": 1,
		"description": "JSON breakdown for cashup (internal).",
	},
	{
		"fieldname": "kqs_sales_tender",
		"fieldtype": "Currency",
		"label": "Sales Paid (kept)",
		"insert_after": "grand_total",
		"read_only": 1,
		"print_hide": 1,
		"description": "Real money from sales after removing change, credit, and points.",
	},
	{
		"fieldname": "kqs_sold_on_credit",
		"fieldtype": "Currency",
		"label": "Sold on Credit",
		"insert_after": "kqs_sales_tender",
		"read_only": 1,
		"print_hide": 1,
		"description": "On Account sales — customers still owe this. Not in the till.",
	},
	{
		"fieldname": "kqs_points_redeemed",
		"fieldtype": "Currency",
		"label": "Points / Store Credit Used",
		"insert_after": "kqs_sold_on_credit",
		"read_only": 1,
		"print_hide": 1,
	},
	{
		"fieldname": "kqs_layby_received",
		"fieldtype": "Currency",
		"label": "Layby Received",
		"insert_after": "kqs_points_redeemed",
		"read_only": 1,
		"print_hide": 1,
	},
	{
		"fieldname": "kqs_account_collected",
		"fieldtype": "Currency",
		"label": "Account Collected",
		"insert_after": "kqs_layby_received",
		"read_only": 1,
		"print_hide": 1,
	},
	{
		"fieldname": "kqs_till_refunds",
		"fieldtype": "Currency",
		"label": "Till Refunds",
		"insert_after": "kqs_account_collected",
		"read_only": 1,
		"print_hide": 1,
	},
	{
		"fieldname": "kqs_cash_in_till",
		"fieldtype": "Currency",
		"label": "Cash in Till",
		"insert_after": "kqs_till_refunds",
		"read_only": 1,
		"bold": 1,
		"print_hide": 1,
		"description": "Physical cash only (opening + cash sales + cash layby + cash account − cash refunds).",
	},
	{
		"fieldname": "kqs_money_in_till",
		"fieldtype": "Currency",
		"label": "Total Money Received",
		"insert_after": "kqs_cash_in_till",
		"read_only": 1,
		"bold": 1,
		"print_hide": 1,
		"description": "All real money this session (Cash + Bank + M-Pesa + …). Does not include credit or points.",
	},
]


def ensure_closing_custom_fields() -> None:
	for spec in _FIELDS:
		fieldname = f"POS Closing Entry-{spec['fieldname']}"
		if frappe.db.exists("Custom Field", fieldname):
			existing = frappe.get_doc("Custom Field", fieldname)
			changed = False
			for key in ("label", "description", "insert_after", "bold", "hidden", "print_hide"):
				if key in spec and existing.get(key) != spec.get(key):
					existing.set(key, spec.get(key))
					changed = True
			if changed:
				existing.save(ignore_permissions=True)
			continue
		doc = {
			"doctype": "Custom Field",
			"dt": "POS Closing Entry",
			"module": "KQS Layby",
			**spec,
		}
		frappe.get_doc(doc).insert(ignore_permissions=True)
	frappe.clear_cache(doctype="POS Closing Entry")
