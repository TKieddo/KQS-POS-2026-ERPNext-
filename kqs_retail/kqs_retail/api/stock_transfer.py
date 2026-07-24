# Copyright (c) 2026, KQS

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, today

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
	get_kqs_warehouse_names,
	is_kqs_store_warehouse,
)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def kqs_warehouse_query(doctype, txt, searchfield, start, page_len, filters):
	"""Warehouse link query — KQS Central + store branches only."""
	company = get_default_company()
	names = get_kqs_warehouse_names(company)
	if not names or not company:
		return []
	return frappe.db.sql(
		"""
		SELECT name, warehouse_name
		FROM `tabWarehouse`
		WHERE company = %(company)s
		  AND name IN %(names)s
		  AND IFNULL(disabled, 0) = 0
		  AND is_group = 0
		  AND (name LIKE %(txt)s OR warehouse_name LIKE %(txt)s)
		ORDER BY name ASC
		LIMIT %(start)s, %(page_len)s
		""",
		{
			"company": company,
			"names": names,
			"txt": f"%{txt}%",
			"start": start,
			"page_len": page_len,
		},
	)


@frappe.whitelist()
def get_transfer_defaults():
	company = get_default_company()
	return {
		"company": company,
		"source_warehouse": _default_central_warehouse(company),
	}


@frappe.whitelist()
def assign_stock_to_branch(
	target_warehouse: str,
	items: str,
	source_warehouse: str = "",
	company: str = "",
):
	"""Material transfer from one warehouse to another (Central, store, or branch)."""
	assert_stock_manager()
	lines = json.loads(items) if isinstance(items, str) else items
	if not lines:
		frappe.throw(_("Add at least one item with quantity."))
	if not target_warehouse:
		frappe.throw(_("Target warehouse is required."))

	company = company or frappe.db.get_value("Warehouse", target_warehouse, "company")
	source = source_warehouse or _default_central_warehouse(company)
	if not source:
		frappe.throw(_("Source warehouse not found. Configure Central warehouse first."))
	if source == target_warehouse:
		frappe.throw(_("Source and target warehouse must be different."))
	for wh, label in ((source, _("Source")), (target_warehouse, _("Target"))):
		if not is_kqs_store_warehouse(wh, company):
			frappe.throw(_("{0} must be a KQS store warehouse.").format(label))

	stock_items = []
	for line in lines:
		qty = flt(line.get("qty"))
		if qty <= 0:
			continue
		item_code = line["item_code"]
		ensure_variant_not_orphaned(item_code)
		available = _available_qty(item_code, source)
		if qty > available:
			frappe.throw(
				_("Cannot transfer {0}: only {1} sellable at {2} (requested {3}).").format(
					item_code, available, source, qty
				)
			)
		stock_items.append(
			{
				"item_code": item_code,
				"qty": qty,
				"s_warehouse": source,
				"t_warehouse": target_warehouse,
			}
		)

	if not stock_items:
		frappe.throw(_("Enter quantity for at least one item."))

	se = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Transfer",
			"company": company,
			"posting_date": today(),
			"items": stock_items,
		}
	)
	se.insert(ignore_permissions=True)
	se.submit()
	return {"stock_entry": se.name, "source_warehouse": source, "target_warehouse": target_warehouse}


@frappe.whitelist()
def list_source_catalog(
	source_warehouse: str,
	search: str = "",
	start: int = 0,
	limit: int = 50,
):
	"""Products with stock at source — grouped by template or standalone item."""
	if not source_warehouse:
		return {"items": [], "total": 0}

	start = cint(start)
	limit = min(cint(limit), 100)
	search = (search or "").strip()
	params = {"warehouse": source_warehouse}
	search_sql = ""
	if search:
		search_sql = """
			AND (
				i.item_name LIKE %(search)s
				OR i.name LIKE %(search)s
				OR i.item_code LIKE %(search)s
				OR IFNULL(t.item_name, '') LIKE %(search)s
			)
		"""
		params["search"] = f"%{search}%"

	rows = frappe.db.sql(
		f"""
		SELECT
			i.name AS item_code,
			i.item_name,
			i.image,
			i.item_group,
			i.variant_of,
			i.has_variants,
			COALESCE(NULLIF(i.variant_of, ''), i.name) AS catalog_code,
			COALESCE(t.item_name, i.item_name) AS catalog_name,
			COALESCE(t.image, i.image) AS catalog_image,
			COALESCE(t.has_variants, i.has_variants) AS catalog_has_variants,
			b.actual_qty AS qty
		FROM `tabBin` b
		INNER JOIN `tabItem` i ON i.name = b.item_code
		LEFT JOIN `tabItem` t ON t.name = i.variant_of
		WHERE b.warehouse = %(warehouse)s
		  AND b.actual_qty > 0
		  AND i.disabled = 0
		  AND i.is_stock_item = 1
		  {search_sql}
		ORDER BY catalog_name ASC, i.modified DESC
		""",
		params,
		as_dict=True,
	)

	catalog: dict[str, dict] = {}
	for row in rows:
		key = resolve_template_code(row.item_code)
		template_name = row.catalog_name or key
		template_image = row.catalog_image
		has_variants = bool(row.catalog_has_variants)
		if key != row.catalog_code:
			template_name = frappe.db.get_value("Item", key, "item_name") or key
			template_image = frappe.db.get_value("Item", key, "image") or template_image
			has_variants = bool(frappe.db.get_value("Item", key, "has_variants"))
		if key not in catalog:
			catalog[key] = {
				"item_code": key,
				"item_name": template_name,
				"style_code": key,
				"image": template_image,
				"item_group": row.item_group,
				"has_variants": has_variants,
				"available_qty": 0.0,
			}
		catalog[key]["available_qty"] += flt(row.qty)

	items = sorted(catalog.values(), key=lambda row: (row["item_name"] or "").lower())
	total = len(items)
	return {"items": items[start : start + limit], "total": total}


