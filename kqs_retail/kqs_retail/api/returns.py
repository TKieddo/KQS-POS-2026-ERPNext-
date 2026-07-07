# Copyright (c) 2026, KQS
"""Whitelisted APIs for the KQS Returns page (store credit, not POS checkout)."""

from __future__ import annotations

import frappe
from frappe import _

from kqs_retail.utils.returns import (
	get_invoice_return_context,
	get_return_refund_options,
	search_store_receipts,
	submit_store_credit_return,
)


@frappe.whitelist()
def search_receipts(search_term: str = "", limit: int = 25, pos_profile: str = "") -> dict:
	"""Find paid POS sales at this store within the return window (any cashier)."""
	return search_store_receipts(pos_profile, search_term, limit)


@frappe.whitelist()
def get_receipt_for_return(doctype: str, name: str, pos_profile: str = "") -> dict:
	"""Receipt header + line items with returnable quantities."""
	return get_invoice_return_context(doctype, name, pos_profile=pos_profile)


@frappe.whitelist()
def get_refund_options(doctype: str, name: str, pos_profile: str = "") -> dict:
	"""Payment modes available when refunding a return (account credit vs till payout)."""
	return get_return_refund_options(doctype, name, pos_profile=pos_profile)


@frappe.whitelist()
def submit_return(
	doctype: str,
	invoice_name: str,
	customer: str,
	items: str,
	pos_profile: str = "",
	refund_type: str = "account",
	mode_of_payment: str | None = None,
) -> dict:
	"""Create and submit return credit note; credit on account or refund via payment mode."""
	return submit_store_credit_return(
		doctype,
		invoice_name,
		customer,
		items,
		pos_profile=pos_profile,
		refund_type=refund_type,
		mode_of_payment=mode_of_payment,
	)
