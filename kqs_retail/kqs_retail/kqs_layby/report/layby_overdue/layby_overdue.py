# Copyright (c) 2026, KQS
"""Active laybys past due date + grace — candidates for manager forfeit."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, date_diff, flt, today

from kqs_retail.kqs_layby.settings import get_layby_settings
from kqs_retail.utils.defaults import get_default_company


def execute(filters=None):
	filters = filters or {}
	company = filters.get("company") or get_default_company()
	return get_columns(), get_data(company, filters)


def get_columns():
	return [
		{"fieldname": "warehouse", "label": _("Store"), "fieldtype": "Link", "options": "Warehouse", "width": 130},
		{"fieldname": "name", "label": _("Agreement"), "fieldtype": "Link", "options": "Layby Agreement", "width": 150},
		{"fieldname": "customer_name", "label": _("Customer"), "fieldtype": "Data", "width": 150},
		{"fieldname": "due_date", "label": _("Due Date"), "fieldtype": "Date", "width": 100},
		{"fieldname": "days_overdue", "label": _("Days Overdue"), "fieldtype": "Int", "width": 110},
		{"fieldname": "paid_amount", "label": _("Paid"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "balance_amount", "label": _("Balance"), "fieldtype": "Currency", "width": 100},
	]


def get_data(company: str, filters: dict) -> list[dict]:
	settings = get_layby_settings()
	cutoff = add_days(today(), -settings["grace_period_days"])

	layby_filters: dict = {
		"docstatus": 1,
		"status": "Active",
		"company": company,
		"due_date": ["<", cutoff],
		"balance_amount": [">", 0],
	}
	if filters.get("warehouse"):
		layby_filters["warehouse"] = filters["warehouse"]

	agreements = frappe.get_all(
		"Layby Agreement",
		filters=layby_filters,
		fields=[
			"name",
			"warehouse",
			"customer_name",
			"due_date",
			"paid_amount",
			"balance_amount",
		],
		order_by="due_date asc",
		limit_page_length=500,
	)

	rows: list[dict] = []
	for la in agreements:
		days_overdue = date_diff(today(), la.due_date) if la.due_date else 0
		rows.append(
			{
				"warehouse": la.warehouse,
				"name": la.name,
				"customer_name": la.customer_name,
				"due_date": la.due_date,
				"days_overdue": days_overdue,
				"paid_amount": flt(la.paid_amount),
				"balance_amount": flt(la.balance_amount),
			}
		)
	return rows
