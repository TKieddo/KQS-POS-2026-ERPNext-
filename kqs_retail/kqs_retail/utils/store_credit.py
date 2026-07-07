# Copyright (c) 2026, KQS
"""Store credit balance and allocation via ERPNext Payment Reconciliation."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

STORE_CREDIT_MODE_CANDIDATES = ("Store Credit", "Account Balance")
RETURN_CREDIT_DOCTYPES = ("Sales Invoice", "POS Invoice")

CACHE_KEY_PREFIX = "kqs_return_credit:"


def _skip_consolidated_pos_merge(doc) -> bool:
	"""POS closing merge builds a consolidated Sales Invoice from already-submitted POS Invoices."""
	return doc.doctype == "Sales Invoice" and doc.get("is_consolidated")


def resolve_store_credit_mode() -> str | None:
	for name in STORE_CREDIT_MODE_CANDIDATES:
		if frappe.db.exists("Mode of Payment", name):
			return name
	return None


def is_store_credit_mode(mode_of_payment: str | None) -> bool:
	if not mode_of_payment:
		return False
	resolved = resolve_store_credit_mode()
	return mode_of_payment == resolved or mode_of_payment in STORE_CREDIT_MODE_CANDIDATES


def is_walk_in_customer(customer: str | None) -> bool:
	if not customer:
		return True
	name = (customer or "").lower()
	if "walk-in" in name or "walk in" in name:
		return True
	customer_name = (frappe.db.get_value("Customer", customer, "customer_name") or "").lower()
	return "walk-in" in customer_name or "walk in" in customer_name


def register_return_credit_customer(customer: str) -> None:
	"""Remember customer for the next POS return credit note (per session user)."""
	if not customer or not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer is required for store credit."))
	if is_walk_in_customer(customer):
		frappe.throw(_("Store credit cannot be assigned to Walk-in Customer."))
	key = f"{CACHE_KEY_PREFIX}{frappe.session.user}"
	frappe.cache().set_value(key, customer, expires_in_sec=3600)


def pop_return_credit_customer() -> str | None:
	key = f"{CACHE_KEY_PREFIX}{frappe.session.user}"
	customer = frappe.cache().get_value(key)
	if customer:
		frappe.cache().delete_value(key)
	return customer


def apply_return_credit_customer(doc, method=None) -> None:
	"""Before return submit: assign credit to named customer instead of Walk-in."""
	if not doc.is_return or doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	customer = pop_return_credit_customer()
	if not customer:
		return
	if not is_walk_in_customer(doc.customer):
		return
	doc.customer = customer


def get_party_receivable_account(customer: str, company: str) -> str:
	from erpnext.accounts.party import get_party_account

	return get_party_account("Customer", customer, company)


def _get_allocated_return_credit(doctype: str, name: str) -> float:
	"""Return credit already applied to later sales."""
	kqs_allocated = flt(frappe.db.get_value(doctype, name, "kqs_store_credit_allocated"))
	if kqs_allocated > 0:
		return kqs_allocated

	pe_allocated = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(per.allocated_amount), 0)
		FROM `tabPayment Entry Reference` per
		INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent AND pe.docstatus = 1
		WHERE per.reference_doctype = %s AND per.reference_name = %s
		""",
		(doctype, name),
	)
	return flt(pe_allocated[0][0] if pe_allocated else 0)


def _ensure_return_credit_outstanding(doctype: str, name: str) -> None:
	"""Sales Invoice returns need negative outstanding for ERPNext PR; POS uses kqs_store_credit_allocated."""
	if doctype != "Sales Invoice":
		return
	credit_total = abs(flt(frappe.db.get_value(doctype, name, "grand_total")))
	if credit_total <= 0:
		return
	outstanding = flt(frappe.db.get_value(doctype, name, "outstanding_amount"))
	if abs(outstanding) + 0.01 >= credit_total:
		return
	frappe.db.set_value(
		doctype,
		name,
		{"outstanding_amount": -credit_total},
		update_modified=False,
	)


def ensure_return_credit_outstanding(doc, method=None) -> None:
	"""After return submit: keep Sales Invoice credit notes reconcilable in ERPNext."""
	if not doc.is_return or doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	if is_walk_in_customer(doc.customer):
		return
	_ensure_return_credit_outstanding(doc.doctype, doc.name)


def _allocate_return_credit_to_sale(doc, amount: float) -> float:
	"""Spend return credit notes against a submitted POS sale (tracked on each return CN)."""
	returns = _get_unallocated_return_credits(doc.customer, doc.company)
	if not returns:
		return 0.0

	applied = 0.0
	remaining = flt(amount)
	for ret in returns:
		if remaining <= 0:
			break
		take = min(flt(ret["unallocated"]), remaining)
		if take <= 0:
			continue
		current = _get_allocated_return_credit(ret["doctype"], ret["name"])
		frappe.db.set_value(
			ret["doctype"],
			ret["name"],
			{"kqs_store_credit_allocated": current + take},
			update_modified=False,
		)
		applied += take
		remaining -= take

	return applied


