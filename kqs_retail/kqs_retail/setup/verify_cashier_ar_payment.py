# Copyright (c) 2026, KQS
"""Dev smoke: cashier can post Payment Entry via Customer Account API path."""

from __future__ import annotations

import frappe
from frappe.utils import flt

from kqs_retail.utils.ar_payment import get_customer_ar_outstanding, record_customer_ar_payment


def run(customer: str = "Hape Tuke", amount: float = 1) -> None:
	company = frappe.db.get_value("Company", {}, "name")
	if not company:
		print("verify_cashier_ar_payment: no company")
		return

	frappe.set_user("cashier@kqs.local")
	ar_before = get_customer_ar_outstanding(customer, company)
	print(f"cashier PE submit perm: {frappe.has_permission('Payment Entry', 'submit')}")
	print(f"customer={customer} ar_before={ar_before}")

	if ar_before < flt(amount):
		print("verify_cashier_ar_payment: skip (no outstanding balance)")
		return

	result = record_customer_ar_payment(
		customer,
		company,
		[{"mode_of_payment": "Cash", "amount": flt(amount)}],
	)
	ar_after = get_customer_ar_outstanding(customer, company)
	print(f"OK pe={result['payment_entries']} ar_after={ar_after}")
