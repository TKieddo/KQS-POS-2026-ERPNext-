# Copyright (c) 2026, KQS
"""Collect Accounts Receivable at POS via standard Payment Entry (Receive)."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, today

from kqs_retail.utils.customer_account import (
	RETURN_CREDIT_DOCTYPES,
	get_customer_ar_outstanding,
	is_account_sale_mode,
)
from kqs_retail.utils.store_credit import is_walk_in_customer, is_store_credit_mode


def is_real_money_mode(mode_of_payment: str | None) -> bool:
	if not mode_of_payment:
		return False
	return not is_store_credit_mode(mode_of_payment) and not is_account_sale_mode(mode_of_payment)


def _parse_payment_lines(payments: str | list) -> list[dict]:
	if not payments:
		return []
	raw = json.loads(payments) if isinstance(payments, str) else payments
	if not isinstance(raw, list):
		frappe.throw(_("Invalid payments payload."))
	lines = [row for row in raw if flt(row.get("amount")) > 0]
	if not lines:
		frappe.throw(_("Enter at least one payment amount."))
	return lines


def get_customer_ar_invoices(customer: str, company: str) -> list[dict]:
	"""Open on-account invoices, oldest first (FIFO allocation order)."""
	if not customer or not company:
		return []

	from kqs_retail.utils.customer_account import repair_legacy_on_account_outstanding

	repair_legacy_on_account_outstanding(customer, company)

	rows: list[dict] = []
	for doctype in RETURN_CREDIT_DOCTYPES:
		invoices = frappe.get_all(
			doctype,
			filters={
				"customer": customer,
				"company": company,
				"docstatus": 1,
				"is_return": 0,
				"outstanding_amount": [">", 0.009],
			},
			fields=["name", "posting_date", "grand_total", "outstanding_amount"],
			order_by="posting_date asc, creation asc",
		)
		for inv in invoices:
			rows.append(
				{
					"name": inv.name,
					"doctype": doctype,
					"posting_date": inv.posting_date,
					"grand_total": flt(inv.grand_total),
					"outstanding_amount": flt(inv.outstanding_amount),
				}
			)

	rows.sort(key=lambda row: (row["posting_date"], row["name"]))
	return rows


def get_customer_ar_details(customer: str, company: str) -> dict:
	if not customer or not company:
		frappe.throw(_("Customer and company are required."))
	if is_walk_in_customer(customer):
		frappe.throw(_("Select a named customer to collect account payments."))

	from kqs_retail.utils.customer_account import repair_legacy_on_account_outstanding

	repair_legacy_on_account_outstanding(customer, company)

	invoices = get_customer_ar_invoices(customer, company)
	ar_outstanding = get_customer_ar_outstanding(customer, company)
	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer

	return {
		"customer": customer,
		"customer_name": customer_name,
		"company": company,
		"ar_outstanding": ar_outstanding,
		"invoices": invoices,
	}


def search_customers_with_ar(query: str = "", company: str = "", limit: int = 30) -> list[dict]:
	"""Customers with AR balance > 0, searchable by name / phone."""
	if not company:
		frappe.throw(_("Company is required."))

	limit = min(int(limit or 30), 50)
	query = (query or "").strip()

	or_filters = None
	if query:
		or_filters = [
			["customer_name", "like", f"%{query}%"],
			["mobile_no", "like", f"%{query}%"],
			["name", "like", f"%{query}%"],
		]

	candidates = frappe.get_all(
		"Customer",
		or_filters=or_filters,
		fields=["name", "customer_name", "mobile_no"],
		limit_page_length=min(limit * 3, 100),
		order_by="modified desc",
	)

	results: list[dict] = []
	for cust in candidates:
		if is_walk_in_customer(cust.name):
			continue
		ar = get_customer_ar_outstanding(cust.name, company)
		if ar <= 0.009:
			continue
		results.append(
			{
				"customer": cust.name,
				"customer_name": cust.customer_name,
				"mobile_no": cust.mobile_no,
				"ar_outstanding": ar,
			}
		)
		if len(results) >= limit:
			break

	return results


def _payment_reference_for_invoice(doctype: str, name: str) -> tuple[str, str]:
	"""Payment Entry allocates against Sales Invoice, not consolidated POS Invoice."""
	if doctype == "POS Invoice":
		consolidated = frappe.db.get_value("POS Invoice", name, "consolidated_invoice")
		if consolidated:
			return "Sales Invoice", consolidated
	return doctype, name


def _get_allocatable_ar_references(
	customer: str, company: str, posting_date: str | None = None
) -> list:
	"""Open POS/SI invoices we track as Owes — preferred over ERPNext's mixed AR list."""
	seen: set[tuple[str, str]] = set()
	refs: list = []
	for inv in get_customer_ar_invoices(customer, company):
		ref_doctype, ref_name = _payment_reference_for_invoice(inv["doctype"], inv["name"])
		key = (ref_doctype, ref_name)
		if key in seen:
			continue
		seen.add(key)
		outstanding = flt(inv["outstanding_amount"])
		if ref_doctype == "Sales Invoice" and ref_name != inv["name"]:
			outstanding = flt(
				frappe.db.get_value("Sales Invoice", ref_name, "outstanding_amount")
			)
		if outstanding <= 0.009:
			continue
		refs.append(
			frappe._dict(
				{
					"voucher_type": ref_doctype,
					"voucher_no": ref_name,
					"outstanding_amount": outstanding,
					"invoice_amount": flt(
						frappe.db.get_value(ref_doctype, ref_name, "grand_total")
					),
					"due_date": inv.get("posting_date"),
				}
			)
		)
	if refs:
		return refs

	from erpnext.accounts.doctype.payment_entry.payment_entry import get_outstanding_reference_documents
	from erpnext.accounts.party import get_party_account

	party_account = get_party_account("Customer", customer, company)
	args = {
		"posting_date": posting_date or today(),
		"company": company,
		"party_type": "Customer",
		"party": customer,
		"payment_type": "Receive",
		"party_account": party_account,
		"get_outstanding_invoices": True,
	}
	return [
		ref
		for ref in (get_outstanding_reference_documents(args) or [])
		if flt(ref.outstanding_amount) > 0.009
	]


