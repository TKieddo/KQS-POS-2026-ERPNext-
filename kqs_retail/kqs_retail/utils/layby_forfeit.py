# Copyright (c) 2026, KQS
"""Manager forfeit of overdue active layby — no refund, stock released."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, today

from kqs_retail.kqs_layby.stock_reservation import release_reservation
from kqs_retail.utils.layby_ops_common import get_layby_agreement, require_manager

CANCEL_REASON_FORFEITED = "forfeited"


def forfeit_layby(agreement_name: str, note: str) -> dict:
	require_manager()
	note = (note or "").strip()
	if not note:
		frappe.throw(_("A note is required when forfeiting a layby."))

	doc = get_layby_agreement(agreement_name)
	release_reservation(doc.stock_reservation)

	paid = flt(doc.paid_amount)
	existing_notes = (doc.notes or "").strip()
	audit = _("Forfeited on {0}: {1}").format(today(), note)
	combined_notes = f"{existing_notes}\n{audit}".strip() if existing_notes else audit

	frappe.db.set_value(
		"Layby Agreement",
		agreement_name,
		{
			"status": "Forfeited",
			"cancel_reason": CANCEL_REASON_FORFEITED,
			"refund_amount": 0,
			"forfeit_amount": paid,
			"closed_on": today(),
			"notes": combined_notes,
		},
		update_modified=True,
	)

	return {
		"agreement": agreement_name,
		"status": "Forfeited",
		"forfeit_amount": paid,
		"refund_amount": 0,
	}
