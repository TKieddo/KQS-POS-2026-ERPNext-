# Copyright (c) 2026, KQS

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, today

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
	names = list(get_kqs_warehouse_names(company) or [])
	if not names or not company:
		return []
	filters = filters or {}
	if cint(filters.get("exclude_central")):
		central = get_kqs_central_warehouse(company)
		if central:
			names = [n for n in names if n != central]
	if not names:
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
	from kqs_retail.utils.warehouses import list_kqs_warehouse_choices

	return {
		"company": company,
		# Empty on purpose — Assign must pick From / To explicitly (multi-branch safe).
		"source_warehouse": "",
		"target_warehouse": "",
		"central_warehouse": _default_central_warehouse(company),
		"warehouses": list_kqs_warehouse_choices(company),
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
	source = cstr(source_warehouse or "").strip()
	if not source:
		frappe.throw(_("Select the From (source) warehouse — stock is taken from there."))
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


def _expand_item_codes(codes: list[str], *, expand_templates: bool = True) -> set[str]:
	expanded: set[str] = set()
	for raw in codes:
		code = cstr(raw or "").strip()
		if not code or not frappe.db.exists("Item", code):
			continue
		expanded.add(code)
		if expand_templates and frappe.db.get_value("Item", code, "has_variants"):
			for variant in frappe.get_all("Item", filters={"variant_of": code}, pluck="name"):
				expanded.add(variant)
	return expanded


def _assert_branch_warehouse(source_warehouse: str, company: str) -> str:
	if not source_warehouse:
		frappe.throw(_("Branch warehouse is required."))
	company = company or frappe.db.get_value("Warehouse", source_warehouse, "company") or get_default_company()
	central = get_kqs_central_warehouse(company)
	if central and source_warehouse == central:
		frappe.throw(_("Choose a branch warehouse, not Central."))
	if not is_kqs_store_warehouse(source_warehouse, company):
		frappe.throw(_("Source must be a KQS store warehouse."))
	return company


@frappe.whitelist()
def get_branch_stock_lines(item_code: str, warehouse: str):
	"""Variants (or standalone) with on-hand / sellable at one warehouse — for Remove-from-branch UI."""
	assert_stock_manager()
	item_code = cstr(item_code or "").strip()
	warehouse = cstr(warehouse or "").strip()
	if not item_code or not warehouse:
		frappe.throw(_("Product and branch warehouse are required."))
	_assert_branch_warehouse(warehouse, "")

	template = resolve_template_code(item_code)
	codes = _expand_item_codes([template or item_code], expand_templates=True)
	lines = []
	for code in sorted(codes):
		if frappe.db.get_value("Item", code, "has_variants"):
			continue
		on_hand = flt(frappe.db.get_value("Bin", {"item_code": code, "warehouse": warehouse}, "actual_qty"))
		sellable = _available_qty(code, warehouse)
		if on_hand <= 0 and sellable <= 0:
			continue
		attrs = get_variant_attributes(code)
		attr_label = ", ".join(f"{k}: {v}" for k, v in attrs.items()) if attrs else ""
		row = frappe.db.get_value(
			"Item", code, ["item_name", "item_code", "variant_of"], as_dict=True
		) or {}
		lines.append(
			{
				"item_code": code,
				"sku": row.get("item_code") or code,
				"item_name": row.get("item_name") or code,
				"attributes": attr_label,
				"on_hand": on_hand,
				"sellable_qty": sellable,
				"reserved_qty": flt(on_hand - sellable) if on_hand > sellable else 0,
			}
		)
	return {"warehouse": warehouse, "template": template or item_code, "lines": lines}


@frappe.whitelist()
def discard_branch_stock(
	source_warehouse: str,
	item_codes: str | None = None,
	company: str = "",
	expand_templates: int = 0,
):
	"""Zero sellable stock at one branch only (Stock Reconciliation). Other warehouses unchanged.

	Active layby reserved qty is kept at the branch. Catalog Item is not deleted.
	"""
	assert_stock_manager()
	company = _assert_branch_warehouse(source_warehouse, company)

	codes = json.loads(item_codes) if isinstance(item_codes, str) else item_codes
	codes = [cstr(c).strip() for c in (codes or []) if cstr(c).strip()]
	expanded = _expand_item_codes(codes, expand_templates=bool(cint(expand_templates)))
	if not expanded:
		frappe.throw(_("Select at least one product or variant."))

	rows = []
	for item_code in sorted(expanded):
		if frappe.db.get_value("Item", item_code, "has_variants"):
			continue
		on_hand = flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": source_warehouse}, "actual_qty")
		)
		if on_hand <= 0:
			continue
		sellable = _available_qty(item_code, source_warehouse)
		# Keep reserved (layby) qty; discard only sellable.
		keep_qty = flt(on_hand - sellable) if sellable > 0 else on_hand
		if sellable <= 0:
			continue
		if abs(keep_qty - on_hand) < 0.0001:
			continue
		rate = (
			flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": source_warehouse}, "valuation_rate"))
			or flt(frappe.db.get_value("Item", item_code, "valuation_rate"))
			or flt(frappe.db.get_value("Item", item_code, "standard_rate"))
			or 1.0
		)
		rows.append(
			{
				"item_code": item_code,
				"warehouse": source_warehouse,
				"qty": max(keep_qty, 0),
				"valuation_rate": rate,
			}
		)

	if not rows:
		frappe.throw(
			_("No discardable (sellable) stock at {0} for the selected variants.").format(source_warehouse)
		)

	sr = frappe.get_doc(
		{
			"doctype": "Stock Reconciliation",
			"company": company,
			"purpose": "Stock Reconciliation",
			"items": rows,
		}
	)
	sr.insert(ignore_permissions=True)
	sr.submit()
	return {
		"stock_reconciliation": sr.name,
		"source_warehouse": source_warehouse,
		"action": "discard",
		"lines": len(rows),
	}


