# Copyright (c) 2026, KQS
"""Whitelisted APIs for layby cancel, amend, and forfeit at POS."""

from __future__ import annotations

import frappe
from frappe import _

from kqs_retail.utils.layby_amend import (
	OVERPAYMENT_KEEP,
	OVERPAYMENT_REFUND,
	amend_layby_line,
	preview_amend_layby,
	search_amend_replacements,
)
from kqs_retail.utils.layby_cancel import (
	CANCEL_REASON_CUSTOMER,
	CANCEL_REASON_STORE,
	cancel_layby,
	get_cancel_refund_modes,
	preview_cancel_layby,
)
from kqs_retail.utils.layby_forfeit import forfeit_layby
from kqs_retail.utils.layby_ops_common import assert_active_layby, is_manager_user


@frappe.whitelist()
def get_layby_detail(agreement_name: str) -> dict:
	doc = frappe.get_doc("Layby Agreement", agreement_name)
	if doc.docstatus != 1:
		frappe.throw(_("Layby Agreement must be submitted."))
	items = [
		{
			"idx": row.idx,
			"line_idx": row.idx - 1,
			"item_code": row.item_code,
			"item_name": row.item_name,
			"qty": row.qty,
			"rate": row.rate,
			"amount": row.amount,
		}
		for row in doc.items
	]
	return {
		"name": doc.name,
		"customer": doc.customer,
		"customer_name": doc.customer_name,
		"warehouse": doc.warehouse,
		"company": doc.company,
		"pos_profile": doc.pos_profile or "",
		"status": doc.status,
		"posting_date": doc.posting_date,
		"due_date": doc.due_date,
		"total_amount": doc.total_amount,
		"paid_amount": doc.paid_amount,
		"balance_amount": doc.balance_amount,
		"deposit_amount": doc.deposit_amount,
		"items": items,
		"can_operate": doc.status == "Active",
		"is_manager": is_manager_user(),
	}


@frappe.whitelist()
def preview_layby_cancel(agreement_name: str, reason: str = CANCEL_REASON_CUSTOMER) -> dict:
	return preview_cancel_layby(agreement_name, reason)


@frappe.whitelist()
def get_layby_cancel_refund_modes(pos_profile: str = "") -> dict:
	return get_cancel_refund_modes(pos_profile)


@frappe.whitelist()
def submit_layby_cancel(
	agreement_name: str,
	reason: str = CANCEL_REASON_CUSTOMER,
	mode_of_payment: str | None = None,
	refund_type: str = "account",
) -> dict:
	return cancel_layby(agreement_name, reason, mode_of_payment, refund_type=refund_type)


@frappe.whitelist()
def preview_layby_amend(
	agreement_name: str,
	line_idx: int,
	new_item_code: str,
	manager_approved: int = 0,
) -> dict:
	return preview_amend_layby(agreement_name, int(line_idx), new_item_code, bool(frappe.utils.cint(manager_approved)))


@frappe.whitelist()
def search_layby_amend_items(
	agreement_name: str,
	line_idx: int,
	query: str = "",
	manager_approved: int = 0,
	limit: int = 20,
) -> list[dict]:
	return search_amend_replacements(
		agreement_name,
		int(line_idx),
		query,
		bool(frappe.utils.cint(manager_approved)),
		limit,
	)


@frappe.whitelist()
def submit_layby_amend(
	agreement_name: str,
	line_idx: int,
	new_item_code: str,
	manager_approved: int = 0,
	overpayment_action: str = OVERPAYMENT_KEEP,
	overpayment_mode_of_payment: str | None = None,
	note: str = "",
) -> dict:
	return amend_layby_line(
		agreement_name,
		int(line_idx),
		new_item_code,
		bool(frappe.utils.cint(manager_approved)),
		overpayment_action,
		overpayment_mode_of_payment,
		note,
	)


@frappe.whitelist()
def submit_layby_forfeit(agreement_name: str, note: str) -> dict:
	return forfeit_layby(agreement_name, note)
