# Copyright (c) 2026, KQS
"""Pre-close checks — name POS invoices that block session close before submit."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from kqs_retail.utils.customer_account import get_on_account_unpaid, infer_on_account_unpaid

BLOCKER_DOCTYPES = ("POS Invoice", "Sales Invoice")


def collect_closing_blockers(closing_entry) -> list[dict]:
	"""Return structured blockers for invoices on a draft POS Closing Entry."""
	blockers: list[dict] = []
	seen: set[str] = set()

	for row in closing_entry.get("pos_invoices") or []:
		if not row.pos_invoice:
			continue
		_add_pos_blockers(blockers, seen, row.pos_invoice, row)

	for row in closing_entry.get("sales_invoices") or []:
		if not row.sales_invoice:
			continue
		_add_sales_blockers(blockers, seen, row.sales_invoice, row)

	return blockers


def format_closing_blockers(blockers: list[dict]) -> str:
	if not blockers:
		return ""
	lines = []
	for item in blockers:
		invoice = frappe.bold(item["invoice"])
		lines.append(f"• {invoice}: {item['message']}")
	return "<br>".join(lines)


def throw_if_closing_blocked(closing_entry) -> None:
	blockers = collect_closing_blockers(closing_entry)
	if not blockers:
		return
	frappe.throw(
		_("Cannot close POS until a manager fixes these invoices:") + "<br><br>" + format_closing_blockers(blockers),
		title=_("POS Closing Blocked"),
	)


def _add_blocker(
	blockers: list[dict],
	seen: set[str],
	*,
	invoice: str,
	doctype: str,
	customer: str | None,
	code: str,
	message: str,
) -> None:
	key = f"{doctype}::{invoice}::{code}"
	if key in seen:
		return
	seen.add(key)
	blockers.append(
		{
			"invoice": invoice,
			"doctype": doctype,
			"customer": customer or "",
			"code": code,
			"message": message,
		}
	)


def _payment_row_total(doctype: str, name: str) -> float:
	rows = frappe.get_all(
		"Sales Invoice Payment",
		filters={"parenttype": doctype, "parent": name},
		fields=["amount"],
	)
	return sum(flt(row.amount) for row in rows)


def _load_pos_invoice(name: str) -> dict | None:
	if not frappe.db.exists("POS Invoice", name):
		return None
	fields = [
		"name",
		"customer",
		"grand_total",
		"paid_amount",
		"outstanding_amount",
		"is_return",
		"return_against",
		"status",
		"consolidated_invoice",
		"docstatus",
		"kqs_on_account_unpaid",
	]
	return frappe.db.get_value("POS Invoice", name, fields, as_dict=True)


def _load_sales_invoice(name: str) -> dict | None:
	if not frappe.db.exists("Sales Invoice", name):
		return None
	fields = [
		"name",
		"customer",
		"grand_total",
		"paid_amount",
		"outstanding_amount",
		"is_return",
		"return_against",
		"status",
		"pos_closing_entry",
		"docstatus",
		"is_created_using_pos",
		"kqs_on_account_unpaid",
	]
	return frappe.db.get_value("Sales Invoice", name, fields, as_dict=True)


def _on_account_amount(doctype: str, inv: dict) -> float:
	stored = flt(inv.get("kqs_on_account_unpaid"))
	if stored > 0:
		return stored
	return get_on_account_unpaid(doctype, inv.name) or infer_on_account_unpaid(doctype, inv.name)


def _has_full_return_pending_settlement(doctype: str, original_name: str, on_account: float) -> bool:
	"""Original still owes on-account but a submitted return should have cleared it."""
	returns = frappe.get_all(
		doctype,
		filters={"docstatus": 1, "is_return": 1, "return_against": original_name},
		fields=["grand_total"],
	)
	if not returns:
		return False
	returned = sum(abs(flt(row.grand_total)) for row in returns)
	orig_grand = abs(flt(frappe.db.get_value(doctype, original_name, "grand_total")))
	return returned + 0.02 >= min(on_account, orig_grand)


def _add_pos_blockers(blockers: list[dict], seen: set[str], name: str, row) -> None:
	inv = _load_pos_invoice(name)
	if not inv:
		_add_blocker(
			blockers,
			seen,
			invoice=name,
			doctype="POS Invoice",
			customer=getattr(row, "customer", None),
			code="missing",
			message=_("Invoice not found in the system."),
		)
		return

	if inv.docstatus == 2:
		return

	if inv.docstatus != 1:
		_add_blocker(
			blockers,
			seen,
			invoice=name,
			doctype="POS Invoice",
			customer=inv.customer,
			code="not_submitted",
			message=_("Invoice is not submitted."),
		)
		return

	if inv.consolidated_invoice:
		_add_blocker(
			blockers,
			seen,
			invoice=name,
			doctype="POS Invoice",
			customer=inv.customer,
			code="already_consolidated",
			message=_("Already consolidated into {0}.").format(inv.consolidated_invoice),
		)
		return

	_check_payment_integrity(blockers, seen, inv, "POS Invoice")
	_check_return_pair(blockers, seen, inv, "POS Invoice")


def _add_sales_blockers(blockers: list[dict], seen: set[str], name: str, row) -> None:
	inv = _load_sales_invoice(name)
	if not inv:
		_add_blocker(
			blockers,
			seen,
			invoice=name,
			doctype="Sales Invoice",
			customer=getattr(row, "customer", None),
			code="missing",
			message=_("Invoice not found in the system."),
		)
		return

	if inv.docstatus == 2:
		return

	if inv.docstatus != 1:
		_add_blocker(
			blockers,
			seen,
			invoice=name,
			doctype="Sales Invoice",
			customer=inv.customer,
			code="not_submitted",
			message=_("Invoice is not submitted."),
		)
		return

	if inv.pos_closing_entry:
		_add_blocker(
			blockers,
			seen,
			invoice=name,
			doctype="Sales Invoice",
			customer=inv.customer,
			code="already_closed",
			message=_("Already linked to closing entry {0}.").format(inv.pos_closing_entry),
		)
		return

	_check_payment_integrity(blockers, seen, inv, "Sales Invoice")
	_check_return_pair(blockers, seen, inv, "Sales Invoice")


def _check_payment_integrity(blockers: list[dict], seen: set[str], inv: dict, doctype: str) -> None:
	if inv.is_return:
		return

	grand = abs(flt(inv.grand_total))
	if grand <= 0.009:
		return

	outstanding = flt(inv.outstanding_amount)
	payment_total = _payment_row_total(doctype, inv.name)
	on_account = _on_account_amount(doctype, inv)

	# Valid on-account sale — open AR is expected until customer pays or item is returned.
	if on_account > 0.009 and outstanding <= on_account + 0.02:
		if _has_full_return_pending_settlement(doctype, inv.name, on_account):
			_add_blocker(
				blockers,
				seen,
				invoice=inv.name,
				doctype=doctype,
				customer=inv.customer,
				code="on_account_return_not_settled",
				message=_(
					"On Account sale ({0} owed) was returned but debt was not cleared. "
					"Run bench migrate or contact support to repair."
				).format(frappe.format(on_account, {"fieldtype": "Currency"})),
			)
		return

	if outstanding <= 0.009:
		return

	# Broken: outstanding with no payment rows and not a tracked on-account sale.
	if payment_total <= 0.009:
		_add_blocker(
			blockers,
			seen,
			invoice=inv.name,
			doctype=doctype,
			customer=inv.customer,
			code="missing_payments",
			message=_(
				"Sale to {0} for {1} has {2} outstanding but no payment was recorded. "
				"A manager must correct this invoice before the till can close."
			).format(
				inv.customer or _("(no customer)"),
				frappe.format(grand, {"fieldtype": "Currency"}),
				frappe.format(outstanding, {"fieldtype": "Currency"}),
			),
		)


def _check_return_pair(blockers: list[dict], seen: set[str], inv: dict, doctype: str) -> None:
	if not inv.is_return or not inv.return_against:
		return

	original = _load_pos_invoice(inv.return_against) if doctype == "POS Invoice" else _load_sales_invoice(
		inv.return_against
	)
	if not original:
		_add_blocker(
			blockers,
			seen,
			invoice=inv.name,
			doctype=doctype,
			customer=inv.customer,
			code="return_missing_original",
			message=_("Return is linked to missing original invoice {0}.").format(inv.return_against),
		)
		return

	if doctype == "POS Invoice":
		if original.get("consolidated_invoice"):
			return
	else:
		if original.get("pos_closing_entry"):
			return

	orig_outstanding = flt(original.outstanding_amount)
	if orig_outstanding <= 0.009:
		return

	on_account = _on_account_amount(
		"POS Invoice" if doctype == "POS Invoice" else "Sales Invoice",
		original,
	)
	if on_account > 0.009:
		_add_blocker(
			blockers,
			seen,
			invoice=inv.name,
			doctype=doctype,
			customer=inv.customer,
			code="return_on_account_not_settled",
			message=_(
				"Return {0} — original On Account sale {1} still shows {2} owed. "
				"Debt should clear automatically when the return is submitted."
			).format(
				inv.name,
				original.name,
				frappe.format(orig_outstanding, {"fieldtype": "Currency"}),
			),
		)
