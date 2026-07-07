# Copyright (c) 2026, KQS
"""
Spike: Payment Entry (Receive) against on-account POS invoices.

Run:
  bench --site frontend execute kqs_retail.setup.spike_ar_payment.run_spike
"""

from __future__ import annotations

import frappe
from frappe.utils import flt

from kqs_retail.setup.spike_account_sale import run_spike as seed_account_sale
from kqs_retail.utils.ar_payment import get_customer_ar_invoices, record_customer_ar_payment
from kqs_retail.utils.customer_account import get_customer_ar_outstanding


def run_spike() -> None:
	frappe.set_user("Administrator")

	# Reuse account-sale spike to create customer + on-account invoice (600 outstanding).
	seed_account_sale()

	company = frappe.db.get_value("Company", {}, "name")
	customer = frappe.db.get_value("Customer", {"mobile_no": "26659999002"}, "name")
	if not customer or not company:
		print("SPIKE ar_payment: missing customer or company")
		return

	ar_start = get_customer_ar_outstanding(customer, company)
	invoices_before = get_customer_ar_invoices(customer, company)
	print(f"SPIKE ar_payment customer={customer} ar_start={ar_start} invoices={len(invoices_before)}")
	if ar_start <= 0.01:
		print("SPIKE ar_payment FAIL: no AR outstanding after account-sale spike")
		return

	# Partial payment (200 Cash).
	partial = record_customer_ar_payment(
		customer,
		company,
		[{"mode_of_payment": "Cash", "amount": 200}],
	)
	ar_partial = get_customer_ar_outstanding(customer, company)
	print(f"SPIKE partial PE={partial['payment_entries']} paid={partial['paid_amount']} ar_after={ar_partial}")

	ok_partial = (
		len(partial["payment_entries"]) == 1
		and flt(partial["paid_amount"]) == 200
		and ar_partial < ar_start - 0.01
		and ar_partial > 0.01
	)

	# Full payoff (remaining balance via Cash + M-Pesa split if both exist).
	remaining = ar_partial
	modes = ["Cash"]
	if frappe.db.exists("Mode of Payment", "M-Pesa"):
		modes.append("M-Pesa")
	elif frappe.db.exists("Mode of Payment", "Mpesa"):
		modes.append("Mpesa")

	if len(modes) > 1 and remaining > 10:
		split_a = flt(remaining / 2, 2)
		split_b = remaining - split_a
		lines = [
			{"mode_of_payment": modes[0], "amount": split_a},
			{"mode_of_payment": modes[1], "amount": split_b},
		]
	else:
		lines = [{"mode_of_payment": modes[0], "amount": remaining}]

	full = record_customer_ar_payment(customer, company, lines)
	ar_final = get_customer_ar_outstanding(customer, company)
	invoices_after = get_customer_ar_invoices(customer, company)
	print(f"SPIKE full PE={full['payment_entries']} paid={full['paid_amount']} ar_final={ar_final}")
	print(f"SPIKE invoices_after={len(invoices_after)} allocations={len(full['allocations'])}")

	ok_full = ar_final <= 0.01 and len(invoices_after) == 0
	ok = ok_partial and ok_full

	print("SPIKE FINDINGS:")
	if ok:
		print("  - Payment Entry (Receive) reduces invoice outstanding (FIFO).")
		print("  - get_customer_ar_outstanding drops after partial and full collection.")
		print("  - Split tender creates one PE per payment mode.")
	else:
		print(f"  - WARNING: partial_ok={ok_partial} full_ok={ok_full} ar_final={ar_final}")

	frappe.db.commit()
	print("SPIKE ar_payment OK (committed)" if ok else "SPIKE ar_payment INCOMPLETE")
