# Copyright (c) 2026, KQS
"""Emergency POS session recovery for stuck Open openings (Hostinger / production).

Usage (SSH on the VPS, replace SITE and optionally OPENING):

  bench --site SITE execute kqs_retail.setup.recover_pos_opening.list_open
  bench --site SITE execute kqs_retail.setup.recover_pos_opening.close_opening --kwargs "{'opening': 'POS-OPE-25-00001'}"
  bench --site SITE execute kqs_retail.setup.recover_pos_opening.close_opening --kwargs "{'opening': 'POS-OPE-25-00001', 'submit': 1}"

Do not cancel openings that have sales — close them.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt

from kqs_retail.api.pos_closing import (
	_apply_closing_amounts,
	_authorize_closing_entry,
	_reload_closing_invoices,
	_serialize_closing_payload,
	prepare_closing_entry,
)
from kqs_retail.utils.closing_validation import collect_closing_blockers, format_closing_blockers
from kqs_retail.utils.manager_access import assert_stock_manager


def list_open() -> None:
	"""Print all Open POS Opening Entries."""
	rows = frappe.get_all(
		"POS Opening Entry",
		filters={"status": "Open", "docstatus": 1},
		fields=["name", "user", "period_start_date", "pos_profile", "company"],
		order_by="period_start_date desc",
		limit_page_length=50,
	)
	if not rows:
		print("No Open POS Opening Entries.")
		return
	print(f"Open sessions ({len(rows)}):")
	for row in rows:
		print(
			f"  {row.name} | user={row.user} | profile={row.pos_profile} | started={row.period_start_date}"
		)


def close_opening(opening: str, submit: int = 0) -> None:
	"""Create/refresh a draft POS Closing Entry for an Open opening; optionally submit.

	Sets closing amounts = expected amounts so the till can close without a cash count.
	Use only when a cashier left mid-shift or the UI cannot open the closing form.
	"""
	assert_stock_manager()
	opening = (opening or "").strip()
	if not opening:
		frappe.throw(_("Pass opening='POS-OPE-…'"))

	payload = prepare_closing_entry(opening)
	name = payload["name"]
	doc = frappe.get_doc("POS Closing Entry", name)
	_authorize_closing_entry(doc)

	# Match expected so difference is zero (admin recovery, not a cash-up count).
	recon = [
		{
			"mode_of_payment": row.mode_of_payment,
			"closing_amount": flt(row.expected_amount),
		}
		for row in doc.payment_reconciliation
		if row.mode_of_payment
	]
	_apply_closing_amounts(doc, recon)
	_reload_closing_invoices(doc, preserve_closing=True)
	doc.save()

	blockers = collect_closing_blockers(doc)
	summary = _serialize_closing_payload(doc, blockers=blockers)
	print(json.dumps(summary, indent=2, default=str))

	if blockers:
		print("BLOCKED — fix these invoices first (do not cancel the opening):")
		print(format_closing_blockers(blockers).replace("<br>", "\n"))
		print(f"Draft closing left as: {name}")
		return

	if not cint_submit(submit):
		print(f"Draft closing ready: {name}")
		print("Re-run with submit=1 to submit, or open it in Desk and click Submit Closing.")
		return

	doc.submit()
	print(f"Submitted POS Closing Entry {doc.name}. Opening should now be Closed.")


def cint_submit(value) -> bool:
	from frappe.utils import cint

	return bool(cint(value))
