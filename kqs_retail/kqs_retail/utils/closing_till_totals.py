# Copyright (c) 2026, KQS
"""Till cashup extras — layby + account money that ERPNext closing omits."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

import frappe
from frappe.utils import flt, get_datetime, now_datetime

from kqs_retail.utils.ar_payment import is_real_money_mode
from kqs_retail.utils.store_credit import is_store_credit_mode

AR_COLLECTION_REMARK = "KQS POS account payment collection"
LAYBY_REFUND_REMARK_PREFIX = "Layby cancel refund"
BREAKDOWN_FIELD = "kqs_till_breakdown"


def _add(bucket: dict[str, float], mode: str | None, amount: float) -> None:
	mode_key = (mode or "").strip() or "Cash"
	if not is_real_money_mode(mode_key):
		return
	if is_store_credit_mode(mode_key):
		return
	bucket[mode_key] = flt(bucket.get(mode_key, 0) + amount)


def _session_bounds(opening, period_end=None) -> tuple[Any, Any]:
	start = get_datetime(opening.period_start_date)
	end = get_datetime(period_end or getattr(opening, "period_end_date", None) or now_datetime())
	if end < start:
		end = now_datetime()
	return start, end


def _sum_layby_payments(pos_profile: str, company: str, start, end) -> dict[str, float]:
	"""Submitted layby deposits/installments for this till profile in the open session."""
	if not pos_profile or not company:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT lp.mode_of_payment, lp.amount
		FROM `tabLayby Payment` lp
		INNER JOIN `tabLayby Agreement` la ON la.name = lp.layby_agreement
		WHERE lp.docstatus = 1
		  AND la.company = %(company)s
		  AND IFNULL(la.pos_profile, '') = %(pos_profile)s
		  AND lp.creation >= %(start)s
		  AND lp.creation <= %(end)s
		""",
		{"company": company, "pos_profile": pos_profile, "start": start, "end": end},
		as_dict=True,
	)
	out: dict[str, float] = {}
	for row in rows:
		_add(out, row.mode_of_payment, flt(row.amount))
	return out


