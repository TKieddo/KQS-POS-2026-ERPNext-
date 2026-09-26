# Copyright (c) 2026, KQS

import frappe
from frappe.utils import flt, today

from kqs_retail.utils.layby_settlement import ensure_settlement_mode_or_throw


def create_sales_invoice_from_layby(layby):
	"""Create submitted Sales Invoice when layby is fully paid.

	Uses Layby Settlement (non-cash) so cashup does not treat the agreement total
	as till money — deposits/installments already hit the drawer via Layby Payment.
	"""
	inv = frappe.new_doc("Sales Invoice")
	inv.customer = layby.customer
	inv.company = layby.company
	inv.posting_date = today()
	inv.set_warehouse = layby.warehouse
	inv.update_stock = 1
	inv.is_pos = 1

	for row in layby.items:
		inv.append(
			"items",
			{
				"item_code": row.item_code,
				"qty": row.qty,
				"rate": row.rate,
				"warehouse": layby.warehouse,
				"uom": row.uom,
			},
		)

	total = sum(flt(row.qty) * flt(row.rate) for row in layby.items)
	settlement_mode = ensure_settlement_mode_or_throw()
	inv.append("payments", {"mode_of_payment": settlement_mode, "amount": total})

	inv.insert(ignore_permissions=True)
	inv.submit()
	return inv
