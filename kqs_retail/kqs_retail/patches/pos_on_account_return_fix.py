# Copyright (c) 2026, KQS
"""Repair on-account invoices and ensure tracking fields exist."""

from __future__ import annotations

import frappe

from kqs_retail.setup.invoice_fields import ensure_invoice_custom_fields
from kqs_retail.utils.customer_account import (
	repair_on_account_return_pairs,
	repair_paid_invoices_missing_payment_rows,
)


def execute() -> None:
	ensure_invoice_custom_fields()
	fixed = repair_on_account_return_pairs("POS Invoice")
	fixed += repair_on_account_return_pairs("Sales Invoice")
	synced = repair_paid_invoices_missing_payment_rows("POS Invoice")
	synced += repair_paid_invoices_missing_payment_rows("Sales Invoice")
	if fixed or synced:
		frappe.db.commit()
	if fixed:
		print(f"Repaired on-account originals after return: {', '.join(fixed)}")
	if synced:
		print(f"Synced payment rows for merge: {', '.join(synced)}")
	if not fixed and not synced:
		print("No on-account or merge payment repairs needed.")
