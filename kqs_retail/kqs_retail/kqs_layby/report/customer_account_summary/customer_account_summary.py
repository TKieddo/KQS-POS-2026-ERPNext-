# Copyright (c) 2026, KQS
"""Per-customer AR, store credit, and layby balance summary."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from kqs_retail.utils.customer_account import build_customer_account_summary
from kqs_retail.utils.defaults import get_default_company
from kqs_retail.utils.store_credit import is_walk_in_customer


def execute(filters=None):
	filters = filters or {}
	company = filters.get("company") or get_default_company()
	columns = get_columns()
	data = get_data(company, filters)
	return columns, data


def get_columns():
	return [
		{
			"fieldname": "customer",
			"label": _("Customer"),
			"fieldtype": "Link",
			"options": "Customer",
			"width": 140,
		},
		{
			"fieldname": "customer_name",
			"label": _("Customer Name"),
			"fieldtype": "Data",
			"width": 180,
		},
		{
			"fieldname": "ar_outstanding",
			"label": _("Amount Owed (AR)"),
			"fieldtype": "Currency",
			"width": 130,
		},
		{
			"fieldname": "store_credit_balance",
			"label": _("Store Credit"),
			"fieldtype": "Currency",
			"width": 120,
		},
		{
			"fieldname": "layby_balance_total",
			"label": _("Layby Balance"),
			"fieldtype": "Currency",
			"width": 120,
		},
		{
			"fieldname": "layby_count",
			"label": _("Open Laybys"),
			"fieldtype": "Int",
			"width": 90,
		},
		{
			"fieldname": "credit_limit",
			"label": _("Credit Limit"),
			"fieldtype": "Currency",
			"width": 110,
		},
		{
			"fieldname": "credit_available",
			"label": _("Credit Available"),
			"fieldtype": "Currency",
			"width": 120,
		},
		{
			"fieldname": "allow_account_sales",
			"label": _("Account Sales"),
			"fieldtype": "Check",
			"width": 90,
		},
	]


def get_data(company: str, filters: dict) -> list[dict]:
	customer_filter = filters.get("customer")
	customers = frappe.get_all(
		"Customer",
		filters={"disabled": 0, **({"name": customer_filter} if customer_filter else {})},
		fields=["name", "customer_name"],
		order_by="customer_name asc",
		limit_page_length=500,
	)

	rows: list[dict] = []
	for cust in customers:
		if is_walk_in_customer(cust.name):
			continue
		summary = build_customer_account_summary(cust.name, company)
		if not _row_matches_filters(summary, filters):
			continue
		rows.append(
			{
				"customer": cust.name,
				"customer_name": cust.customer_name,
				"ar_outstanding": summary["ar_outstanding"],
				"store_credit_balance": summary["store_credit_balance"],
				"layby_balance_total": summary["layby_balance_total"],
				"layby_count": summary["layby_count"],
				"credit_limit": summary["credit_limit"],
				"credit_available": summary["credit_available"],
				"allow_account_sales": summary["allow_account_sales"],
			}
		)
	return rows


def _row_matches_filters(summary: dict, filters: dict) -> bool:
	if filters.get("hide_zero_balances"):
		total = (
			flt(summary.get("ar_outstanding"))
			+ flt(summary.get("store_credit_balance"))
			+ flt(summary.get("layby_balance_total"))
		)
		if total <= 0.009:
			return False
	return True
