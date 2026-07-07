# Copyright (c) 2026, KQS
"""Store-credit returns — separate from POS checkout."""

from __future__ import annotations

import json
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, date_diff, flt, getdate

from kqs_retail.utils.customer_account import is_account_sale_mode
from kqs_retail.utils.store_credit import (
	get_customer_store_credit_balance,
	is_store_credit_mode,
	is_walk_in_customer,
	resolve_store_credit_mode,
)

REFUND_TO_ACCOUNT = "account"

ALLOWED_INVOICE_DOCTYPES = ("Sales Invoice", "POS Invoice")
RECEIPT_LIST_FIELDS = [
	"name",
	"grand_total",
	"currency",
	"customer",
	"customer_name",
	"posting_time",
	"posting_date",
	"owner",
	"pos_profile",
]


def get_return_policy() -> dict[str, int]:
	"""Return acceptance vs receipt search windows from KQS Retail Settings."""
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings

	settings = get_kqs_retail_settings()
	return {
		"return_window_days": cint(settings.get("return_window_days") or 14),
		"receipt_search_window_days": cint(settings.get("receipt_search_window_days") or 30),
	}


def _days_since_sale(posting_date) -> int:
	posting = getdate(posting_date)
	if not posting:
		return 9999
	return date_diff(getdate(), posting)


def _earliest_search_date(search_days: int):
	from frappe.utils import add_days

	earliest = add_days(getdate(), -search_days)
	return getdate(earliest)


def _annotate_receipt_eligibility(receipts: list[dict], return_days: int) -> list[dict]:
	for row in receipts:
		age = _days_since_sale(row.get("posting_date"))
		row["days_since_sale"] = age
		row["return_eligible"] = age <= return_days
	return receipts


def resolve_pos_store(pos_profile: str) -> dict[str, str]:
	"""Company + warehouse for the active till (all cashiers at this store)."""
	if not pos_profile:
		frappe.throw(_("Open Returns from Point of Sale so we know which store you are on."))
	if not frappe.db.exists("POS Profile", pos_profile):
		frappe.throw(_("POS Profile not found."))

	row = frappe.db.get_value(
		"POS Profile",
		pos_profile,
		["company", "warehouse", "name"],
		as_dict=True,
	)
	warehouse = row.warehouse
	if not warehouse:
		frappe.throw(_("POS Profile {0} has no warehouse configured.").format(pos_profile))

	warehouse_label = (
		frappe.db.get_value("Warehouse", warehouse, "warehouse_name") or warehouse
	)
	return {
		"pos_profile": pos_profile,
		"company": row.company,
		"warehouse": warehouse,
		"store_label": warehouse_label,
	}


def _invoice_or_filters(search_term: str) -> dict | None:
	term = (search_term or "").strip()
	if not term:
		return None
	like = f"%{term}%"
	return {
		"name": ["like", like],
		"customer_name": ["like", like],
		"customer": ["like", like],
	}


def _fetch_store_invoices(
	doctype: str,
	base_filters: dict,
	search_term: str,
	limit: int,
) -> list[dict]:
	rows = frappe.get_list(
		doctype,
		filters=base_filters,
		or_filters=_invoice_or_filters(search_term),
		fields=RECEIPT_LIST_FIELDS,
		order_by="posting_date desc, posting_time desc",
		limit_page_length=limit,
	)
	for row in rows:
		row["doctype"] = doctype
		row["cashier"] = frappe.utils.get_fullname(row.get("owner")) or row.get("owner")
	return rows


def _sort_receipts(rows: list[dict], limit: int) -> list[dict]:
	from frappe.utils import get_datetime

	ordered = sorted(
		rows,
		key=lambda row: get_datetime(f"{row.get('posting_date')} {row.get('posting_time')}"),
		reverse=True,
	)
	return ordered[:limit]


