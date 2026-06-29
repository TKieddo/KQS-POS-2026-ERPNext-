# Copyright (c) 2026, KQS

import frappe
from frappe import _
from frappe.utils import flt, today

from kqs_retail.kqs_layby.settings import get_layby_settings
from kqs_retail.kqs_layby.stock_reservation import get_sellable_qty


def has_app_permission():
	return frappe.has_permission("Layby Agreement", "read")


def has_pos_app_permission():
	return frappe.has_permission("Sales Invoice", "read") or frappe.has_permission(
		"POS Profile", "read"
	)



@frappe.whitelist()
def get_sellable_stock(item_code: str, warehouse: str) -> dict:
	"""API for POS / website: on-hand minus layby holds."""
	qty = get_sellable_qty(item_code, warehouse)
	return {"item_code": item_code, "warehouse": warehouse, "sellable_qty": qty}


@frappe.whitelist()
def search_layby_agreements(query: str = "", warehouse: str = "", limit: int = 20):
	filters = {"docstatus": 1, "status": "Active"}
	if warehouse:
		filters["warehouse"] = warehouse

	or_filters = []
	if query:
		or_filters = [
			["name", "like", f"%{query}%"],
			["customer_name", "like", f"%{query}%"],
		]

	return frappe.get_all(
		"Layby Agreement",
		filters=filters,
		or_filters=or_filters if or_filters else None,
		fields=[
			"name",
			"customer",
			"customer_name",
			"warehouse",
			"total_amount",
			"paid_amount",
			"balance_amount",
			"status",
			"due_date",
		],
		limit_page_length=limit,
		order_by="modified desc",
	)


@frappe.whitelist()
def create_layby_from_cart(
	customer: str,
	company: str,
	warehouse: str,
	items: str,
	deposit_paid: float,
	pos_profile: str = "",
	deposit_percent: float = 20,
	payments: str = "",
):
	"""Create and submit layby from POS cart JSON."""
	import json

	settings = get_layby_settings()
	if not settings.get("layby_enabled_on_pos"):
		frappe.throw(_("Layby is disabled in KQS Retail Settings."))

	min_deposit_percent = settings["minimum_deposit_percent"]
	deposit_percent = flt(deposit_percent) or min_deposit_percent
	if deposit_percent < min_deposit_percent:
		frappe.throw(
			_("Deposit must be at least {0}% (KQS Retail Settings).").format(min_deposit_percent)
		)

	cart = json.loads(items) if isinstance(items, str) else items
	payment_lines = _parse_layby_payment_lines(payments, deposit_paid)

	doc = frappe.new_doc("Layby Agreement")
	doc.customer = customer
	doc.company = company
	doc.warehouse = warehouse
	doc.pos_profile = pos_profile or None
	doc.deposit_percent = deposit_percent
	doc.paid_amount = flt(deposit_paid)
	doc.posting_date = today()

	for line in cart:
		doc.append(
			"items",
			{
				"item_code": line["item_code"],
				"qty": line.get("qty", 1),
				"rate": line.get("rate", 0),
			},
		)

	doc.insert(ignore_permissions=True)
	doc.submit()
	_record_opening_layby_payments(doc.name, payment_lines)
	return doc.as_dict()


def _parse_layby_payment_lines(payments: str, deposit_paid: float) -> list[dict]:
	import json

	if not payments:
		return []
	raw = json.loads(payments) if isinstance(payments, str) else payments
	if not isinstance(raw, list):
		frappe.throw(_("Invalid payments payload."))
	lines = [row for row in raw if flt(row.get("amount")) > 0]
	total = sum(flt(row.get("amount")) for row in lines)
	if lines and abs(total - flt(deposit_paid)) > 0.009:
		frappe.throw(
			_("Payment lines ({0}) must equal deposit received ({1}).").format(total, deposit_paid)
		)
	return lines


def _record_opening_layby_payments(agreement_name: str, lines: list[dict]) -> None:
	for row in lines:
		pay = frappe.new_doc("Layby Payment")
		pay.layby_agreement = agreement_name
		pay.amount = flt(row.get("amount"))
		pay.mode_of_payment = row.get("mode_of_payment") or None
		pay.posting_date = today()
		pay.flags.skip_balance_update = True
		pay.insert(ignore_permissions=True)
		pay.submit()


def _parse_installment_payment_lines(payments: str) -> list[dict]:
	import json

	if not payments:
		return []
	raw = json.loads(payments) if isinstance(payments, str) else payments
	if not isinstance(raw, list):
		frappe.throw(_("Invalid payments payload."))
	lines = [row for row in raw if flt(row.get("amount")) > 0]
	if not lines:
		frappe.throw(_("Enter at least one payment amount."))
	return lines


def _layby_payment_response(agreement, payment) -> dict:
	return {
		"payment": payment.as_dict(),
		"layby_agreement": agreement.name,
		"status": agreement.status,
		"sales_invoice": agreement.sales_invoice or None,
	}


@frappe.whitelist()
def record_layby_payment(
	layby_agreement: str,
	payments: str = "",
	amount: float | None = None,
	mode_of_payment: str | None = None,
	reference_no: str | None = None,
):
	if payments:
		lines = _parse_installment_payment_lines(payments)
		agreement = frappe.get_doc("Layby Agreement", layby_agreement)
		total = sum(flt(row.get("amount")) for row in lines)
		if total > flt(agreement.balance_amount):
			frappe.throw(
				_("Payment ({0}) exceeds balance ({1}).").format(total, agreement.balance_amount)
			)
		last_pay = None
		for row in lines:
			pay = frappe.new_doc("Layby Payment")
			pay.layby_agreement = layby_agreement
			pay.amount = flt(row.get("amount"))
			pay.mode_of_payment = row.get("mode_of_payment") or None
			pay.reference_no = row.get("reference_no") or reference_no or None
			pay.posting_date = today()
			pay.insert(ignore_permissions=True)
			pay.submit()
			last_pay = pay
		agreement.reload()
		return _layby_payment_response(agreement, last_pay)

	if not flt(amount):
		frappe.throw(_("Enter at least one payment amount."))

	pay = frappe.new_doc("Layby Payment")
	pay.layby_agreement = layby_agreement
	pay.amount = flt(amount)
	pay.mode_of_payment = mode_of_payment or None
	pay.reference_no = reference_no
	pay.posting_date = today()
	pay.insert(ignore_permissions=True)
	pay.submit()
	agreement = frappe.get_doc("Layby Agreement", layby_agreement)
	return _layby_payment_response(agreement, pay)
