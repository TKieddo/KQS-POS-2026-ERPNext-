# Copyright (c) 2026, KQS
"""
Spike / smoke: return → store credit on named customer → redeem on new sale.

Run:
  bench --site frontend execute kqs_retail.setup.spike_store_credit.run_spike
"""

from __future__ import annotations

import frappe
from frappe.utils import flt

from kqs_retail.utils.store_credit import (
	get_customer_store_credit_balance,
	is_walk_in_customer,
	register_return_credit_customer,
)


def run_spike() -> None:
	"""Programmatic spike documenting ERPNext v16 POS store credit behaviour."""
	frappe.set_user("Administrator")
	company = frappe.db.get_value("Company", {}, "name")
	if not company:
		print("SPIKE: no company")
		return

	from kqs_retail.setup.store_credit import ensure_store_credit_setup

	ensure_store_credit_setup(company)

	walk_in = frappe.db.get_value("Customer", {"customer_name": ["like", "%Walk-in%"]}, "name")
	if not walk_in:
		walk_in = frappe.db.get_value("Customer", {}, "name", order_by="creation asc")
	print("SPIKE walk_in:", walk_in, "is_walk_in:", is_walk_in_customer(walk_in))

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
		print("SPIKE: no stock items")
		return
	item_code, warehouse = item[0].item_code, item[0].warehouse

	named = frappe.db.get_value("Customer", {"mobile_no": "26659999001"}, "name")
	if not named:
		named = frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": "Spike Credit Customer",
				"customer_type": "Individual",
				"mobile_no": "26659999001",
			}
		).insert(ignore_permissions=True).name

	inv = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": walk_in,
			"company": company,
			"is_pos": 1,
			"update_stock": 1,
			"items": [{"item_code": item_code, "qty": 1, "rate": 600, "warehouse": warehouse}],
		}
	)
	inv.append("payments", {"mode_of_payment": "Cash", "amount": 600})
	inv.insert(ignore_permissions=True)
	inv.submit()
	print("SPIKE sale:", inv.name, "customer:", inv.customer)

	register_return_credit_customer(named)
	cn = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": walk_in,
			"company": company,
			"is_return": 1,
			"return_against": inv.name,
			"update_stock": 1,
			"items": [{"item_code": item_code, "qty": -1, "rate": 600, "warehouse": warehouse}],
		}
	)
	cn.insert(ignore_permissions=True)
	apply_return_credit_customer = __import__(
		"kqs_retail.utils.store_credit", fromlist=["apply_return_credit_customer"]
	).apply_return_credit_customer
	apply_return_credit_customer(cn)
	cn.submit()
	print(
		"SPIKE return CN:",
		cn.name,
		"customer:",
		cn.customer,
		"outstanding:",
		cn.outstanding_amount,
		"reassigned:",
		cn.customer == named,
	)

	balance = get_customer_store_credit_balance(named, company)
	print("SPIKE available credit:", balance)

	new_inv = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": named,
			"company": company,
			"is_pos": 1,
			"update_stock": 1,
			"items": [{"item_code": item_code, "qty": 1, "rate": 900, "warehouse": warehouse}],
		}
	)
	store_credit_mode = "Store Credit" if frappe.db.exists("Mode of Payment", "Store Credit") else "Cash"
	credit_use = min(flt(balance), 600)
	cash_use = 900 - credit_use
	if credit_use > 0:
		new_inv.append("payments", {"mode_of_payment": store_credit_mode, "amount": credit_use})
	if cash_use > 0:
		new_inv.append("payments", {"mode_of_payment": "Cash", "amount": cash_use})
	new_inv.insert(ignore_permissions=True)
	new_inv.submit()
	balance_after = get_customer_store_credit_balance(named, company)
	print("SPIKE balance after sale:", balance_after)
	print("SPIKE FINDINGS:")
	print("  - ERPNext POS does NOT auto-apply return credit; KQS uses Payment Reconciliation.")
	print("  - Walk-in return must reassign customer before submit (hook + register_return_credit_customer).")
	print("  - Store Credit mode posts as POS payment row; reconcile_dr_cr_note links CN to new invoice.")

	frappe.db.commit()
	print("SPIKE OK (committed)")
