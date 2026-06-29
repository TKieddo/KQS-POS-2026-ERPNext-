# Copyright (c) 2026, KQS

import frappe
from frappe.utils import flt


@frappe.whitelist(allow_guest=False)
def get_stock_by_warehouse(warehouse: str, item_group: str = ""):
	"""Bulk sellable stock for website / POS catalog sync."""
	filters = {"warehouse": warehouse}
	if item_group:
		filters["item_group"] = item_group

	bins = frappe.get_all(
		"Bin",
		filters=filters,
		fields=["item_code", "actual_qty"],
		limit_page_length=5000,
	)
	out = []
	for b in bins:
		from kqs_retail.kqs_layby.stock_reservation import get_sellable_qty

		sellable = get_sellable_qty(b.item_code, warehouse)
		if sellable <= 0:
			continue
		item = frappe.db.get_value(
			"Item",
			b.item_code,
			["item_name", "image", "standard_rate", "item_group"],
			as_dict=True,
		)
		out.append(
			{
				"item_code": b.item_code,
				"item_name": item.item_name,
				"image": item.image,
				"rate": item.standard_rate,
				"item_group": item.item_group,
				"warehouse": warehouse,
				"qty": sellable,
			}
		)
	return out