def _get_unallocated_return_credits(customer: str, company: str) -> list[dict]:
	"""Submitted return invoices with credit left to spend."""
	rows: list[dict] = []
	for doctype in RETURN_CREDIT_DOCTYPES:
		credits = frappe.get_all(
			doctype,
			filters={
				"customer": customer,
				"company": company,
				"is_return": 1,
				"docstatus": 1,
			},
			fields=["name", "grand_total", "posting_date"],
			order_by="posting_date asc, creation asc",
		)
		for credit in credits:
			total = abs(flt(credit.grand_total))
			if total <= 0:
				continue
			allocated = _get_allocated_return_credit(doctype, credit.name)
			unallocated = total - allocated
			if unallocated > 0.009:
				rows.append(
					{
						"doctype": doctype,
						"name": credit.name,
						"unallocated": unallocated,
						"posting_date": credit.posting_date,
					}
				)
	return rows


def get_customer_store_credit_balance(customer: str, company: str) -> float:
	"""Unallocated return credit notes (POS Invoice + Sales Invoice)."""
	if not customer or is_walk_in_customer(customer):
		return 0.0

	return sum(row["unallocated"] for row in _get_unallocated_return_credits(customer, company))


def get_store_credit_payment_amount(doc) -> float:
	total = 0.0
	for row in doc.get("payments") or []:
		if is_store_credit_mode(row.mode_of_payment):
			total += flt(row.amount)
	return total


def reconcile_store_credit_for_invoice(doc, amount: float) -> float:
	"""Allocate return credit notes to a submitted POS sales invoice."""
	amount = flt(amount)
	if amount <= 0:
		return 0.0
	return _allocate_return_credit_to_sale(doc, amount)


def _strip_pos_merge_payment_rows(doc) -> None:
	"""Store credit / on-account were settled on each POS Invoice — drop rows for merge GL."""
	from kqs_retail.utils.customer_account import _default_cash_mode_and_account, is_account_sale_mode

	kept = [
		row
		for row in doc.get("payments") or []
		if not is_store_credit_mode(row.mode_of_payment) and not is_account_sale_mode(row.mode_of_payment)
	]
	doc.set("payments", kept)
	if hasattr(doc, "set_paid_amount"):
		doc.set_paid_amount()
	if hasattr(doc, "set_outstanding_amount"):
		doc.set_outstanding_amount()

	# ERPNext requires at least one payment row on consolidated POS sales invoices.
	if not doc.get("payments") and flt(doc.grand_total) > 0:
		paid = flt(doc.paid_amount) or (flt(doc.grand_total) - flt(doc.outstanding_amount))
		if paid <= 0.009:
			paid = flt(doc.grand_total)
		mode, account = _default_cash_mode_and_account(doc.company)
		if mode and account:
			doc.append(
				"payments",
				{
					"mode_of_payment": mode,
					"amount": paid,
					"base_amount": paid,
					"account": account,
					"type": "Cash",
				},
			)


def prepare_store_credit_before_submit(doc, method=None) -> None:
	"""Strip Store Credit payment rows so invoice keeps outstanding for reconciliation."""
	if doc.is_return or not doc.get("is_pos"):
		return
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	if _skip_consolidated_pos_merge(doc):
		_strip_pos_merge_payment_rows(doc)
		return
	if is_walk_in_customer(doc.customer):
		return

	credit = get_store_credit_payment_amount(doc)
	if credit <= 0:
		return

	available = get_customer_store_credit_balance(doc.customer, doc.company)
	if credit > available + 0.01:
		frappe.throw(
			_("Store credit amount {0} exceeds available balance {1}.").format(
				frappe.format(credit, {"fieldtype": "Currency"}),
				frappe.format(available, {"fieldtype": "Currency"}),
			)
		)

	doc._kqs_store_credit_to_apply = credit
	for row in list(doc.get("payments") or []):
		if is_store_credit_mode(row.mode_of_payment):
			doc.remove(row)
	if hasattr(doc, "set_paid_amount"):
		doc.set_paid_amount()
	if hasattr(doc, "set_outstanding_amount"):
		doc.set_outstanding_amount()


def _store_credit_to_apply(doc) -> float:
	stored = flt(getattr(doc, "_kqs_store_credit_to_apply", 0))
	if stored > 0:
		return stored
	return get_store_credit_payment_amount(doc)


def allocate_store_credit_on_invoice_submit(doc, method=None) -> None:
	"""After POS sale submit: link credit notes to invoice for Store Credit amount."""
	if doc.is_return or not doc.get("is_pos"):
		return
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	if _skip_consolidated_pos_merge(doc):
		return
	if is_walk_in_customer(doc.customer):
		return

	credit_amount = _store_credit_to_apply(doc)
	if credit_amount <= 0:
		return

	applied = reconcile_store_credit_for_invoice(doc, credit_amount)
	if applied <= 0:
		frappe.throw(
			_(
				"Could not apply store credit to this sale. Check the customer has return credit available."
			)
		)
	doc._kqs_store_credit_applied = applied


def finalize_store_credit_on_submit(doc, method=None) -> None:
	"""Remove Store Credit payment rows after Payment Reconciliation (POS hook-order safety net)."""
	if doc.is_return or not doc.get("is_pos"):
		return
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	if _skip_consolidated_pos_merge(doc):
		return
	if is_walk_in_customer(doc.customer):
		return

	applied = flt(getattr(doc, "_kqs_store_credit_applied", 0))
	if applied <= 0:
		return

	grand = flt(doc.rounded_total or doc.grand_total)
	frappe.db.set_value(
		doc.doctype,
		doc.name,
		{"outstanding_amount": 0, "paid_amount": grand},
		update_modified=False,
	)
	for row in list(doc.get("payments") or []):
		if is_store_credit_mode(row.mode_of_payment):
			frappe.db.delete("Sales Invoice Payment", row.name)
