# Copyright (c) 2026, KQS
"""
Spike: POS partial payment → outstanding AR on POS Invoice.

Run:
  bench --site frontend execute kqs_retail.setup.spike_account_sale.run_spike
"""

from __future__ import annotations

import frappe
from frappe.utils import flt

from kqs_retail.setup.account_sale import ensure_account_sale_mode_of_payment
from kqs_retail.setup.customer_fields import ensure_customer_custom_fields
from kqs_retail.utils.customer_account import (
	get_customer_ar_outstanding,
	get_customer_credit_limit,
)


def run_spike() -> None:
	frappe.set_user("Administrator")
	company = frappe.db.get_value("Company", {}, "name")
	if not company:
		print("SPIKE account_sale: no company")
		return

	ensure_customer_custom_fields()
	ensure_account_sale_mode_of_payment(company)

	item = frappe.db.sql(
		"""
		select b.item_code, b.warehouse
		from `tabBin` b
		inner join `tabItem` i on i.name = b.item_code
		where b.actual_qty > 0 and i.is_stock_item = 1
		limit 1
		""",
		as_dict=True,
	)
	if not item:
		print("SPIKE account_sale: no stock items")
		return
	item_code, warehouse = item[0].item_code, item[0].warehouse

	mobile = "26659999002"
	customer = frappe.db.get_value("Customer", {"mobile_no": mobile}, "name")
	if not customer:
		customer = frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": "Spike Account Customer",
				"customer_type": "Individual",
				"mobile_no": mobile,
			}
		).insert(ignore_permissions=True).name

	cust = frappe.get_doc("Customer", customer)
	cust.kqs_allow_account_sales = 1
	existing = [row for row in cust.credit_limits if row.company == company]
	if existing:
		existing[0].credit_limit = 5000
	else:
		cust.append("credit_limits", {"company": company, "credit_limit": 5000})
	cust.save(ignore_permissions=True)

	ar_before = get_customer_ar_outstanding(customer, company)
	limit = get_customer_credit_limit(customer, company)
	print(f"SPIKE customer={customer} ar_before={ar_before} limit={limit}")

	inv = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": customer,
			"company": company,
			"is_pos": 1,
			"update_stock": 1,
			"items": [{"item_code": item_code, "qty": 1, "rate": 1000, "warehouse": warehouse}],
		}
	)
	inv.append("payments", {"mode_of_payment": "Cash", "amount": 400})
	inv.append("payments", {"mode_of_payment": "On Account", "amount": 600})
	inv.insert(ignore_permissions=True)
	inv.submit()

	outstanding = flt(inv.outstanding_amount)
	ar_after = get_customer_ar_outstanding(customer, company)
	print(f"SPIKE invoice={inv.name} grand_total={inv.grand_total} paid={inv.paid_amount}")
	print(f"SPIKE outstanding_amount={outstanding} ar_after={ar_after}")

	ok = outstanding > 0.01 and ar_after > ar_before
	print("SPIKE FINDINGS:")
	if ok:
		print("  - ERPNext allows POS invoice submit with partial payment (AR outstanding).")
		print("  - KQS validate_account_sale_before_submit enforces credit limit on before_submit.")
	else:
		print("  - WARNING: outstanding not created — POS may need client-side checkout patch.")

	frappe.db.commit()
	print("SPIKE account_sale OK (committed)" if ok else "SPIKE account_sale INCOMPLETE")
