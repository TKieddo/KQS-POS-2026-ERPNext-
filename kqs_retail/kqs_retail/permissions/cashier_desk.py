# Copyright (c) 2026, KQS
"""Server-side Desk restrictions for KQS Cashier (POS-only users)."""

from __future__ import annotations

import frappe
from frappe import _

from kqs_retail.utils.cashier_security import (
	CASHIER_ALLOWED_DESK_PAGES,
	get_cashier_companies,
	get_cashier_pos_profiles,
	is_kqs_cashier_only,
	sql_in_list,
)

_BLOCKED_DESK_METHODS = frozenset(
	{
		"frappe.desk.query_report.run",
		"frappe.desk.query_report.export_query",
		"frappe.desk.desk_page.getpage",
	}
)


def block_cashier_desk_browsing():
	"""Deny report/workspace Desk APIs for POS-only cashiers."""
	if frappe.request.method != "POST":
		return
	if not is_kqs_cashier_only():
		return

	path = (frappe.request.path or "").rstrip("/")
	if not path.startswith("/api/method/"):
		return

	method = path.split("/api/method/", 1)[-1]
	if method not in _BLOCKED_DESK_METHODS:
		return

	# Point of Sale loads via desk_page.getpage — must not block the till page itself.
	if method == "frappe.desk.desk_page.getpage":
		page_name = frappe.form_dict.get("name")
		if page_name in CASHIER_ALLOWED_DESK_PAGES:
			return

	frappe.throw(
		_("Desk reports and workspaces are not available on cashier accounts. Use Point of Sale."),
		frappe.PermissionError,
	)


def has_report_permission(doc, ptype, user):
	if ptype != "read":
		return None
	if not is_kqs_cashier_only(user):
		return None
	return False


def sales_invoice_query(user):
	if not is_kqs_cashier_only(user):
		return ""
	profiles = get_cashier_pos_profiles(user)
	if profiles:
		return f"`tabSales Invoice`.pos_profile IN ({sql_in_list(profiles)})"
	return "`tabSales Invoice`.is_pos = 1"


def pos_invoice_query(user):
	if not is_kqs_cashier_only(user):
		return ""
	profiles = get_cashier_pos_profiles(user)
	if profiles:
		return f"`tabPOS Invoice`.pos_profile IN ({sql_in_list(profiles)})"
	return "`tabPOS Invoice`.is_pos = 1"


def payment_entry_query(user):
	if not is_kqs_cashier_only(user):
		return ""
	companies = get_cashier_companies(user)
	if companies:
		return f"`tabPayment Entry`.company IN ({sql_in_list(companies)})"
	return f"`tabPayment Entry`.owner = {frappe.db.escape(user)}"


def layby_agreement_query(user):
	if not is_kqs_cashier_only(user):
		return ""
	companies = get_cashier_companies(user)
	if companies:
		return f"`tabLayby Agreement`.company IN ({sql_in_list(companies)})"
	return ""


def item_query(user):
	if not is_kqs_cashier_only(user):
		return ""
	# Block Item list in Desk; POS catalog uses kqs_retail.api.pos.get_items.
	return "`tabItem`.name = ''"


def stock_entry_query(user):
	if not is_kqs_cashier_only(user):
		return ""
	return "`tabStock Entry`.name = ''"