def _sum_payment_entries(
	*,
	company: str,
	user: str,
	start,
	end,
	payment_type: str,
	remark_like: str,
) -> dict[str, float]:
	if not company:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT mode_of_payment, paid_amount
		FROM `tabPayment Entry`
		WHERE docstatus = 1
		  AND company = %(company)s
		  AND payment_type = %(payment_type)s
		  AND owner = %(user)s
		  AND creation >= %(start)s
		  AND creation <= %(end)s
		  AND IFNULL(remarks, '') LIKE %(remark_like)s
		""",
		{
			"company": company,
			"user": user,
			"start": start,
			"end": end,
			"payment_type": payment_type,
			"remark_like": remark_like,
		},
		as_dict=True,
	)
	out: dict[str, float] = {}
	for row in rows:
		_add(out, row.mode_of_payment, flt(row.paid_amount))
	return out


def _layby_completion_invoice_names(invoice_names: list[str]) -> set[str]:
	if not invoice_names:
		return set()
	placeholders = ", ".join(["%s"] * len(invoice_names))
	linked = frappe.db.sql(
		f"""
		SELECT sales_invoice
		FROM `tabLayby Agreement`
		WHERE sales_invoice IN ({placeholders})
		""",
		tuple(invoice_names),
		as_dict=True,
	)
	return {row.sales_invoice for row in linked if row.sales_invoice}


def _sum_sales_payments_from_closing(closing_doc) -> dict[str, float]:
	"""Real-money tender from invoices on this closing, excluding layby-completion SIs."""
	pos_names = [row.pos_invoice for row in (closing_doc.get("pos_invoices") or []) if row.pos_invoice]
	si_names = [
		row.sales_invoice for row in (closing_doc.get("sales_invoices") or []) if row.sales_invoice
	]
	skip = _layby_completion_invoice_names(si_names + pos_names)
	out: dict[str, float] = {}

	def _consume(parenttype: str, names: list[str]) -> None:
		for name in names:
			if name in skip:
				continue
			pays = frappe.get_all(
				"Sales Invoice Payment",
				filters={"parent": name, "parenttype": parenttype},
				fields=["mode_of_payment", "amount"],
			)
			for pay in pays:
				_add(out, pay.mode_of_payment, flt(pay.amount))

	_consume("POS Invoice", pos_names)
	_consume("Sales Invoice", si_names)
	return out


def build_till_breakdown(opening, closing_doc) -> dict:
	"""Return sales / layby / account / refunds / expected by mode for this closing."""
	start, end = _session_bounds(opening, closing_doc.period_end_date)
	company = closing_doc.company or opening.company
	pos_profile = closing_doc.pos_profile or opening.pos_profile
	user = closing_doc.user or opening.user

	opening_by_mode: dict[str, float] = {}
	for row in closing_doc.get("payment_reconciliation") or []:
		mode = row.mode_of_payment
		if mode:
			opening_by_mode[mode] = flt(row.opening_amount)

	sales = _sum_sales_payments_from_closing(closing_doc)
	layby = _sum_layby_payments(pos_profile, company, start, end)
	account = _sum_payment_entries(
		company=company,
		user=user,
		start=start,
		end=end,
		payment_type="Receive",
		remark_like=f"{AR_COLLECTION_REMARK}%",
	)
	refunds = _sum_payment_entries(
		company=company,
		user=user,
		start=start,
		end=end,
		payment_type="Pay",
		remark_like=f"{LAYBY_REFUND_REMARK_PREFIX}%",
	)

	modes = sorted(
		{
			*opening_by_mode.keys(),
			*sales.keys(),
			*layby.keys(),
			*account.keys(),
			*refunds.keys(),
		}
	)

	rows = []
	totals = defaultdict(float)
	for mode in modes:
		open_amt = flt(opening_by_mode.get(mode))
		sale = flt(sales.get(mode))
		lay = flt(layby.get(mode))
		acc = flt(account.get(mode))
		ref = flt(refunds.get(mode))
		expected = flt(open_amt + sale + lay + acc - ref)
		rows.append(
			{
				"mode_of_payment": mode,
				"opening": open_amt,
				"sales": sale,
				"layby": lay,
				"account": acc,
				"refunds": ref,
				"expected": expected,
			}
		)
		totals["opening"] += open_amt
		totals["sales"] += sale
		totals["layby"] += lay
		totals["account"] += acc
		totals["refunds"] += ref
		totals["expected"] += expected

	return {
		"period_start": str(start),
		"period_end": str(end),
		"pos_profile": pos_profile or "",
		"user": user or "",
		"rows": rows,
		"totals": {k: flt(v) for k, v in totals.items()},
		"layby_total": flt(totals["layby"]),
		"account_total": flt(totals["account"]),
		"refunds_total": flt(totals["refunds"]),
		"sales_total": flt(totals["sales"]),
	}


def apply_till_extras_to_closing(doc, *, persist_breakdown: bool = True) -> dict:
	"""
	Rewrite payment_reconciliation.expected_amount so counted cash matches the drawer:
	opening + POS sales + layby + account collections − till refunds.
	"""
	if not doc.pos_opening_entry:
		return {}
	opening = frappe.get_doc("POS Opening Entry", doc.pos_opening_entry)
	breakdown = build_till_breakdown(opening, doc)
	by_mode = {row["mode_of_payment"]: row for row in breakdown["rows"]}

	existing = {row.mode_of_payment for row in doc.payment_reconciliation if row.mode_of_payment}
	for mode, row in by_mode.items():
		if mode in existing:
			continue
		if flt(row["layby"]) or flt(row["account"]) or flt(row["refunds"]) or flt(row["sales"]):
			doc.append(
				"payment_reconciliation",
				{
					"mode_of_payment": mode,
					"opening_amount": 0,
					"expected_amount": row["expected"],
					"closing_amount": row["expected"],
					"difference": 0,
				},
			)
			existing.add(mode)

	for pay in doc.payment_reconciliation:
		mode = pay.mode_of_payment
		if not mode or mode not in by_mode:
			continue
		row = by_mode[mode]
		pay.expected_amount = flt(row["expected"])
		if pay.closing_amount in (None, ""):
			pay.closing_amount = pay.expected_amount
		pay.difference = flt(flt(pay.closing_amount) - flt(pay.expected_amount))

	_store_breakdown(doc, breakdown, persist=persist_breakdown)
	_apply_summary_fields(doc, breakdown)
	return breakdown


def _apply_summary_fields(doc, breakdown: dict) -> None:
	"""Currency fields safe for print formats (no JSON parse in Jinja sandbox)."""
	totals = breakdown.get("totals") or {}
	sales = flt(totals.get("sales"))
	layby = flt(totals.get("layby"))
	account = flt(totals.get("account"))
	refunds = flt(totals.get("refunds"))
	mapping = {
		"kqs_sales_tender": sales,
		"kqs_layby_received": layby,
		"kqs_account_collected": account,
		"kqs_till_refunds": refunds,
		"kqs_money_in_till": flt(sales + layby + account - refunds),
	}
	meta = frappe.get_meta("POS Closing Entry")
	for fieldname, value in mapping.items():
		if meta.has_field(fieldname):
			doc.set(fieldname, value)


def _store_breakdown(doc, breakdown: dict, *, persist: bool = True) -> None:
	payload = json.dumps(breakdown, default=str)
	if hasattr(doc, BREAKDOWN_FIELD) or frappe.get_meta("POS Closing Entry").has_field(BREAKDOWN_FIELD):
		doc.set(BREAKDOWN_FIELD, payload)
	if (
		persist
		and doc.name
		and not doc.is_new()
		and frappe.db.has_column("POS Closing Entry", BREAKDOWN_FIELD)
	):
		frappe.db.set_value(
			"POS Closing Entry",
			doc.name,
			BREAKDOWN_FIELD,
			payload,
			update_modified=False,
		)


def get_breakdown_for_doc(doc) -> dict:
	"""Load stored breakdown or rebuild (print / UI)."""
	raw = None
	if hasattr(doc, BREAKDOWN_FIELD):
		raw = doc.get(BREAKDOWN_FIELD)
	if not raw and doc.name and frappe.db.has_column("POS Closing Entry", BREAKDOWN_FIELD):
		raw = frappe.db.get_value("POS Closing Entry", doc.name, BREAKDOWN_FIELD)
	if raw:
		try:
			data = json.loads(raw)
			if isinstance(data, dict) and data.get("rows") is not None:
				return data
		except (TypeError, ValueError, json.JSONDecodeError):
			pass
	if not doc.pos_opening_entry:
		return {"rows": [], "totals": {}}
	opening = frappe.get_doc("POS Opening Entry", doc.pos_opening_entry)
	return build_till_breakdown(opening, doc)


@frappe.whitelist()
def get_closing_till_breakdown(name: str) -> dict:
	if not name:
		frappe.throw(frappe._("POS Closing Entry is required."))
	doc = frappe.get_doc("POS Closing Entry", name)
	if doc.user != frappe.session.user:
		from kqs_retail.utils.manager_access import is_stock_manager

		if not is_stock_manager():
			frappe.throw(frappe._("Not permitted"), frappe.PermissionError)
	return get_breakdown_for_doc(doc)
