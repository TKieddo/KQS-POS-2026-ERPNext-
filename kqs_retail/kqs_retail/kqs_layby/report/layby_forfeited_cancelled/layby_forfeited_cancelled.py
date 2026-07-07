# Copyright (c) 2026, KQS
"""Cancelled and forfeited laybys in a date range."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, getdate

from kqs_retail.utils.defaults import get_default_company


def execute(filters=None):
	filters = filters or {}
	company = filters.get("company") or get_default_company()
	return get_columns(), get_data(company, filters)


def get_columns():
	return [
		{"fieldname": "closed_on", "label": _("Closed On"), "fieldtype": "Date", "width": 100},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data", "width": 100},
		{"fieldname": "name", "label": _("Agreement"), "fieldtype": "Link", "options": "Layby Agreement", "width": 150},
		{"fieldname": "warehouse", "label": _("Store"), "fieldtype": "Link", "options": "Warehouse", "width": 130},
		{"fieldname": "customer_name", "label": _("Customer"), "fieldtype": "Data", "width": 150},
		{"fieldname": "cancel_reason", "label": _("Reason"), "fieldtype": "Data", "width": 110},
		{"fieldname": "paid_amount", "label": _("Paid"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "refund_amount", "label": _("Refunded"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "forfeit_amount", "label": _("Forfeited"), "fieldtype": "Currency", "width": 100},
	]


def get_data(company: str, filters: dict) -> list[dict]:
	from_date = filters.get("from_date")
	to_date = filters.get("to_date")

	conditions = [
		"la.company = %s",
		"(la.status IN ('Cancelled', 'Forfeited') OR la.docstatus = 2)",
	]
	params: list = [company]

	if from_date:
		conditions.append("COALESCE(la.closed_on, la.modified) >= %s")
		params.append(getdate(from_date))
	if to_date:
		conditions.append("COALESCE(la.closed_on, la.modified) <= %s")
		params.append(getdate(to_date))
	if filters.get("warehouse"):
		conditions.append("la.warehouse = %s")
		params.append(filters["warehouse"])
	if filters.get("status"):
		conditions.append("la.status = %s")
		params.append(filters["status"])

	rows = frappe.db.sql(
		f"""
		SELECT
			la.name,
			la.warehouse,
			la.customer_name,
			la.status,
			la.cancel_reason,
			la.paid_amount,
			la.refund_amount,
			la.forfeit_amount,
			COALESCE(la.closed_on, DATE(la.modified)) AS closed_on
		FROM `tabLayby Agreement` la
		WHERE {" AND ".join(conditions)}
		ORDER BY closed_on DESC, la.name DESC
		LIMIT 500
		""",
		tuple(params),
		as_dict=True,
	)
	for row in rows:
		row["paid_amount"] = flt(row.paid_amount)
		row["refund_amount"] = flt(row.refund_amount)
		row["forfeit_amount"] = flt(row.forfeit_amount)
	return rows
