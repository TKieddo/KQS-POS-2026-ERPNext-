# Copyright (c) 2026, KQS
"""Cancel active layby — store credit (default) or till refund (Payment Entry Pay)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import date_diff, flt, today

from kqs_retail.kqs_layby.settings import get_layby_settings
from kqs_retail.utils.ar_payment import is_real_money_mode
from kqs_retail.utils.layby_ops_common import assert_active_layby, get_layby_agreement, require_manager
from kqs_retail.utils.returns import REFUND_TO_ACCOUNT, _get_pos_refund_payment_modes
from kqs_retail.utils.store_credit import get_customer_store_credit_balance, is_walk_in_customer

CANCEL_REASON_CUSTOMER = "customer"
CANCEL_REASON_STORE = "store_error"
LAYBY_REFUND_ITEM_CODE = "LAYBY-REFUND"


def compute_refund_amount(agreement, reason: str = CANCEL_REASON_CUSTOMER) -> dict:
	"""Refund % from KQS Retail Settings and cancel reason."""
	settings = get_layby_settings()
	paid = flt(agreement.paid_amount)
	days_open = date_diff(today(), agreement.posting_date or today())

	if reason == CANCEL_REASON_STORE:
		refund_percent = 100.0
	elif days_open <= settings["early_cancel_full_refund_days"]:
		refund_percent = 100.0
	else:
		refund_percent = flt(settings["late_cancel_refund_percent"])

	refund_amount = flt(paid * refund_percent / 100, 2)
	forfeit_amount = flt(paid - refund_amount, 2)
	return {
		"paid_amount": paid,
		"days_open": days_open,
		"refund_percent": refund_percent,
		"refund_amount": refund_amount,
		"forfeit_amount": forfeit_amount,
		"early_cancel_full_refund_days": settings["early_cancel_full_refund_days"],
		"late_cancel_refund_percent": settings["late_cancel_refund_percent"],
	}


def preview_cancel_layby(agreement_name: str, reason: str = CANCEL_REASON_CUSTOMER) -> dict:
	doc = frappe.get_doc("Layby Agreement", agreement_name)
	assert_active_layby(doc)
	reason = (reason or CANCEL_REASON_CUSTOMER).strip().lower()
	if reason == CANCEL_REASON_STORE:
		require_manager()
	if reason not in (CANCEL_REASON_CUSTOMER, CANCEL_REASON_STORE):
		frappe.throw(_("Invalid cancel reason."))

	amounts = compute_refund_amount(doc, reason)
	return {
		"agreement": agreement_name,
		"customer": doc.customer,
		"customer_name": doc.customer_name,
		"reason": reason,
		**amounts,
	}


def get_cancel_refund_modes(pos_profile: str = "") -> dict:
	modes = _get_pos_refund_payment_modes(pos_profile)
	return {
		"default_refund_type": REFUND_TO_ACCOUNT,
		"account_label": _("Customer account"),
		"pos_payment_modes": modes,
		"suggested_payment_mode": modes[0] if modes else None,
	}


def _ensure_layby_refund_item() -> str:
	if frappe.db.exists("Item", LAYBY_REFUND_ITEM_CODE):
		return LAYBY_REFUND_ITEM_CODE

	item_group = "All Item Groups"
	for candidate in ("Services", "All Item Groups"):
		if frappe.db.exists("Item Group", candidate):
			item_group = candidate
			break
	item = frappe.new_doc("Item")
	item.item_code = LAYBY_REFUND_ITEM_CODE
	item.item_name = _("Layby refund (store credit)")
	item.item_group = item_group
	item.is_stock_item = 0
	item.is_sales_item = 1
	item.standard_rate = 0
	item.insert(ignore_permissions=True)
	return LAYBY_REFUND_ITEM_CODE


def _create_layby_cancel_store_credit_note(
	customer: str,
	company: str,
	amount: float,
	agreement_name: str,
) -> frappe.model.document.Document:
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Refund amount must be positive."))
	if is_walk_in_customer(customer):
		frappe.throw(_("Named customer required for store credit refund."))

	item_code = _ensure_layby_refund_item()
	doc = frappe.new_doc("Sales Invoice")
	doc.customer = customer
	doc.company = company
	doc.is_return = 1
	doc.update_stock = 0
	doc.posting_date = today()
	doc.remarks = _("Layby cancel store credit — {0}").format(agreement_name)
	doc.append("items", {"item_code": item_code, "qty": -1, "rate": amount})
	doc.insert(ignore_permissions=True)
	doc.submit()
	return doc


def _create_refund_payment_entry(
	customer: str,
	company: str,
	amount: float,
	mode_of_payment: str,
	agreement_name: str,
) -> frappe.model.document.Document:
	from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
	from erpnext.accounts.party import get_party_account

	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Refund amount must be positive."))
	if not is_real_money_mode(mode_of_payment):
		frappe.throw(_("Refund mode {0} cannot be used for layby cancel.").format(mode_of_payment or ""))

	party_account = get_party_account("Customer", customer, company)
	bank = get_bank_cash_account(mode_of_payment, company)

	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Pay"
	pe.party_type = "Customer"
	pe.party = customer
	pe.company = company
	pe.posting_date = today()
	pe.mode_of_payment = mode_of_payment
	pe.paid_from = bank["account"]
	pe.paid_to = party_account
	pe.paid_amount = amount
	pe.received_amount = amount
	pe.remarks = _("Layby cancel refund — {0}").format(agreement_name)
	pe.setup_party_account_field()
	pe.set_missing_values()
	pe.flags.ignore_permissions = True
	pe.insert(ignore_permissions=True)
	pe.submit()
	return pe


def cancel_layby(
	agreement_name: str,
	reason: str = CANCEL_REASON_CUSTOMER,
	mode_of_payment: str | None = None,
	refund_type: str = REFUND_TO_ACCOUNT,
) -> dict:
	doc = get_layby_agreement(agreement_name)
	reason = (reason or CANCEL_REASON_CUSTOMER).strip().lower()
	if reason == CANCEL_REASON_STORE:
		require_manager()
	if reason not in (CANCEL_REASON_CUSTOMER, CANCEL_REASON_STORE):
		frappe.throw(_("Invalid cancel reason."))

	refund_type = (refund_type or REFUND_TO_ACCOUNT).strip().lower()
	if refund_type not in (REFUND_TO_ACCOUNT, "payment"):
		frappe.throw(_("Invalid refund type."))
	if refund_type == "payment" and not (mode_of_payment or "").strip():
		frappe.throw(_("Select a payment mode for the refund."))

	amounts = compute_refund_amount(doc, reason)
	refund_amount = flt(amounts["refund_amount"])
	payment_entry_name = ""
	credit_note_name = ""
	store_credit_balance = None

	if refund_amount > 0.009:
		if refund_type == REFUND_TO_ACCOUNT:
			cn = _create_layby_cancel_store_credit_note(
				doc.customer,
				doc.company,
				refund_amount,
				agreement_name,
			)
			credit_note_name = cn.name
			store_credit_balance = get_customer_store_credit_balance(doc.customer, doc.company)
		else:
			pe = _create_refund_payment_entry(
				doc.customer,
				doc.company,
				refund_amount,
				mode_of_payment.strip(),
				agreement_name,
			)
			payment_entry_name = pe.name

	note_line = ""
	if credit_note_name:
		note_line = _("Store credit issued: {0}").format(credit_note_name)
	existing_notes = (doc.notes or "").strip()
	notes = f"{existing_notes}\n{note_line}".strip() if note_line else existing_notes

	frappe.db.set_value(
		"Layby Agreement",
		agreement_name,
		{
			"cancel_reason": reason,
			"refund_amount": refund_amount,
			"forfeit_amount": flt(amounts["forfeit_amount"]),
			"refund_payment_entry": payment_entry_name or None,
			"closed_on": today(),
			"notes": notes or None,
		},
		update_modified=True,
	)

	doc.reload()
	doc.cancel()

	result = {
		"agreement": agreement_name,
		"status": "Cancelled",
		"reason": reason,
		"refund_amount": refund_amount,
		"forfeit_amount": flt(amounts["forfeit_amount"]),
		"refund_payment_entry": payment_entry_name,
		"refund_type": refund_type,
	}
	if refund_type == REFUND_TO_ACCOUNT:
		result["credit_note"] = credit_note_name
		result["store_credit_balance"] = store_credit_balance
	else:
		result["refund_mode"] = mode_of_payment
	return result