@frappe.whitelist()
def get_transfer_lines(item_code: str, source_warehouse: str = "", in_stock_only: int = 0):
	"""Return template name and transfer rows (variants or single item) with attributes."""
	if not item_code:
		return {"template_name": "", "template_code": "", "style_code": "", "lines": []}

	item = frappe.get_cached_doc("Item", item_code)
	template_code = resolve_template_code(item.name)
	template = frappe.get_cached_doc("Item", template_code)
	template_name = template.item_name or template_code
	style_code = template_code
	has_variants = bool(template.has_variants)

	if has_variants:
		variants = frappe.get_all(
			"Item",
			filters={"variant_of": template_code, "disabled": 0, "is_stock_item": 1},
			fields=["name", "item_name", "item_code"],
			order_by="name",
		)
		if not variants:
			frappe.throw(
				_("No variants found for {0} ({1}). Add variants under this style first.").format(
					template_name, style_code
				)
			)
	else:
		code = item.name
		variants = [
			{
				"name": code,
				"item_name": frappe.db.get_value("Item", code, "item_name") or code,
				"item_code": code,
			}
		]

	lines = []
	for variant in variants:
		attrs = get_variant_attributes(variant["name"])
		attr_label = ", ".join(f"{k}: {v}" for k, v in attrs.items())
		display_name = variant["item_name"]
		if attrs and template_name:
			display_name = variant_item_name(template_name, attrs)
		available_qty = _available_qty(variant["name"], source_warehouse)
		lines.append(
			{
				"item_code": variant["name"],
				"variant_sku": variant.get("item_code") or variant["name"],
				"item_name": display_name,
				"attributes": attr_label,
				"available_qty": available_qty,
				"template_code": template_code,
				"template_name": template_name,
				"style_code": style_code,
			}
		)

	if source_warehouse and cint(in_stock_only):
		lines = [line for line in lines if line["available_qty"] > 0]

	return {
		"template_name": template_name,
		"template_code": template_code,
		"style_code": style_code,
		"lines": lines,
	}


@frappe.whitelist()
def get_bulk_transfer_lines(item_codes: str, source_warehouse: str = "", in_stock_only: int = 0):
	codes = json.loads(item_codes) if isinstance(item_codes, str) else item_codes
	if not codes:
		return {"lines": []}

	seen = set()
	lines = []
	for code in codes:
		if code in seen:
			continue
		seen.add(code)
		result = get_transfer_lines(code, source_warehouse, in_stock_only=in_stock_only)
		for line in result.get("lines") or []:
			lines.append(line)

	return {"lines": lines}


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def item_link_query(doctype, txt, searchfield, start, page_len, filters):
	"""Link query: in-stock templates and standalone items at the source warehouse."""
	source = (filters or {}).get("source_warehouse") if filters else None
	if not source:
		return []

	return frappe.db.sql(
		"""
		SELECT DISTINCT catalog.name, catalog.item_name
		FROM (
			SELECT
				COALESCE(NULLIF(i.variant_of, ''), i.name) AS name,
				COALESCE(t.item_name, i.item_name) AS item_name,
				i.modified
			FROM `tabBin` b
			INNER JOIN `tabItem` i ON i.name = b.item_code
			LEFT JOIN `tabItem` t ON t.name = i.variant_of
			WHERE b.warehouse = %(warehouse)s
			  AND b.actual_qty > 0
			  AND i.disabled = 0
			  AND i.is_stock_item = 1
			  AND (
				COALESCE(t.item_name, i.item_name) LIKE %(txt)s
				OR i.name LIKE %(txt)s
				OR i.item_code LIKE %(txt)s
			  )
		) catalog
		ORDER BY catalog.modified DESC
		LIMIT %(start)s, %(page_len)s
		""",
		{"warehouse": source, "txt": f"%{txt}%", "start": start, "page_len": page_len},
	)


@frappe.whitelist()
def search_product_variants(query: str = "", limit: int = 20):
	or_filters = []
	if query:
		or_filters = [
			["item_name", "like", f"%{query}%"],
			["item_code", "like", f"%{query}%"],
			["variant_of", "like", f"%{query}%"],
		]

	return frappe.get_all(
		"Item",
		filters={"disabled": 0, "is_stock_item": 1},
		or_filters=or_filters if or_filters else None,
		fields=["name", "item_name", "item_code", "variant_of", "standard_rate"],
		limit_page_length=min(int(limit), 100),
		order_by="modified desc",
	)


def _available_qty(item_code: str, warehouse: str) -> float:
	"""Sellable qty at warehouse (on-hand minus active layby reservations)."""
	if not warehouse:
		return 0.0
	from kqs_retail.kqs_layby.stock_reservation import get_sellable_qty

	return flt(get_sellable_qty(item_code, warehouse))


def _default_central_warehouse(company: str) -> str:
	central = get_kqs_central_warehouse(company)
	if central and frappe.db.exists("Warehouse", central):
		return central
	return ""
