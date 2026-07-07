# Copyright (c) 2026, KQS
"""Whitelisted APIs for POS store credit and return-for-credit customer."""

from __future__ import annotations

import frappe
from frappe import _

from kqs_retail.utils.defaults import get_default_company
from kqs_retail.utils.store_credit import (
	get_customer_store_credit_balance,
	is_walk_in_customer,
	register_return_credit_customer,
	resolve_store_credit_mode,
)


@frappe.whitelist()
def get_store_credit_balance(customer: str, company: str | None = None) -> dict:
	"""Available store credit for a named customer at POS checkout."""
	if not customer:
		return {"customer": "", "balance": 0, "mode_of_payment": resolve_store_credit_mode()}

	company = company or get_default_company()
	if is_walk_in_customer(customer):
		return {
			"customer": customer,
			"balance": 0,
			"mode_of_payment": resolve_store_credit_mode(),
			"walk_in": True,
		}

	balance = get_customer_store_credit_balance(customer, company)
	return {
		"customer": customer,
		"company": company,
		"balance": balance,
		"mode_of_payment": resolve_store_credit_mode(),
		"walk_in": False,
	}


@frappe.whitelist()
def set_return_credit_customer(customer: str) -> dict:
	"""Register customer before POS return so credit lands on their account."""
	register_return_credit_customer(customer)
	return {"customer": customer, "ok": True}


@frappe.whitelist()
def validate_return_credit_customer(customer: str) -> dict:
	"""Reject Walk-in for store credit returns."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer is required."))
	if is_walk_in_customer(customer):
		frappe.throw(_("Store credit cannot be assigned to Walk-in Customer."))
	return {"customer": customer, "ok": True}


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def customer_query_for_return_credit(doctype, txt, searchfield, start, page_len, filters):
	"""Link field search — named customers only (excludes Walk-in)."""
	_txt = f"%{txt}%"
	return frappe.db.sql(
		"""
		SELECT name, customer_name, mobile_no
		FROM `tabCustomer`
		WHERE disabled = 0
		AND LOWER(IFNULL(customer_name, '')) NOT LIKE '%%walk-in%%'
		AND LOWER(IFNULL(customer_name, '')) NOT LIKE '%%walk in%%'
		AND LOWER(name) NOT LIKE '%%walk-in%%'
		AND LOWER(name) NOT LIKE '%%walk in%%'
		AND (
			name LIKE %(txt)s
			OR customer_name LIKE %(txt)s
			OR mobile_no LIKE %(txt)s
		)
		ORDER BY modified DESC
		LIMIT %(start)s, %(page_len)s
		""",
		{"txt": _txt, "start": start, "page_len": page_len},
	)


@frappe.whitelist()
def find_or_create_customer(customer_name: str, mobile_no: str) -> dict:
	"""Find customer by mobile or create Individual customer for return / sale."""
	customer_name = (customer_name or "").strip()
	mobile_no = (mobile_no or "").strip()
	if not customer_name:
		frappe.throw(_("Customer name is required."))
	if not mobile_no:
		frappe.throw(_("Mobile number is required."))

	existing = frappe.db.get_value("Customer", {"mobile_no": mobile_no}, "name")
	if existing:
		return {"customer": existing, "created": False}

	doc = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": customer_name,
			"customer_type": "Individual",
			"mobile_no": mobile_no,
			"customer_group": frappe.db.get_single_value("Selling Settings", "customer_group") or "Individual",
			"territory": frappe.db.get_single_value("Selling Settings", "territory") or "All Territories",
		}
	)
	doc.insert(ignore_permissions=True)
	return {"customer": doc.name, "created": True}
