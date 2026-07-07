# Copyright (c) 2026, KQS
"""Active layby agreements with balances and due dates."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import date_diff, flt, today

from kqs_retail.utils.defaults import get_default_company


def execute(filters=None):
	filters = filters or {}
	company = filters.get("company") or get_default_company()
	return get_columns(), get_data(company, filters)


def get_columns():
	return [
		{"fieldname": "warehouse", "label": _("Store"), "fieldtype": "Link", "options": "Warehouse", "width": 140},
		{"fieldname": "name", "label": _("Agreement"), "fieldtype": "Link", "options": "Layby Agreement", "width": 150},
		{"fieldname": "customer_name", "label": _("Customer"), "fieldtype": "Data", "width": 160},
		{"fieldname": "items_summary", "label": _("Items"), "fieldtype": "Data", "width": 200},
		{"fieldname": "total_amount", "label": _("Total"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "paid_amount", "label": _("Paid"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "balance_amount", "label": _("Balance"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "due_date", "label": _("Due Date"), "fieldtype": "Date", "width": 100},
		{"fieldname": "days_left", "label": _("Days Left"), "fieldtype": "Int", "width": 90},
		{"fieldname": "posting_date", "label": _("Opened"), "fieldtype": "Date", "width": 100},
	]


def get_data(company: str, filters: dict) -> list[dict]:
	layby_filters: dict = {"docstatus": 1, "status": "Active", "company": company}
	if filters.get("warehouse"):
		layby_filters["warehouse"] = filters["warehouse"]

	agreements = frappe.get_all(
		"Layby Agreement",
		filters=layby_filters,
		fields=[
			"name",
			"warehouse",
			"customer_name",
			"total_amount",
			"paid_amount",
			"balance_amount",
			"due_date",
			"posting_date",
		],
		order_by="due_date asc, name asc",
		limit_page_length=500,
	)

	rows: list[dict] = []
	for la in agreements:
		items = frappe.get_all(
			"Layby Item",
			filters={"parent": la.name},
			fields=["item_code", "qty"],
			order_by="idx asc",
		)
		summary = ", ".join(f"{i.item_code} × {flt(i.qty):g}" for i in items)
		days_left = date_diff(la.due_date, today()) if la.due_date else None
		rows.append(
			{
				"warehouse": la.warehouse,
				"name": la.name,
				"customer_name": la.customer_name,
				"items_summary": summary,
				"total_amount": flt(la.total_amount),
				"paid_amount": flt(la.paid_amount),
				"balance_amount": flt(la.balance_amount),
				"due_date": la.due_date,
				"days_left": days_left,
				"posting_date": la.posting_date,
			}
		)
	return rows