def _apply_manual_ar_allocation(customer: str, company: str, amount: float) -> list[dict]:
	"""Reduce invoice outstanding after an unallocated Payment Entry (legacy POS debt)."""
	from kqs_retail.utils.customer_account import repair_legacy_on_account_outstanding

	repair_legacy_on_account_outstanding(customer, company)

	allocations: list[dict] = []
	remaining = flt(amount)
	for inv in get_customer_ar_invoices(customer, company):
		if remaining <= 0.009:
			break
		ref_doctype, ref_name = _payment_reference_for_invoice(inv["doctype"], inv["name"])
		outstanding = flt(frappe.db.get_value(ref_doctype, ref_name, "outstanding_amount"))
		if outstanding <= 0.009:
			continue
		allocated = min(remaining, outstanding)
		new_outstanding = outstanding - allocated
		grand = flt(frappe.db.get_value(ref_doctype, ref_name, "grand_total"))
		frappe.db.set_value(
			ref_doctype,
			ref_name,
			{
				"outstanding_amount": new_outstanding,
				"paid_amount": max(0.0, grand - new_outstanding),
			},
			update_modified=False,
		)
		if ref_doctype == "Sales Invoice":
			for pos_name in frappe.get_all(
				"POS Invoice",
				filters={"consolidated_invoice": ref_name},
				pluck="name",
			):
				frappe.db.set_value(
					"POS Invoice",
					pos_name,
					{"outstanding_amount": 0},
					update_modified=False,
				)
		allocations.append(
			{"doctype": ref_doctype, "name": ref_name, "allocated_amount": allocated}
		)
		remaining -= allocated

	if remaining > 0.009:
		frappe.throw(_("Could not allocate payment against open invoices."))
	return allocations


