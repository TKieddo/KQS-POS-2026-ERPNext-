# Copyright (c) 2026, KQS
"""Whitelisted APIs for customer account summary (Desk + POS)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from kqs_retail.utils.ar_payment import (
	get_customer_ar_details,
	record_customer_ar_payment_from_json,
	search_customers_with_ar as _search_customers_with_ar,
)
from kqs_retail.utils.customer_account import (
	build_customer_account_summary,
	check_account_sale_allowed,
)
from kqs_retail.utils.defaults import get_default_company
from kqs_retail.utils.customer_account_history import (
	get_customer_account_history as _get_customer_account_history,
	search_customers_for_account_hub as _search_customers_for_account_hub,
)
from kqs_retail.utils.defaults import get_default_company
from kqs_retail.utils.store_credit import is_walk_in_customer


@frappe.whitelist()
def get_customer_account_summary(
	customer: str,
	company: str | None = None,
	warehouse: str = "",
	include_credit_notes: int = 0,
) -> dict:
	"""Unified balances: AR owed, store credit, laybys, credit limit."""
	if not customer:
		return {"customer": "", "walk_in": True}

	company = company or get_default_company()
	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer {0} not found.").format(customer))

	return build_customer_account_summary(
		customer,
		company,
		warehouse=warehouse,
		include_credit_notes=bool(int(include_credit_notes or 0)),
	)


@frappe.whitelist()
def validate_account_sale(
	customer: str,
	company: str | None = None,
	account_amount: float = 0,
	grand_total: float = 0,
	paid_amount: float = 0,
) -> dict:
	"""POS: can this customer take this amount on On Account?"""
	company = company or get_default_company()
	amount = flt(account_amount)
	if amount <= 0 and (grand_total or paid_amount):
		amount = max(0.0, flt(grand_total) - flt(paid_amount))
	if amount <= 0:
		return {"allowed": True, "unpaid_amount": 0}
	if is_walk_in_customer(customer):
		return {"allowed": False, "reason": _("Named customer required for On Account.")}
	return check_account_sale_allowed(customer, company, amount)


@frappe.whitelist()
def search_customers_with_ar(query: str = "", company: str | None = None, limit: int = 30) -> list[dict]:
	"""POS Account Lookup: customers with AR balance > 0."""
	return _search_customers_with_ar(query, company or get_default_company(), limit=int(limit or 30))


@frappe.whitelist()
def search_customers_for_account_hub(
	query: str = "",
	company: str | None = None,
	filter_type: str = "all",
	limit: int = 40,
) -> list[dict]:
	"""POS Customer Account hub: searchable customer list with balances."""
	return _search_customers_for_account_hub(
		query,
		company or get_default_company(),
		filter_type=filter_type or "all",
		limit=int(limit or 40),
	)


@frappe.whitelist()
def get_customer_account_history_api(
	customer: str,
	company: str | None = None,
	limit: int = 60,
) -> list[dict]:
	"""POS Customer Account hub: chronological activity for one customer."""
	if not customer:
		frappe.throw(_("Customer is required."))
	return _get_customer_account_history(
		customer,
		company or get_default_company(),
		limit=int(limit or 60),
	)


@frappe.whitelist()
def get_customer_ar_details_api(customer: str, company: str | None = None) -> dict:
	"""POS: balance + open invoice rows before collecting payment."""
	if not customer:
		frappe.throw(_("Customer is required."))
	return get_customer_ar_details(customer, company or get_default_company())


@frappe.whitelist()
def record_ar_payment(
	customer: str,
	company: str | None = None,
	payments: str = "",
	reference_no: str | None = None,
) -> dict:
	"""POS: post Payment Entry (Receive) against open on-account invoices."""
	if not customer:
		frappe.throw(_("Customer is required."))
	company = (company or "").strip() or get_default_company()
	return record_customer_ar_payment_from_json(
		customer,
		company or get_default_company(),
		payments,
		reference_no=reference_no,
	)
