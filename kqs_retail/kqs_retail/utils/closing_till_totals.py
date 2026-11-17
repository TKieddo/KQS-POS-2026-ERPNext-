# Copyright (c) 2026, KQS
"""Till cashup extras — layby + account money; sales net of change/credit/points."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

import frappe
from frappe.utils import flt, get_datetime, now_datetime

from kqs_retail.utils.ar_payment import is_real_money_mode
from kqs_retail.utils.customer_account import is_account_sale_mode
from kqs_retail.utils.store_credit import is_store_credit_mode

AR_COLLECTION_REMARK = "KQS POS account payment collection"
LAYBY_REFUND_REMARK_PREFIX = "Layby cancel refund"
BREAKDOWN_FIELD = "kqs_till_breakdown"
CASH_MODE_CANDIDATES = ("Cash",)


def _is_cash_mode(mode: str | None) -> bool:
	if not mode:
		return False
	return mode.strip() in CASH_MODE_CANDIDATES or mode.strip().lower() == "cash"


def _add(bucket: dict[str, float], mode: str | None, amount: float) -> None:
	mode_key = (mode or "").strip() or "Cash"
	if abs(flt(amount)) < 0.0001:
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
		mode = row.mode_of_payment
		if not is_real_money_mode(mode):
			continue
		_add(out, mode, flt(row.amount))
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
		mode = row.mode_of_payment
		if not is_real_money_mode(mode):
			continue
		_add(out, mode, flt(row.paid_amount))
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


def _allocate_invoice_money(parenttype: str, name: str) -> dict:
	"""
	Split one invoice into:
	- sales_by_mode: real money that stayed (tender minus change)
	- credit: sold on account / On Account
	- points: store credit / loyalty
	"""
	fields = ["grand_total", "is_return", "change_amount", "paid_amount"]
	inv = frappe.db.get_value(parenttype, name, fields, as_dict=True)
	if not inv:
		return {"sales_by_mode": {}, "credit": 0.0, "points": 0.0, "grand": 0.0}

	pays = frappe.get_all(
		"Sales Invoice Payment",
		filters={"parent": name, "parenttype": parenttype},
		fields=["mode_of_payment", "amount"],
	)

	credit = 0.0
	points = 0.0
	real_rows: list[tuple[str, float]] = []
	for pay in pays:
		mode = (pay.mode_of_payment or "").strip() or "Cash"
		amt = flt(pay.amount)
		if is_account_sale_mode(mode):
			credit += amt
		elif is_store_credit_mode(mode):
			points += amt
		elif is_real_money_mode(mode):
			real_rows.append((mode, amt))

	grand = flt(inv.grand_total)
	change = flt(inv.change_amount)

	# Returns: money leaves the till — keep signed real-money amounts (usually negative).
	if cint_is_return(inv.is_return):
		sales_by_mode: dict[str, float] = {}
		for mode, amt in real_rows:
			_add(sales_by_mode, mode, amt)
		return {
			"sales_by_mode": sales_by_mode,
			"credit": credit,
			"points": points,
			"grand": grand,
		}

	# Normal sale: tender often includes change. Only count money that stayed.
	tendered = sum(amt for _, amt in real_rows)
	due_real = flt(grand - credit - points)
	# Guard: due_real cannot exceed tendered; cannot be negative for a normal sale.
	if due_real < 0:
		due_real = 0.0
	if tendered <= 0.0001:
		return {"sales_by_mode": {}, "credit": credit, "points": points, "grand": grand}

	# Prefer ERPNext change_amount against Cash; else scale all real modes.
	sales_by_mode = {}
	if change > 0.0001 and abs(tendered - change - due_real) <= 0.05:
		remaining_change = change
		for mode, amt in real_rows:
			kept = amt
			if remaining_change > 0 and _is_cash_mode(mode):
				deduct = min(kept, remaining_change)
				kept = flt(kept - deduct)
				remaining_change = flt(remaining_change - deduct)
			_add(sales_by_mode, mode, kept)
	elif abs(tendered - due_real) <= 0.05:
		for mode, amt in real_rows:
			_add(sales_by_mode, mode, amt)
	else:
		# Scale tendered modes down to the amount actually owed in real money.
		scale = due_real / tendered if tendered else 0
		for mode, amt in real_rows:
			_add(sales_by_mode, mode, flt(amt * scale))

	return {
		"sales_by_mode": sales_by_mode,
		"credit": credit,
		"points": points,
		"grand": grand,
	}


def cint_is_return(value) -> bool:
	try:
		return int(value or 0) == 1
	except (TypeError, ValueError):
		return bool(value)


def _sum_sales_from_closing(closing_doc) -> dict:
	"""Real-money sales (net of change), plus credit/points totals."""
	pos_names = [row.pos_invoice for row in (closing_doc.get("pos_invoices") or []) if row.pos_invoice]
	si_names = [
		row.sales_invoice for row in (closing_doc.get("sales_invoices") or []) if row.sales_invoice
	]
	skip = _layby_completion_invoice_names(si_names + pos_names)

	sales_by_mode: dict[str, float] = {}
	credit_total = 0.0
	points_total = 0.0
	goods_total = 0.0

	def _consume(parenttype: str, names: list[str]) -> None:
		nonlocal credit_total, points_total, goods_total
		for name in names:
			if name in skip:
				continue
			part = _allocate_invoice_money(parenttype, name)
			for mode, amt in (part.get("sales_by_mode") or {}).items():
				_add(sales_by_mode, mode, amt)
			credit_total = flt(credit_total + part.get("credit", 0))
			points_total = flt(points_total + part.get("points", 0))
			goods_total = flt(goods_total + part.get("grand", 0))

	_consume("POS Invoice", pos_names)
	_consume("Sales Invoice", si_names)
	return {
		"sales_by_mode": sales_by_mode,
		"credit_total": credit_total,
		"points_total": points_total,
		"goods_total": goods_total,
	}


def build_till_breakdown(opening, closing_doc) -> dict:
	"""Plain till picture: sales kept, credit owed, layby, account, refunds — by mode."""
	start, end = _session_bounds(opening, closing_doc.period_end_date)
	company = closing_doc.company or opening.company
	pos_profile = closing_doc.pos_profile or opening.pos_profile
	user = closing_doc.user or opening.user

	opening_by_mode: dict[str, float] = {}
	for row in closing_doc.get("payment_reconciliation") or []:
		mode = row.mode_of_payment
		if mode:
			opening_by_mode[mode] = flt(row.opening_amount)

	sales_info = _sum_sales_from_closing(closing_doc)
	sales = sales_info["sales_by_mode"]
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
	cash_in_till = 0.0
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
				"is_cash": _is_cash_mode(mode),
			}
		)
		totals["opening"] += open_amt
		totals["sales"] += sale
		totals["layby"] += lay
		totals["account"] += acc
		totals["refunds"] += ref
		totals["expected"] += expected
		if _is_cash_mode(mode):
			cash_in_till += expected

	totals["credit"] = flt(sales_info["credit_total"])
	totals["points"] = flt(sales_info["points_total"])
	totals["goods"] = flt(sales_info["goods_total"])
	totals["cash_in_till"] = flt(cash_in_till)
	# All real money taken (cash + bank + mpesa + …), not only drawer cash.
	totals["money_received"] = flt(totals["sales"] + totals["layby"] + totals["account"] - totals["refunds"])

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
		"credit_total": flt(totals["credit"]),
		"points_total": flt(totals["points"]),
		"cash_in_till": flt(totals["cash_in_till"]),
		"money_received": flt(totals["money_received"]),
	}


def apply_till_extras_to_closing(doc, *, persist_breakdown: bool = True) -> dict:
	"""
	Rewrite payment_reconciliation.expected_amount:
	opening + sales(kept) + layby + account − refunds
	(excludes credit sales, store credit/points, and cash change).
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
		# Never put On Account / Store Credit into expected drawer money.
		if is_account_sale_mode(mode) or is_store_credit_mode(mode):
			pay.expected_amount = flt(pay.opening_amount)
			if pay.closing_amount in (None, ""):
				pay.closing_amount = pay.expected_amount
			pay.difference = flt(flt(pay.closing_amount) - flt(pay.expected_amount))
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
	mapping = {
		"kqs_sales_tender": flt(totals.get("sales")),
		"kqs_layby_received": flt(totals.get("layby")),
		"kqs_account_collected": flt(totals.get("account")),
		"kqs_till_refunds": flt(totals.get("refunds")),
		"kqs_sold_on_credit": flt(totals.get("credit")),
		"kqs_points_redeemed": flt(totals.get("points")),
		"kqs_cash_in_till": flt(totals.get("cash_in_till")),
		# Total of all real money received (cash+bank+mpesa…); label clarified on receipt.
		"kqs_money_in_till": flt(totals.get("money_received")),
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
	"""Always rebuild so change/credit logic stays current for reprints."""
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
