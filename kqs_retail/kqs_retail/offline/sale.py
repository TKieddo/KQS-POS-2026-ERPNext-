# Copyright (c) 2026, KQS
"""Create Sales Invoice from an offline sale outbox payload."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, nowdate


def create_sales_invoice_from_offline(payload: dict) -> dict:
	"""Submit a POS Sales Invoice from cached cart + payment rows (record-only MOPs)."""
	pos_profile = payload.get("pos_profile")
	customer = payload.get("customer")
	company = payload.get("company")
	warehouse = payload.get("warehouse")
	items = payload.get("items") or []
	payments = payload.get("payments") or []

	if not pos_profile:
		frappe.throw(_("POS Profile is required."))
	if not customer:
		frappe.throw(_("Customer is required."))
	if not items:
		frappe.throw(_("Sale items are required."))

	profile = frappe.get_cached_doc("POS Profile", pos_profile)
	company = company or profile.company
	warehouse = warehouse or profile.warehouse

	si = frappe.new_doc("Sales Invoice")
	si.is_pos = 1
	si.pos_profile = pos_profile
	si.update_stock = 1
	si.customer = customer
	si.company = company
	si.set_warehouse = warehouse
	si.posting_date = payload.get("posting_date") or nowdate()
	si.due_date = si.posting_date
	si.currency = (
		getattr(profile, "currency", None)
		or frappe.get_cached_value("Company", company, "default_currency")
	)
	si.selling_price_list = profile.selling_price_list
	si.ignore_pricing_rule = 1

	# Accounting defaults from POS Profile / company
	if getattr(profile, "cost_center", None):
		si.cost_center = profile.cost_center
	if getattr(profile, "write_off_account", None):
		si.write_off_account = profile.write_off_account
	if getattr(profile, "write_off_cost_center", None):
		si.write_off_cost_center = profile.write_off_cost_center
	if getattr(profile, "account_for_change_amount", None):
		si.account_for_change_amount = profile.account_for_change_amount
	if getattr(profile, "income_account", None):
		si.income_account = profile.income_account
	if getattr(profile, "expense_account", None):
		si.expense_account = profile.expense_account
	if getattr(profile, "taxes_and_charges", None):
		si.taxes_and_charges = profile.taxes_and_charges

	for line in items:
		qty = flt(line.get("qty"))
		if qty <= 0:
			continue
		row = {
			"item_code": line["item_code"],
			"qty": qty,
			"rate": flt(line.get("rate")),
			"warehouse": warehouse,
		}
		if line.get("uom"):
			row["uom"] = line["uom"]
		if getattr(profile, "income_account", None):
			row["income_account"] = profile.income_account
		if getattr(profile, "cost_center", None):
			row["cost_center"] = profile.cost_center
		si.append("items", row)

	if not si.items:
		frappe.throw(_("Sale has no valid item lines."))

	paid_total = 0.0
	for row in payments:
		amount = flt(row.get("amount"))
		if amount <= 0:
			continue
		paid_total += amount
		si.append(
			"payments",
			{
				"mode_of_payment": row.get("mode_of_payment") or "Cash",
				"amount": amount,
				"reference_no": row.get("reference_no") or row.get("payment_reference") or None,
			},
		)

	if not si.payments:
		frappe.throw(_("At least one payment (Cash / Card / M-Pesa) is required."))

	# Apply taxes template before insert when configured on POS Profile
	if si.taxes_and_charges:
		si.set_taxes()

	si.flags.ignore_permissions = True
	si.set_missing_values(for_validate=True)
	si.calculate_taxes_and_totals()

	# Absorb tiny rounding gaps into write-off when POS profile allows it
	grand = flt(si.grand_total)
	if paid_total and abs(paid_total - grand) <= 0.05 and abs(paid_total - grand) > 0.0001:
		si.write_off_amount = flt(grand - paid_total)
		si.calculate_taxes_and_totals()

	si.insert(ignore_permissions=True)
	si.submit()
	return {
		"doctype": "Sales Invoice",
		"name": si.name,
		"grand_total": si.grand_total,
		"outstanding_amount": si.outstanding_amount,
		"offline_client_uuid": payload.get("client_uuid"),
	}
