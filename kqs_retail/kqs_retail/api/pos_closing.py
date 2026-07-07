# Copyright (c) 2026, KQS
"""Server-side POS closing — avoids client timestamp races and duplicate drafts."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt

from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import (
	make_closing_entry_from_opening,
)
from kqs_retail.utils.closing_validation import (
	collect_closing_blockers,
	throw_if_closing_blocked,
)


def _authorize_closing_entry(doc) -> None:
	if doc.user != frappe.session.user:
		frappe.throw(_("You can only close your own POS session."), frappe.PermissionError)
	if not frappe.has_permission("POS Closing Entry", "submit", doc=doc):
		frappe.throw(_("Not permitted to submit POS Closing Entry."), frappe.PermissionError)


def _saved_closing_amounts(doc) -> dict[str, float]:
	return {
		row.mode_of_payment: flt(row.closing_amount)
		for row in doc.payment_reconciliation
		if row.mode_of_payment and flt(row.closing_amount)
	}


def _apply_fresh_closing_data(doc, fresh, preserve_closing: bool = True) -> None:
	saved = _saved_closing_amounts(doc) if preserve_closing else {}

	doc.pos_invoices = []
	doc.sales_invoices = []
	doc.payment_reconciliation = []
	doc.taxes = []
	doc.grand_total = 0
	doc.net_total = 0
	doc.total_quantity = 0
	doc.total_taxes_and_charges = 0

	for row in fresh.pos_invoices:
		doc.append("pos_invoices", row.as_dict())
	for row in fresh.sales_invoices:
		doc.append("sales_invoices", row.as_dict())
	for row in fresh.payment_reconciliation:
		child = doc.append("payment_reconciliation", row.as_dict())
		if preserve_closing and child.mode_of_payment in saved:
			child.closing_amount = saved[child.mode_of_payment]
			child.difference = flt(child.closing_amount - child.expected_amount)
	for row in fresh.taxes:
		doc.append("taxes", row.as_dict())

	doc.grand_total = fresh.grand_total
	doc.net_total = fresh.net_total
	doc.total_quantity = fresh.total_quantity
	doc.total_taxes_and_charges = fresh.total_taxes_and_charges
	doc.period_end_date = fresh.period_end_date


def _reload_closing_invoices(doc, *, preserve_closing: bool = True) -> None:
	opening = frappe.get_doc("POS Opening Entry", doc.pos_opening_entry)
	fresh = make_closing_entry_from_opening(opening)
	_apply_fresh_closing_data(doc, fresh, preserve_closing=preserve_closing)


def _serialize_closing_payload(doc, blockers: list | None = None) -> dict:
	if blockers is None:
		blockers = collect_closing_blockers(doc)
	return {
		"name": doc.name,
		"pos_opening_entry": doc.pos_opening_entry,
		"docstatus": doc.docstatus,
		"status": doc.status,
		"grand_total": flt(doc.grand_total),
		"net_total": flt(doc.net_total),
		"invoice_count": len(doc.pos_invoices) + len(doc.sales_invoices),
		"payment_reconciliation": [
			{
				"mode_of_payment": row.mode_of_payment,
				"expected_amount": flt(row.expected_amount),
				"closing_amount": flt(row.closing_amount or row.expected_amount),
			}
			for row in doc.payment_reconciliation
		],
		"blockers": blockers,
		"can_submit": not blockers,
	}


def _apply_closing_amounts(doc, payment_reconciliation: str | list) -> None:
	raw = json.loads(payment_reconciliation) if isinstance(payment_reconciliation, str) else payment_reconciliation
	if not isinstance(raw, list):
		frappe.throw(_("Invalid payment reconciliation payload."))

	by_mode = {
		row.get("mode_of_payment"): flt(row.get("closing_amount"))
		for row in raw
		if row.get("mode_of_payment")
	}
	for pay in doc.payment_reconciliation:
		if pay.mode_of_payment in by_mode:
			pay.closing_amount = by_mode[pay.mode_of_payment]
			pay.difference = flt(pay.closing_amount - pay.expected_amount)


@frappe.whitelist()
def prepare_closing_entry(pos_opening_entry: str) -> dict:
	"""Open one draft closing entry for this session, with invoices loaded on the server."""
	if not pos_opening_entry:
		frappe.throw(_("POS Opening Entry is required."))

	opening = frappe.get_doc("POS Opening Entry", pos_opening_entry)
	if opening.status != "Open":
		frappe.throw(_("Selected POS Opening Entry is not open."))
	if opening.user != frappe.session.user:
		frappe.throw(_("You can only close your own POS session."), frappe.PermissionError)

	existing_rows = frappe.get_all(
		"POS Closing Entry",
		filters={"pos_opening_entry": pos_opening_entry, "docstatus": 0},
		fields=["name"],
		order_by="modified desc",
		limit_page_length=1,
	)
	existing = existing_rows[0].name if existing_rows else None

	if existing:
		doc = frappe.get_doc("POS Closing Entry", existing)
		if doc.status == "Failed":
			doc.db_set({"status": "Draft", "error_message": ""})
			doc.reload()
		_reload_closing_invoices(doc, preserve_closing=True)
	else:
		doc = make_closing_entry_from_opening(opening)
		doc.insert()

	doc.save()
	return _serialize_closing_payload(doc)


@frappe.whitelist()
def get_closing_blockers(name: str) -> dict:
	"""List invoices that must be fixed before this closing entry can submit."""
	if not name:
		frappe.throw(_("POS Closing Entry is required."))

	doc = frappe.get_doc("POS Closing Entry", name)
	_authorize_closing_entry(doc)
	_reload_closing_invoices(doc, preserve_closing=True)
	blockers = collect_closing_blockers(doc)
	return {
		"name": doc.name,
		"blockers": blockers,
		"can_submit": not blockers,
	}


@frappe.whitelist()
def submit_closing_entry(name: str, payment_reconciliation: str | None = None) -> dict:
	"""Save counted amounts and submit — no client modified-timestamp race."""
	if not name:
		frappe.throw(_("POS Closing Entry is required."))

	doc = frappe.get_doc("POS Closing Entry", name)
	_authorize_closing_entry(doc)

	if doc.docstatus != 0:
		frappe.throw(_("This closing entry is already submitted."))

	if doc.status == "Failed":
		doc.db_set({"status": "Draft", "error_message": ""})
		doc.reload()

	if payment_reconciliation:
		_apply_closing_amounts(doc, payment_reconciliation)

	_reload_closing_invoices(doc, preserve_closing=True)

	throw_if_closing_blocked(doc)

	doc.save()
	doc.submit()

	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"status": doc.status,
	}
