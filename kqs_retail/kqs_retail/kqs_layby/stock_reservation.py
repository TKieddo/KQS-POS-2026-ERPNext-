# Copyright (c) 2026, KQS

import frappe
from frappe.utils import flt


def create_reservation(layby):
	"""Layby holds are tracked on Layby Agreement line items.

	ERPNext v16 Stock Reservation Entry only links to SO/WO vouchers, so sellable
	qty uses active layby lines via get_reserved_qty() instead of SRE.
	"""
	return None


def release_reservation(reservation_name: str | None):
	if not reservation_name:
		return
	if not frappe.db.exists("Stock Reservation Entry", reservation_name):
		return
	doc = frappe.get_doc("Stock Reservation Entry", reservation_name)
	if doc.docstatus == 1:
		doc.cancel()


def get_reserved_qty(item_code: str, warehouse: str) -> float:
	"""Sum reserved qty for item at warehouse from active laybys."""
	result = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(li.qty), 0)
		FROM `tabLayby Item` li
		INNER JOIN `tabLayby Agreement` la ON la.name = li.parent
		WHERE la.docstatus = 1 AND la.status = 'Active'
		  AND li.item_code = %s AND la.warehouse = %s
		""",
		(item_code, warehouse),
	)
	return flt(result[0][0] if result else 0)


def get_sellable_qty(item_code: str, warehouse: str) -> float:
	bin_qty = frappe.db.get_value(
		"Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"
	) or 0
	return flt(bin_qty) - get_reserved_qty(item_code, warehouse)