def search_store_receipts(
	pos_profile: str,
	search_term: str = "",
	limit: int = 25,
) -> dict[str, Any]:
	"""Paid POS sales at this store within the search window (any cashier)."""
	policy = get_return_policy()
	store = resolve_pos_store(pos_profile)
	earliest = _earliest_search_date(policy["receipt_search_window_days"])
	limit = min(int(limit or 25), 50)

	pos_filters = {
		"docstatus": 1,
		"company": store["company"],
		"status": "Paid",
		"is_return": 0,
		"set_warehouse": store["warehouse"],
		"posting_date": [">=", earliest],
	}
	sales_filters = {
		"docstatus": 1,
		"company": store["company"],
		"is_created_using_pos": 1,
		"is_consolidated": 0,
		"is_return": 0,
		"pos_closing_entry": ["is", "not set"],
		"set_warehouse": store["warehouse"],
		"posting_date": [">=", earliest],
	}

	rows = _fetch_store_invoices("POS Invoice", pos_filters, search_term, limit)
	rows += _fetch_store_invoices("Sales Invoice", sales_filters, search_term, limit)
	receipts = _annotate_receipt_eligibility(_sort_receipts(rows, limit), policy["return_window_days"])

	return {
		"receipts": receipts,
		"store_label": store["store_label"],
		"warehouse": store["warehouse"],
		"pos_profile": store["pos_profile"],
		"return_window_days": policy["return_window_days"],
		"receipt_search_window_days": policy["receipt_search_window_days"],
		"count": len(receipts),
	}


def validate_same_store(source, pos_profile: str) -> None:
	"""Receipt must have been sold from this store's warehouse."""
	if not pos_profile:
		return
	store = resolve_pos_store(pos_profile)
	if source.company != store["company"]:
		frappe.throw(_("This receipt belongs to another company."))

	invoice_warehouse = source.get("set_warehouse")
	if not invoice_warehouse and source.get("items"):
		invoice_warehouse = source.items[0].warehouse

	if invoice_warehouse and invoice_warehouse != store["warehouse"]:
		frappe.throw(
			_("This receipt was sold at {0}. Returns must be processed at the same store.").format(
				frappe.db.get_value("Warehouse", invoice_warehouse, "warehouse_name")
				or invoice_warehouse
			)
		)


def _parse_items(items) -> list[dict[str, Any]]:
	if isinstance(items, str):
		items = json.loads(items)
	if not isinstance(items, list) or not items:
		frappe.throw(_("Select at least one item to return."))
	return items


def _assert_invoice_doctype(doctype: str) -> None:
	if doctype not in ALLOWED_INVOICE_DOCTYPES:
		frappe.throw(_("Only POS sales receipts can be returned here."))


def validate_return_window(source) -> None:
	policy = get_return_policy()
	return_days = policy["return_window_days"]
	posting = getdate(source.posting_date)
	if not posting or date_diff(getdate(), posting) > return_days:
		frappe.throw(
			_("Returns are only accepted within {0} days of sale (receipt dated {1}).").format(
				return_days,
				frappe.format(posting, {"fieldtype": "Date"}),
			)
		)


def get_returnable_invoice_lines(doctype: str, invoice_name: str) -> list[dict[str, Any]]:
	from erpnext.controllers.sales_and_purchase_return import get_returned_qty_map_for_row

	_assert_invoice_doctype(doctype)
	source = frappe.get_doc(doctype, invoice_name)
	if source.docstatus != 1 or cint(source.is_return):
		frappe.throw(_("Only submitted sales can be returned."))
	validate_return_window(source)

	lines: list[dict[str, Any]] = []
	for row in source.items:
		returned = get_returned_qty_map_for_row(invoice_name, source.customer, row.name, doctype)
		returned_qty = flt(returned.get("qty") or 0)
		returnable = flt(row.qty) - returned_qty
		if returnable <= 0:
			continue
		lines.append(
			{
				"item_row_name": row.name,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"sold_qty": flt(row.qty),
				"returnable_qty": returnable,
				"rate": flt(row.rate),
				"uom": row.uom,
				"warehouse": row.warehouse,
			}
		)
	return lines


