# Copyright (c) 2026, KQS
"""Amend active layby lines — variant swap or manager full product swap."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, today

from kqs_retail.kqs_layby.stock_reservation import get_sellable_qty
from kqs_retail.utils.items import get_variant_attributes, get_variant_attributes_bulk, resolve_template_code
from kqs_retail.utils.layby_cancel import _create_refund_payment_entry
from kqs_retail.utils.layby_ops_common import assert_active_layby, get_layby_agreement, require_manager

OVERPAYMENT_KEEP = "keep"
OVERPAYMENT_REFUND = "refund"


def _get_item_selling_rate(item_code: str) -> float:
	return flt(frappe.db.get_value("Item", item_code, "standard_rate"))


def _get_layby_line(doc, line_idx: int):
	idx = int(line_idx)
	if idx < 0 or idx >= len(doc.items):
		frappe.throw(_("Invalid layby line index."))
	return doc.items[idx]


def validate_replacement(old_item_code: str, new_item_code: str, manager_approved: bool) -> None:
	old_item_code = (old_item_code or "").strip()
	new_item_code = (new_item_code or "").strip()
	if not new_item_code or not frappe.db.exists("Item", new_item_code):
		frappe.throw(_("Item {0} not found.").format(new_item_code))
	if old_item_code == new_item_code:
		frappe.throw(_("Select a different item."))

	old_tpl = resolve_template_code(old_item_code)
	new_tpl = resolve_template_code(new_item_code)
	if old_tpl == new_tpl:
		return
	if not manager_approved:
		frappe.throw(
			_("Full product swap requires manager approval (different style/template).")
		)
	require_manager()


def _available_qty_for_swap(
	item_code: str,
	warehouse: str,
	agreement_name: str,
	old_item_code: str,
	qty_needed: float,
) -> float:
	"""Sellable qty for new SKU; current line's hold on old SKU does not block new SKU."""
	return get_sellable_qty(item_code, warehouse)


def _recalc_agreement_amounts(doc) -> dict:
	total = 0.0
	for row in doc.items:
		row.amount = flt(row.qty) * flt(row.rate)
		total += row.amount
	paid = flt(doc.paid_amount)
	return {
		"total_amount": total,
		"deposit_amount": flt(total) * flt(doc.deposit_percent) / 100,
		"paid_amount": paid,
		"balance_amount": flt(total) - paid,
	}


def preview_amend_layby(
	agreement_name: str,
	line_idx: int,
	new_item_code: str,
	manager_approved: bool = False,
) -> dict:
	doc = frappe.get_doc("Layby Agreement", agreement_name)
	assert_active_layby(doc)
	line = _get_layby_line(doc, line_idx)
	old_item = line.item_code
	validate_replacement(old_item, new_item_code, cbool(manager_approved))

	qty = flt(line.qty)
	if _available_qty_for_swap(new_item_code, doc.warehouse, agreement_name, old_item, qty) < qty - 0.0001:
		frappe.throw(
			_("Not enough sellable stock for {0} at {1}.").format(new_item_code, doc.warehouse)
		)

	new_rate = _get_item_selling_rate(new_item_code)
	old_total = flt(doc.total_amount)
	old_balance = flt(doc.balance_amount)
	new_line_amount = qty * new_rate
	old_line_amount = flt(line.amount)
	new_total = old_total - old_line_amount + new_line_amount
	new_balance = new_total - flt(doc.paid_amount)
	overpayment = flt(doc.paid_amount) - new_total if new_total < flt(doc.paid_amount) else 0

	old_tpl = resolve_template_code(old_item)
	new_tpl = resolve_template_code(new_item_code)
	same_template = old_tpl == new_tpl

	return {
		"agreement": agreement_name,
		"line_idx": int(line_idx),
		"old_item_code": old_item,
		"old_item_name": line.item_name,
		"new_item_code": new_item_code,
		"new_item_name": frappe.db.get_value("Item", new_item_code, "item_name"),
		"qty": qty,
		"old_rate": flt(line.rate),
		"new_rate": new_rate,
		"old_total_amount": old_total,
		"new_total_amount": new_total,
		"old_balance_amount": old_balance,
		"new_balance_amount": new_balance,
		"price_delta": new_total - old_total,
		"overpayment": overpayment,
		"same_template": same_template,
		"requires_manager": not same_template,
		"old_attributes": get_variant_attributes(old_item),
		"new_attributes": get_variant_attributes(new_item_code),
	}