def _create_receive_payment_entry(
	customer: str,
	company: str,
	amount: float,
	mode_of_payment: str,
	reference_no: str | None = None,
) -> tuple[frappe.model.document.Document, list[dict]]:
	from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account
	from erpnext.accounts.party import get_party_account
	from kqs_retail.utils.customer_account import repair_legacy_on_account_outstanding

	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Payment amount must be positive."))

	party_account = get_party_account("Customer", customer, company)
	bank = get_bank_cash_account(mode_of_payment, company)

	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Receive"
	pe.party_type = "Customer"
	pe.party = customer
	pe.company = company
	pe.posting_date = today()
	pe.mode_of_payment = mode_of_payment
	pe.paid_from = party_account
	pe.paid_to = bank["account"]
	if reference_no:
		pe.reference_no = reference_no
	pe.remarks = _("KQS POS account payment collection")

	pe.setup_party_account_field()
	pe.set_missing_values()

	outstanding_refs = _get_allocatable_ar_references(customer, company, pe.posting_date)
	if not outstanding_refs:
		repair_legacy_on_account_outstanding(customer, company)
		outstanding_refs = _get_allocatable_ar_references(customer, company, pe.posting_date)
	if not outstanding_refs and get_customer_ar_outstanding(customer, company) <= 0.009:
		frappe.throw(_("This customer has no outstanding account balance."))
	if not outstanding_refs:
		frappe.throw(
			_(
				"Could not find open invoices for this balance. Ask a manager to check Accounts Receivable for {0}."
			).format(customer)
		)

	pe.paid_amount = amount
	pe.received_amount = amount
	pe.flags.ignore_permissions = True
	pe.insert(ignore_permissions=True)
	pe.flags.ignore_permissions = True
	frappe.flags.ignore_permissions = True
	try:
		pe.submit()
	finally:
		frappe.flags.ignore_permissions = False

	allocations = _apply_manual_ar_allocation(customer, company, amount)
	return pe, allocations


def record_customer_ar_payment(
	customer: str,
	company: str,
	payment_lines: list[dict],
	reference_no: str | None = None,
) -> dict:
	"""Post one Payment Entry (Receive) per payment line; FIFO across open invoices."""
	if not customer or not company:
		frappe.throw(_("Customer and company are required."))
	if is_walk_in_customer(customer):
		frappe.throw(_("Select a named customer to collect account payments."))

	from kqs_retail.utils.customer_account import repair_legacy_on_account_outstanding

	repair_legacy_on_account_outstanding(customer, company)

	ar_before = get_customer_ar_outstanding(customer, company)
	if ar_before <= 0.009:
		frappe.throw(_("This customer has no outstanding account balance."))

	total = sum(flt(row.get("amount")) for row in payment_lines)
	if total <= 0:
		frappe.throw(_("Enter at least one payment amount."))
	if total > ar_before + 0.01:
		frappe.throw(
			_("Payment ({0}) exceeds amount owed ({1}).").format(
				frappe.format(total, {"fieldtype": "Currency"}),
				frappe.format(ar_before, {"fieldtype": "Currency"}),
			)
		)

	for row in payment_lines:
		mode = row.get("mode_of_payment")
		if not is_real_money_mode(mode):
			frappe.throw(
				_("Payment mode {0} cannot be used to collect account balances.").format(mode or "")
			)
		if not frappe.db.exists("Mode of Payment", mode):
			frappe.throw(_("Mode of Payment {0} not found.").format(mode))

	payment_entries: list[str] = []
	all_allocations: list[dict] = []
	for row in payment_lines:
		pe, allocations = _create_receive_payment_entry(
			customer,
			company,
			flt(row.get("amount")),
			row.get("mode_of_payment"),
			reference_no=reference_no,
		)
		payment_entries.append(pe.name)
		all_allocations.extend(allocations)

	ar_after = get_customer_ar_outstanding(customer, company)
	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings

	receipt_settings = get_kqs_retail_settings()

	return {
		"customer": customer,
		"customer_name": customer_name,
		"payment_entries": payment_entries,
		"primary_payment_entry": payment_entries[0] if payment_entries else "",
		"paid_amount": total,
		"allocations": all_allocations,
		"ar_outstanding_before": ar_before,
		"ar_outstanding_after": ar_after,
		"print_format": receipt_settings.get("ar_payment_print_format") or "",
		"auto_print_receipt": cint(receipt_settings.get("auto_print_ar_payment_receipts", 1)),
	}


def record_customer_ar_payment_from_json(
	customer: str,
	company: str,
	payments: str,
	reference_no: str | None = None,
) -> dict:
	lines = _parse_payment_lines(payments)
	return record_customer_ar_payment(customer, company, lines, reference_no=reference_no)