@frappe.whitelist()
def return_branch_stock_to_central(
	source_warehouse: str,
	item_codes: str | None = None,
	company: str = "",
	expand_templates: int = 0,
):
	"""Optional: move sellable stock from one branch back to Central (keeps inventory value)."""
	assert_stock_manager()
	company = _assert_branch_warehouse(source_warehouse, company)
	central = get_kqs_central_warehouse(company)
	if not central:
		frappe.throw(_("Central warehouse is not configured."))

	codes = json.loads(item_codes) if isinstance(item_codes, str) else item_codes
	codes = [cstr(c).strip() for c in (codes or []) if cstr(c).strip()]
	expanded = _expand_item_codes(codes, expand_templates=bool(cint(expand_templates)))
	if not expanded:
		frappe.throw(_("Select at least one product or variant."))

	stock_items = []
	for item_code in sorted(expanded):
		if frappe.db.get_value("Item", item_code, "has_variants"):
			continue
		on_hand = flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": source_warehouse}, "actual_qty")
		)
		if on_hand <= 0:
			continue
		available = _available_qty(item_code, source_warehouse)
		qty = min(on_hand, available) if available > 0 else 0
		if qty <= 0:
			continue
		ensure_variant_not_orphaned(item_code)
		stock_items.append(
			{
				"item_code": item_code,
				"qty": qty,
				"s_warehouse": source_warehouse,
				"t_warehouse": central,
			}
		)

	if not stock_items:
		frappe.throw(
			_("No transferable (sellable) stock at {0} for the selected products.").format(source_warehouse)
		)

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
	return {
		"stock_entry": se.name,
		"source_warehouse": source_warehouse,
		"target_warehouse": central,
		"action": "transfer",
		"lines": len(stock_items),
	}