def search_amend_replacements(
	agreement_name: str,
	line_idx: int,
	query: str = "",
	manager_approved: bool = False,
	limit: int = 20,
) -> list[dict]:
	doc = frappe.get_doc("Layby Agreement", agreement_name)
	assert_active_layby(doc)
	line = _get_layby_line(doc, line_idx)
	old_item = line.item_code
	old_tpl = resolve_template_code(old_item)
	qty = flt(line.qty)
	limit = min(int(limit or 20), 50)
	query = (query or "").strip()

	filters: dict = {"disabled": 0, "is_stock_item": 1}
	if not cbool(manager_approved):
		if frappe.db.get_value("Item", old_tpl, "has_variants"):
			filters["variant_of"] = old_tpl
		else:
			filters["name"] = ["in", [old_item]]

	or_filters = None
	if query:
		or_filters = [
			["item_code", "like", f"%{query}%"],
			["item_name", "like", f"%{query}%"],
			["name", "like", f"%{query}%"],
		]

	items = frappe.get_all(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "item_name", "item_code", "standard_rate", "variant_of"],
		limit_page_length=limit * 3,
		order_by="item_name asc",
	)

	results: list[dict] = []
	for item in items:
		if item.name == old_item:
			continue
		sellable = _available_qty_for_swap(item.name, doc.warehouse, agreement_name, old_item, qty)
		if sellable < qty - 0.0001:
			continue
		results.append(
			{
				"item_code": item.name,
				"item_name": item.item_name,
				"rate": flt(item.standard_rate),
				"sellable_qty": sellable,
				"variant_of": item.variant_of or "",
			}
		)
		if len(results) >= limit:
			break

	attr_map = get_variant_attributes_bulk([row["item_code"] for row in results])
	for row in results:
		row["attributes"] = attr_map.get(row["item_code"], [])
	return results


def amend_layby_line(
	agreement_name: str,
	line_idx: int,
	new_item_code: str,
	manager_approved: bool = False,
	overpayment_action: str = OVERPAYMENT_KEEP,
	overpayment_mode_of_payment: str | None = None,
	note: str = "",
) -> dict:
	doc = get_layby_agreement(agreement_name)
	preview = preview_amend_layby(agreement_name, line_idx, new_item_code, manager_approved)
	line = _get_layby_line(doc, line_idx)

	line.item_code = preview["new_item_code"]
	line.item_name = preview["new_item_name"]
	line.rate = preview["new_rate"]
	line.amount = flt(line.qty) * flt(line.rate)

	amounts = _recalc_agreement_amounts(doc)
	overpayment = flt(preview["overpayment"])
	refund_pe = ""

	if overpayment > 0.009:
		action = (overpayment_action or OVERPAYMENT_KEEP).strip().lower()
		if action == OVERPAYMENT_REFUND:
			if not (overpayment_mode_of_payment or "").strip():
				frappe.throw(_("Select a payment mode to refund the overpayment."))
			pe = _create_refund_payment_entry(
				doc.customer,
				doc.company,
				overpayment,
				overpayment_mode_of_payment.strip(),
				agreement_name,
			)
			refund_pe = pe.name
			amounts["paid_amount"] = flt(amounts["total_amount"])
			amounts["balance_amount"] = 0
		elif action != OVERPAYMENT_KEEP:
			frappe.throw(_("Invalid overpayment action."))

	audit_parts = [
		_("Item changed {0} → {1} on {2}").format(
			preview["old_item_code"], preview["new_item_code"], today()
		)
	]
	if note:
		audit_parts.append(note.strip())
	existing = (doc.notes or "").strip()
	new_notes = f"{existing}\n" + "\n".join(audit_parts) if existing else "\n".join(audit_parts)

	doc.total_amount = amounts["total_amount"]
	doc.deposit_amount = amounts["deposit_amount"]
	doc.paid_amount = amounts["paid_amount"]
	doc.balance_amount = amounts["balance_amount"]
	doc.notes = new_notes.strip()

	doc.flags.ignore_validate_update_after_submit = True
	doc.save(ignore_permissions=True)

	if flt(doc.balance_amount) <= 0:
		doc.reload()
		doc._try_complete()

	return {
		"agreement": agreement_name,
		"status": frappe.db.get_value("Layby Agreement", agreement_name, "status"),
		"sales_invoice": frappe.db.get_value("Layby Agreement", agreement_name, "sales_invoice"),
		**preview,
		"overpayment_action": overpayment_action,
		"overpayment_refund_entry": refund_pe,
	}


def cbool(value) -> bool:
	return bool(int(value)) if str(value).isdigit() else bool(value)