def get_invoice_return_context(
	doctype: str, invoice_name: str, pos_profile: str = ""
) -> dict[str, Any]:
	from erpnext.controllers.sales_and_purchase_return import is_invoice_returnable

	_assert_invoice_doctype(doctype)
	if not is_invoice_returnable(doctype, invoice_name):
		frappe.throw(_("All items on this receipt have already been returned."))

	source = frappe.get_doc(doctype, invoice_name)
	if pos_profile:
		validate_same_store(source, pos_profile)
	validate_return_window(source)
	lines = get_returnable_invoice_lines(doctype, invoice_name)
	if not lines:
		frappe.throw(_("No returnable items on this receipt."))

	return {
		"doctype": doctype,
		"name": source.name,
		"customer": source.customer,
		"customer_name": source.customer_name,
		"is_walk_in": is_walk_in_customer(source.customer),
		"posting_date": source.posting_date,
		"grand_total": flt(source.grand_total),
		"currency": source.currency,
		"company": source.company,
		"pos_profile": source.get("pos_profile"),
		"items": lines,
	}


def _make_return_draft(doctype: str, invoice_name: str):
	if doctype == "POS Invoice":
		from erpnext.accounts.doctype.pos_invoice.pos_invoice import make_sales_return

		return make_sales_return(invoice_name)
	from erpnext.accounts.doctype.sales_invoice.sales_invoice import make_sales_return

	return make_sales_return(invoice_name)


def _apply_selected_return_lines(return_doc, selections: list[dict[str, Any]]) -> None:
	selected = {
		row["item_row_name"]: flt(row.get("qty"))
		for row in selections
		if row.get("item_row_name") and flt(row.get("qty")) > 0
	}
	if not selected:
		frappe.throw(_("Select at least one item to return."))

	kept = []
	for row in return_doc.items:
		source_row = (
			getattr(row, "sales_invoice_item", None)
			or getattr(row, "pos_invoice_item", None)
			or getattr(row, "delivery_note_item", None)
		)
		if not source_row or source_row not in selected:
			continue
		max_qty = abs(flt(row.qty))
		qty = min(selected[source_row], max_qty)
		if qty <= 0:
			continue
		row.qty = -qty
		if hasattr(row, "stock_qty"):
			row.stock_qty = -qty * flt(row.conversion_factor or 1)
		kept.append(row)

	if not kept:
		frappe.throw(_("Select at least one item to return."))

	return_doc.items = kept
	return_doc.run_method("calculate_taxes_and_totals")


def _get_pos_refund_payment_modes(pos_profile: str) -> list[str]:
	"""Cash/card modes on the till profile — excludes Store Credit (redemption only)."""
	if not pos_profile or not frappe.db.exists("POS Profile", pos_profile):
		return []
	rows = frappe.get_all(
		"POS Payment Method",
		filters={"parent": pos_profile, "parenttype": "POS Profile"},
		fields=["mode_of_payment"],
		order_by="idx asc",
	)
	modes: list[str] = []
	for row in rows:
		mop = row.mode_of_payment
		if not mop or is_store_credit_mode(mop) or is_account_sale_mode(mop):
			continue
		if mop not in modes:
			modes.append(mop)
	return modes


def _get_invoice_payment_modes(doctype: str, invoice_name: str) -> list[str]:
	"""Modes used on the original sale (for refund-to-original suggestion)."""
	doc = frappe.get_doc(doctype, invoice_name)
	modes: list[str] = []
	for row in doc.get("payments") or []:
		if flt(row.amount) <= 0:
			continue
		mop = row.mode_of_payment
		if not mop or is_store_credit_mode(mop) or is_account_sale_mode(mop):
			continue
		if mop not in modes:
			modes.append(mop)
	return modes


