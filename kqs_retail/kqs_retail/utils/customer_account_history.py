# Copyright (c) 2026, KQS
"""Customer account activity timeline for POS hub and Desk."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from kqs_retail.utils.customer_account import (
	RETURN_CREDIT_DOCTYPES,
	account_sale_unpaid_amount,
	build_customer_account_summary,
	get_account_sale_payment_amount,
)
from kqs_retail.utils.store_credit import is_walk_in_customer


def search_customers_for_account_hub(
	query: str = "",
	company: str = "",
	filter_type: str = "all",
	limit: int = 40,
) -> list[dict]:
	"""Named customers with account summary fields for POS Customer Account hub."""
	if not company:
		frappe.throw(_("Company is required"))

	limit = min(int(limit or 40), 50)
	query = (query or "").strip()
	filter_type = (filter_type or "all").lower()

	or_filters = None
	if query:
		or_filters = [
			["customer_name", "like", f"%{query}%"],
			["mobile_no", "like", f"%{query}%"],
			["name", "like", f"%{query}%"],
		]

	candidates = frappe.get_all(
		"Customer",
		filters={"disabled": 0},
		or_filters=or_filters,
		fields=["name", "customer_name", "mobile_no"],
		limit_page_length=min(limit * 4, 120),
		order_by="modified desc",
	)

	results: list[dict] = []
	for cust in candidates:
		if is_walk_in_customer(cust.name):
			continue
		summary = build_customer_account_summary(cust.name, company)
		if not _matches_hub_filter(summary, filter_type):
			continue
		results.append(
			{
				"customer": cust.name,
				"customer_name": cust.customer_name or cust.name,
				"mobile_no": cust.mobile_no,
				"ar_outstanding": summary["ar_outstanding"],
				"store_credit_balance": summary["store_credit_balance"],
				"layby_balance_total": summary["layby_balance_total"],
				"layby_count": summary["layby_count"],
				"credit_limit": summary["credit_limit"],
				"credit_available": summary["credit_available"],
				"allow_account_sales": summary["allow_account_sales"],
			}
		)
		if len(results) >= limit:
			break

	return results


def _matches_hub_filter(summary: dict, filter_type: str) -> bool:
	if filter_type == "owes":
		return flt(summary.get("ar_outstanding")) > 0.009
	if filter_type == "credit":
		return flt(summary.get("store_credit_balance")) > 0.009
	if filter_type == "layby":
		return flt(summary.get("layby_balance_total")) > 0.009
	if filter_type == "eligible":
		return bool(summary.get("allow_account_sales")) and flt(summary.get("credit_limit")) > 0
	if filter_type == "active":
		total = (
			flt(summary.get("ar_outstanding"))
			+ flt(summary.get("store_credit_balance"))
			+ flt(summary.get("layby_balance_total"))
		)
		return total > 0.009 or bool(summary.get("allow_account_sales"))
	return True


def get_customer_account_history(customer: str, company: str, limit: int = 60) -> list[dict]:
	"""Chronological account activity: on-account sales, payments, store credit, layby."""
	if not customer or not company:
		return []
	if is_walk_in_customer(customer):
		return []

	limit = min(int(limit or 60), 100)
	events: list[dict] = []
	events.extend(_history_account_sales(customer, company))
	events.extend(_history_ar_payments(customer, company))
	events.extend(_history_store_credit(customer, company))
	events.extend(_history_layby_payments(customer))

	events.sort(key=lambda row: (row.get("date") or "", row.get("creation") or ""), reverse=True)
	return events[:limit]


def _history_account_sales(customer: str, company: str) -> list[dict]:
	rows: list[dict] = []
	for doctype in RETURN_CREDIT_DOCTYPES:
		invoices = frappe.get_all(
			doctype,
			filters={
				"customer": customer,
				"company": company,
				"docstatus": 1,
				"is_return": 0,
			},
			fields=[
				"name",
				"posting_date",
				"creation",
				"grand_total",
				"outstanding_amount",
				"is_pos",
			],
			order_by="posting_date desc, creation desc",
			limit_page_length=80,
		)
		for inv in invoices:
			doc = frappe.get_doc(doctype, inv.name)
			account_amount = flt(inv.outstanding_amount)
			if account_amount <= 0.009:
				account_amount = get_account_sale_payment_amount(doc)
			if account_amount <= 0.009:
				account_amount = account_sale_unpaid_amount(doc)
			if account_amount <= 0.009:
				continue
			rows.append(
				{
					"date": inv.posting_date,
					"creation": inv.creation,
					"type": "account_sale",
					"label": "On Account Purchase",
					"reference_doctype": doctype,
					"reference_name": inv.name,
					"amount": account_amount,
					"direction": "debit",
					"status": "open" if flt(inv.outstanding_amount) > 0.009 else "settled",
					"detail": flt(inv.grand_total),
				}
			)
	return rows


def _history_ar_payments(customer: str, company: str) -> list[dict]:
	payments = frappe.get_all(
		"Payment Entry",
		filters={
			"party_type": "Customer",
			"party": customer,
			"company": company,
			"payment_type": "Receive",
			"docstatus": 1,
		},
		fields=["name", "posting_date", "creation", "paid_amount", "mode_of_payment"],
		order_by="posting_date desc, creation desc",
		limit_page_length=80,
	)
	return [
		{
			"date": pe.posting_date,
			"creation": pe.creation,
			"type": "ar_payment",
			"label": "Account Payment",
			"reference_doctype": "Payment Entry",
			"reference_name": pe.name,
			"amount": flt(pe.paid_amount),
			"direction": "credit",
			"status": "submitted",
			"detail": pe.mode_of_payment,
		}
		for pe in payments
	]


def _history_store_credit(customer: str, company: str) -> list[dict]:
	rows: list[dict] = []
	for doctype in RETURN_CREDIT_DOCTYPES:
		credits = frappe.get_all(
			doctype,
			filters={
				"customer": customer,
				"company": company,
				"docstatus": 1,
				"is_return": 1,
			},
			fields=["name", "posting_date", "creation", "grand_total", "outstanding_amount"],
			order_by="posting_date desc, creation desc",
			limit_page_length=40,
		)
		for cn in credits:
			amount = abs(flt(cn.grand_total))
			if amount <= 0.009:
				continue
			outstanding = flt(cn.outstanding_amount)
			rows.append(
				{
					"date": cn.posting_date,
					"creation": cn.creation,
					"type": "store_credit",
					"label": "Store Credit Issued",
					"reference_doctype": doctype,
					"reference_name": cn.name,
					"amount": amount,
					"direction": "credit_customer",
					"status": "available" if outstanding > 0.009 else "used",
					"detail": outstanding,
				}
			)
	return rows


def _history_layby_payments(customer: str) -> list[dict]:
	payments = frappe.db.sql(
		"""
		SELECT lp.name, lp.posting_date, lp.creation, lp.amount, lp.mode_of_payment,
		       la.name AS layby_agreement
		FROM `tabLayby Payment` lp
		INNER JOIN `tabLayby Agreement` la ON la.name = lp.layby_agreement
		WHERE la.customer = %s AND lp.docstatus = 1
		ORDER BY lp.posting_date DESC, lp.creation DESC
		LIMIT 40
		""",
		(customer,),
		as_dict=True,
	)
	return [
		{
			"date": row.posting_date,
			"creation": row.creation,
			"type": "layby_payment",
			"label": "Layby Payment",
			"reference_doctype": "Layby Payment",
			"reference_name": row.name,
			"amount": flt(row.amount),
			"direction": "credit",
			"status": "submitted",
			"detail": row.layby_agreement,
		}
		for row in payments
	]
