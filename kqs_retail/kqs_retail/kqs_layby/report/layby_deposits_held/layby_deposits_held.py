# Copyright (c) 2026, KQS
"""Deposits held on active laybys — liability view per store."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from kqs_retail.utils.defaults import get_default_company


def execute(filters=None):
	filters = filters or {}
	company = filters.get("company") or get_default_company()
	return get_columns(), get_data(company, filters)


def get_columns():
	return [
		{"fieldname": "warehouse", "label": _("Store"), "fieldtype": "Link", "options": "Warehouse", "width": 180},
		{"fieldname": "agreement_count", "label": _("Open Laybys"), "fieldtype": "Int", "width": 110},
		{"fieldname": "deposits_held", "label": _("Deposits Held"), "fieldtype": "Currency", "width": 140},
		{"fieldname": "balance_outstanding", "label": _("Balance Outstanding"), "fieldtype": "Currency", "width": 140},
	]


def get_data(company: str, filters: dict) -> list[dict]:
	conditions = ["la.docstatus = 1", "la.status = 'Active'", "la.company = %s"]
	params: list = [company]
	if filters.get("warehouse"):
		conditions.append("la.warehouse = %s")
		params.append(filters["warehouse"])

	rows = frappe.db.sql(
		f"""
		SELECT
			la.warehouse,
			COUNT(*) AS agreement_count,
			COALESCE(SUM(la.paid_amount), 0) AS deposits_held,
			COALESCE(SUM(la.balance_amount), 0) AS balance_outstanding
		FROM `tabLayby Agreement` la
		WHERE {" AND ".join(conditions)}
		GROUP BY la.warehouse
		ORDER BY la.warehouse ASC
		""",
		tuple(params),
		as_dict=True,
	)
	for row in rows:
		row["deposits_held"] = flt(row.deposits_held)
		row["balance_outstanding"] = flt(row.balance_outstanding)
	return rows