def get_return_refund_options(
	doctype: str,
	invoice_name: str,
	pos_profile: str = "",
) -> dict[str, Any]:
	"""Refund targets for Returns & Store Credit step 3."""
	_assert_invoice_doctype(doctype)
	pos_modes = _get_pos_refund_payment_modes(pos_profile)
	original_modes = _get_invoice_payment_modes(doctype, invoice_name)
	suggested_payment = original_modes[0] if original_modes else (pos_modes[0] if pos_modes else None)
	return {
		"default_refund_type": REFUND_TO_ACCOUNT,
		"account_label": _("Customer account"),
		"store_credit_mode": resolve_store_credit_mode(),
		"pos_payment_modes": pos_modes,
		"original_payment_modes": original_modes,
		"suggested_payment_mode": suggested_payment,
	}


def _sync_return_payments(
	return_doc,
	refund_type: str = REFUND_TO_ACCOUNT,
	mode_of_payment: str | None = None,
) -> None:
	total = flt(return_doc.rounded_total or return_doc.grand_total)
	if total >= 0:
		frappe.throw(_("Return total must be negative."))

	if refund_type == REFUND_TO_ACCOUNT:
		# Store credit: unallocated credit note on the customer (no till payout).
		for row in return_doc.payments or []:
			row.amount = 0
		return_doc.paid_amount = 0
		return_doc.change_amount = 0
		return_doc.write_off_amount = 0
		return

	if not return_doc.payments:
		frappe.throw(_("No payment modes on return document."))

	target = (mode_of_payment or "").strip()
	if not target:
		default_row = next((row for row in return_doc.payments if row.default), return_doc.payments[0])
		target = default_row.mode_of_payment

	if is_store_credit_mode(target):
		frappe.throw(_("Store Credit is for spending credit on a sale, not for issuing a refund."))

	matched = False
	for row in return_doc.payments:
		if row.mode_of_payment == target:
			row.amount = total
			matched = True
		else:
			row.amount = 0

	if not matched:
		frappe.throw(_("Payment mode {0} is not configured on this till.").format(target))

	return_doc.paid_amount = total
	return_doc.change_amount = 0
	return_doc.write_off_amount = 0


def submit_store_credit_return(
	doctype: str,
	invoice_name: str,
	customer: str,
	items,
	pos_profile: str = "",
	refund_type: str = REFUND_TO_ACCOUNT,
	mode_of_payment: str | None = None,
) -> dict[str, Any]:
	_assert_invoice_doctype(doctype)
	refund_type = (refund_type or REFUND_TO_ACCOUNT).strip().lower()
	if refund_type not in (REFUND_TO_ACCOUNT, "payment"):
		frappe.throw(_("Invalid refund type."))
	if refund_type == "payment" and not (mode_of_payment or "").strip():
		frappe.throw(_("Select a payment mode for the refund."))

	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer is required."))
	if refund_type == REFUND_TO_ACCOUNT and is_walk_in_customer(customer):
		frappe.throw(_("Store credit cannot be assigned to Walk-in Customer."))

	selections = _parse_items(items)
	get_invoice_return_context(doctype, invoice_name, pos_profile=pos_profile)

	return_doc = frappe.get_doc(_make_return_draft(doctype, invoice_name))
	_apply_selected_return_lines(return_doc, selections)

	return_doc.customer = customer
	return_doc.contact_person = None
	return_doc.contact_email = None
	return_doc.contact_mobile = None

	_sync_return_payments(
		return_doc,
		refund_type=refund_type,
		mode_of_payment=mode_of_payment,
	)
	return_doc.insert(ignore_permissions=True)
	return_doc.submit()

	credit_amount = abs(flt(return_doc.grand_total))
	balance = get_customer_store_credit_balance(customer, return_doc.company)
	result: dict[str, Any] = {
		"credit_note": return_doc.name,
		"customer": customer,
		"credit_amount": credit_amount,
		"currency": return_doc.currency,
		"refund_type": refund_type,
	}
	if refund_type == REFUND_TO_ACCOUNT:
		result["store_credit_balance"] = balance
	else:
		result["refund_mode"] = mode_of_payment
		result["refund_amount"] = credit_amount
	return result
