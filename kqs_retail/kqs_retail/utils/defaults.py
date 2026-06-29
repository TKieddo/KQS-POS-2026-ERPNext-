# Copyright (c) 2026, KQS

import frappe


def get_default_company() -> str:
	"""Resolve the active company for the current session."""
	defaults = frappe.defaults.get_defaults()
	company = None
	if defaults:
		company = defaults.get("company") if isinstance(defaults, dict) else getattr(defaults, "company", None)
	if company:
		return company
	return frappe.db.get_single_value("Global Defaults", "default_company") or ""


KQS_DEFAULT_STOCK_UOM = "Piece"


def get_default_stock_uom() -> str:
	"""Preferred retail UOM for new catalog items (Pieces), with sensible fallbacks."""
	for candidate in (KQS_DEFAULT_STOCK_UOM, "Pieces", "Nos"):
		if frappe.db.exists("UOM", candidate):
			return candidate
	stock_uom = frappe.db.get_single_value("Stock Settings", "stock_uom")
	if stock_uom and frappe.db.exists("UOM", stock_uom):
		return stock_uom
	return "Nos"