@frappe.whitelist()
def list_source_catalog(
	source_warehouse: str,
	search: str = "",
	start: int = 0,
	limit: int = 50,
	all_pages: int = 0,
):
	"""Products with stock at source — grouped by template or standalone item."""
	if not source_warehouse:
		return {"items": [], "total": 0}

	start = cint(start)
	# all_pages=1 used by “Select all matching” — still hard-capped for safety.
	if cint(all_pages):
		limit = min(max(cint(limit), 1), 5000)
		start = 0
	else:
		limit = min(cint(limit), 100)
	search = (search or "").strip()
	params = {"warehouse": source_warehouse}
	search_sql = ""
	if search:
		# Case-insensitive so "chulk" matches "Chulk" / CHULK style codes.
		search_sql = """
			AND (
				LOWER(IFNULL(i.item_name, '')) LIKE %(search)s
				OR LOWER(IFNULL(i.name, '')) LIKE %(search)s
				OR LOWER(IFNULL(i.item_code, '')) LIKE %(search)s
				OR LOWER(IFNULL(t.item_name, '')) LIKE %(search)s
				OR LOWER(IFNULL(t.name, '')) LIKE %(search)s
				OR LOWER(IFNULL(t.item_code, '')) LIKE %(search)s
			)
		"""
		params["search"] = f"%{search.lower()}%"

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

	# Group by ERPNext variant_of only (COALESCE in SQL). Do not hyphen-infer —
	# that wrongly merges standalone styles like 1234-7 under template 1234.
	catalog: dict[str, dict] = {}
	for row in rows:
		key = cstr(row.catalog_code or row.item_code).strip()
		if not key:
			continue
		if key not in catalog:
			catalog[key] = {
				"item_code": key,
				"item_name": row.catalog_name or key,
				"style_code": key,
				"image": row.catalog_image,
				"item_group": row.item_group,
				"has_variants": bool(row.catalog_has_variants),
				"available_qty": 0.0,
			}
		catalog[key]["available_qty"] += flt(row.qty)

	items = sorted(catalog.values(), key=lambda row: (row["item_name"] or "").lower())
	total = len(items)
	return {"items": items[start : start + limit], "total": total, "warehouse": source_warehouse}


@frappe.whitelist()
def list_branch_filter_options():
	"""KQS warehouses for Item list branch switcher (Central + stores)."""
	assert_stock_manager()
	company = get_default_company()
	names = list(get_kqs_warehouse_names(company) or [])
	if not names:
		return {"branches": [], "company": company}
	central = get_kqs_central_warehouse(company)
	rows = frappe.get_all(
		"Warehouse",
		filters={"name": ["in", names], "disabled": 0, "is_group": 0},
		fields=["name", "warehouse_name"],
		order_by="name asc",
	)
	branches = []
	for row in rows:
		label = (row.warehouse_name or row.name or "").strip() or row.name
		branches.append(
			{
				"name": row.name,
				"label": label,
				"is_central": 1 if central and row.name == central else 0,
			}
		)
	# Central first, then alphabetical by label.
	branches.sort(key=lambda b: (0 if b["is_central"] else 1, (b["label"] or "").lower()))
	return {"branches": branches, "company": company, "central": central or ""}


@frappe.whitelist()
def list_item_names_with_stock(warehouse: str, limit: int = 5000):
	"""Item codes (variants + their templates) with on-hand qty at a warehouse.

	Used by Item list branch filter so managers can see what each store holds.
	"""
	assert_stock_manager()
	warehouse = cstr(warehouse or "").strip()
	if not warehouse:
		return {"item_names": [], "warehouse": ""}
	if not is_kqs_store_warehouse(warehouse):
		frappe.throw(_("Select a KQS store warehouse."))

	limit = min(max(cint(limit), 1), 10000)
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT i.name AS item_code, IFNULL(i.variant_of, '') AS variant_of
		FROM `tabBin` b
		INNER JOIN `tabItem` i ON i.name = b.item_code
		WHERE b.warehouse = %s
		  AND b.actual_qty > 0
		  AND IFNULL(i.disabled, 0) = 0
		  AND i.is_stock_item = 1
		LIMIT %s
		""",
		(warehouse, limit),
		as_dict=True,
	)
	names: set[str] = set()
	for row in rows:
		code = cstr(row.item_code or "").strip()
		parent = cstr(row.variant_of or "").strip()
		if code:
			names.add(code)
		if parent:
			names.add(parent)
	return {"item_names": sorted(names), "warehouse": warehouse, "count": len(names)}


@frappe.whitelist()
def get_transfer_lines(item_code: str, source_warehouse: str = "", in_stock_only: int = 0):
	"""Return template name and transfer rows (variants or single item) with attributes."""
	# jQuery / JSON can coerce numeric-looking codes; keep hyphenated SKUs as strings.
	item_code = cstr(item_code or "").strip()
	if not item_code:
		return {"template_name": "", "template_code": "", "style_code": "", "lines": []}

	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} was not found.").format(item_code))

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
	for raw in codes:
		code = cstr(raw or "").strip()
		if not code or code in seen:
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
