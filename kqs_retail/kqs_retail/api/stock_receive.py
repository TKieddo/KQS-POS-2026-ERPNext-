# Copyright (c) 2026, KQS
"""Receive stock (Material Receipt) for existing catalog items."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

from kqs_retail.api.product_setup import _receipt_stock_batch
from kqs_retail.utils.defaults import get_default_company
from kqs_retail.utils.items import (
	ensure_variant_not_orphaned,
	get_variant_attributes,
	resolve_template_code,
	variant_item_name,
)
from kqs_retail.utils.manager_access import assert_stock_manager
from kqs_retail.utils.warehouses import (
	get_kqs_central_warehouse,
	is_kqs_store_warehouse,
)


@frappe.whitelist()
def get_receive_defaults():
	assert_stock_manager()
	company = get_default_company()
	return {
		"company": company,
		"warehouse": _default_central_warehouse(company),
	}


@frappe.whitelist()
def search_products_for_receive(
	query: str = "",
	warehouse: str = "",
	start: int = 0,
	limit: int = 50,
):
	"""Browse templates / standalones including zero-stock items."""
	assert_stock_manager()
	start = cint(start)
	limit = min(cint(limit), 100)
	query = (query or "").strip()
	params: dict = {}
	search_sql = ""
	if query:
		search_sql = """
			AND (
				i.item_name LIKE %(search)s
				OR i.name LIKE %(search)s
				OR i.item_code LIKE %(search)s
				OR EXISTS (
					SELECT 1 FROM `tabItem` v
					WHERE v.variant_of = i.name
					  AND (
						v.item_name LIKE %(search)s
						OR v.name LIKE %(search)s
						OR v.item_code LIKE %(search)s
					  )
				)
			)
		"""
		params["search"] = f"%{query}%"

	qty_select = "0 AS available_qty"
	qty_join = ""
	if warehouse:
		qty_select = "IFNULL(bq.qty, 0) AS available_qty"
		qty_join = """
			LEFT JOIN (
				SELECT
					COALESCE(NULLIF(bi.variant_of, ''), bi.name) AS catalog_code,
					SUM(b.actual_qty) AS qty
				FROM `tabBin` b
				INNER JOIN `tabItem` bi ON bi.name = b.item_code
				WHERE b.warehouse = %(warehouse)s
				GROUP BY catalog_code
			) bq ON bq.catalog_code = i.name
		"""
		params["warehouse"] = warehouse

	rows = frappe.db.sql(
		f"""
		SELECT
			i.name AS item_code,
			i.item_name,
			i.image,
			i.item_group,
			i.has_variants,
			i.name AS style_code,
			{qty_select}
		FROM `tabItem` i
		{qty_join}
		WHERE i.disabled = 0
		  AND i.is_stock_item = 1
		  AND IFNULL(i.variant_of, '') = ''
		  {search_sql}
		ORDER BY i.item_name ASC
		LIMIT %(start)s, %(limit)s
		""",
		{**params, "start": start, "limit": limit + 1},
		as_dict=True,
	)
	has_more = len(rows) > limit
	items = rows[:limit]
	return {"items": items, "total": start + len(items) + (1 if has_more else 0), "has_more": has_more}


@frappe.whitelist()
def get_receive_lines(item_or_template: str, warehouse: str = ""):
	"""Variants (or standalone) with on-hand qty at warehouse for receive grid."""
	assert_stock_manager()
	# jQuery .data() and JSON can turn numeric-looking item codes into ints.
	item_or_template = cstr(item_or_template or "").strip()
	if not item_or_template:
		return {"template_name": "", "template_code": "", "style_code": "", "lines": []}

	template_code = resolve_template_code(item_or_template)
	template = frappe.get_cached_doc("Item", template_code)
	template_name = template.item_name or template_code
	has_variants = bool(template.has_variants)

	if has_variants:
		variants = frappe.get_all(
			"Item",
			filters={"variant_of": template_code, "disabled": 0, "is_stock_item": 1},
			fields=["name", "item_name", "item_code", "standard_rate"],
			order_by="name",
		)
		if not variants:
			frappe.throw(
				_("No variants found for {0}. Add variants on Edit Product first.").format(template_name)
			)
	else:
		variants = [
			{
				"name": template.name,
				"item_name": template.item_name,
				"item_code": template.item_code or template.name,
				"standard_rate": template.standard_rate,
			}
		]

	lines = []
	for variant in variants:
		attrs = get_variant_attributes(variant["name"])
		attr_label = ", ".join(f"{k}: {v}" for k, v in attrs.items())
		display_name = variant["item_name"]
		if attrs and template_name:
			display_name = variant_item_name(template_name, attrs)
		lines.append(
			{
				"item_code": variant["name"],
				"variant_sku": variant.get("item_code") or variant["name"],
				"item_name": display_name,
				"attributes": attr_label,
				"on_hand": _on_hand(variant["name"], warehouse),
				"rate": flt(variant.get("standard_rate")),
				"template_code": template_code,
				"template_name": template_name,
				"style_code": template_code,
			}
		)

	return {
		"template_name": template_name,
		"template_code": template_code,
		"style_code": template_code,
		"lines": lines,
	}


@frappe.whitelist()
def get_bulk_receive_lines(item_codes: str, warehouse: str = ""):
	assert_stock_manager()
	codes = json.loads(item_codes) if isinstance(item_codes, str) else item_codes
	if not codes:
		return {"lines": []}

	seen = set()
	lines = []
	for code in codes:
		code = cstr(code).strip()
		if not code or code in seen:
			continue
		seen.add(code)
		result = get_receive_lines(code, warehouse)
		lines.extend(result.get("lines") or [])
	return {"lines": lines}


@frappe.whitelist()
def receive_stock(warehouse: str, items_json: str, company: str = ""):
	"""Batch Material Receipt into a KQS warehouse."""
	assert_stock_manager()
	warehouse = (warehouse or "").strip()
	if not warehouse:
		frappe.throw(_("Warehouse is required."))

	company = company or frappe.db.get_value("Warehouse", warehouse, "company") or get_default_company()
	if not is_kqs_store_warehouse(warehouse, company):
		frappe.throw(_("Select a valid KQS warehouse."))

	raw = json.loads(items_json) if isinstance(items_json, str) else items_json
	if not isinstance(raw, list) or not raw:
		frappe.throw(_("Add at least one item with quantity."))

	lines = []
	for row in raw:
		item_code = cstr(row.get("item_code") or "").strip()
		qty = flt(row.get("qty"))
		if not item_code:
			continue
		if qty <= 0:
			frappe.throw(_("Receive quantity must be greater than zero for {0}.").format(item_code))
		if not frappe.db.exists("Item", item_code):
			frappe.throw(_("Item {0} was not found.").format(item_code))
		item = frappe.get_cached_doc("Item", item_code)
		if item.has_variants:
			frappe.throw(_("Receive stock on variant SKUs, not template {0}.").format(item_code))
		if not item.is_stock_item:
			frappe.throw(_("Item {0} is not a stock item.").format(item_code))
		if item.disabled:
			frappe.throw(_("Item {0} is disabled.").format(item_code))
		ensure_variant_not_orphaned(item_code)
		rate = flt(row.get("rate"))
		if rate <= 0:
			rate = flt(item.standard_rate) or 1
		lines.append({"item_code": item_code, "qty": qty, "rate": rate})

	if not lines:
		frappe.throw(_("Enter quantity for at least one item."))

	stock_entry = _receipt_stock_batch(lines, warehouse)
	return {"stock_entry": stock_entry, "warehouse": warehouse}


def _on_hand(item_code: str, warehouse: str) -> float:
	if not warehouse:
		return 0.0
	from erpnext.stock.utils import get_stock_balance

	return flt(get_stock_balance(item_code, warehouse))


def _default_central_warehouse(company: str) -> str:
	central = get_kqs_central_warehouse(company)
	if central and frappe.db.exists("Warehouse", central):
		return central
	return ""
