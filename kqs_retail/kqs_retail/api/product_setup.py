# Copyright (c) 2026, KQS

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, today

from kqs_retail.utils.defaults import get_default_company, get_default_stock_uom
from kqs_retail.utils.manager_access import assert_stock_manager
from kqs_retail.utils.items import (
	get_variant_attributes,
	resolve_template_code,
)

try:
	from kqs_retail.utils.warehouses import (
		get_kqs_central_warehouse,
		get_kqs_branch_warehouse_names,
		is_kqs_store_warehouse,
	)
except ImportError:
	# Older deployed warehouses.py (pre dynamic branch discovery).
	from kqs_retail.utils.warehouses import (
		get_kqs_central_warehouse,
		get_kqs_warehouse_names,
		is_kqs_store_warehouse,
	)

	def get_kqs_branch_warehouse_names(company: str = "") -> list[str]:
		names = get_kqs_warehouse_names(company)
		central = get_kqs_central_warehouse(company)
		branches = [name for name in names if name != central]
		return branches


@frappe.whitelist()
def get_add_product_defaults():
	company = get_default_company()
	return {
		"warehouse": _default_central_warehouse(company),
		"stock_uom": get_default_stock_uom(),
	}


_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif", ".heic")


@frappe.whitelist()
def list_image_library(search: str = "", start: int = 0, limit: int = 48):
	"""Recent image files for Add Product visual library picker (no re-upload)."""
	start = cint(start)
	limit = min(cint(limit), 100)
	search = (search or "").strip()

	or_filters = [[ "file_name", "like", f"%{ext}" ] for ext in _IMAGE_EXTENSIONS]
	if search:
		or_filters.extend(
			[
				["file_name", "like", f"%{search}%"],
				["file_url", "like", f"%{search}%"],
			]
		)

	rows = frappe.get_all(
		"File",
		filters={"is_folder": 0},
		or_filters=or_filters,
		fields=["name", "file_name", "file_url", "modified"],
		order_by="modified desc",
		start=start,
		limit_page_length=min(limit + 1, 200) * 3,
	)

	seen_urls: set[str] = set()
	unique: list[dict] = []
	for row in rows:
		url = (row.get("file_url") or "").strip()
		if not url or url in seen_urls:
			continue
		seen_urls.add(url)
		unique.append(row)
		if len(unique) >= limit + 1:
			break

	has_more = len(unique) > limit
	return {"images": unique[:limit], "has_more": has_more}


@frappe.whitelist()
def list_item_attributes():
	"""All Item Attributes with allowed values for Add Product variant UI."""
	attributes = frappe.get_all(
		"Item Attribute",
		fields=["name"],
		order_by="name asc",
		limit=100,
	)
	if not attributes:
		return {"attributes": []}

	names = [row.name for row in attributes]
	value_fields = ["parent", "attribute_value"]
	if _has_swatch_image_field():
		value_fields.append("kqs_swatch_image")
	value_rows = frappe.get_all(
		"Item Attribute Value",
		filters={"parent": ["in", names], "parenttype": "Item Attribute"},
		fields=value_fields,
		order_by="idx asc",
		limit=5000,
	)
	values_by_attr: dict[str, list[str]] = {name: [] for name in names}
	value_images_by_attr: dict[str, dict[str, str]] = {name: {} for name in names}
	for row in value_rows:
		value = (row.attribute_value or "").strip()
		if value:
			values_by_attr.setdefault(row.parent, []).append(value)
			image = (row.get("kqs_swatch_image") or "").strip()
			if image:
				value_images_by_attr.setdefault(row.parent, {})[value] = image

	return {
		"attributes": [
			{
				"name": row.name,
				"values": values_by_attr.get(row.name, []),
				"value_images": value_images_by_attr.get(row.name, {}),
			}
			for row in attributes
		]
	}


@frappe.whitelist()
def create_product_with_variants(
	item_name: str,
	item_group: str,
	variant_matrix: str,
	style_code: str = "",
	description: str = "",
	has_variants: int = 1,
	opening_qty: float = 0,
	central_warehouse: str = "",
	variant_attributes: str = "",
	stock_uom: str = "",
	product_image: str = "",
	gallery_images: str = "",
	attribute_value_images: str = "",
	item_groups: str = "",
):
	"""Create item template + variants from a simple matrix JSON.

	variant_matrix: JSON list of {attributes: {}, sku, rate, barcode, qty}
	variant_attributes: JSON list of attribute names e.g. ["Size", "Color"]
	"""
	assert_stock_manager()
	from erpnext.controllers.item_variant import create_variant

	matrix = json.loads(variant_matrix) if isinstance(variant_matrix, str) else variant_matrix
	if not matrix:
		frappe.throw(_("Add at least one variant row."))

	attr_names = _parse_variant_attributes(variant_attributes, has_variants)
	item_groups_list = _parse_item_groups(item_groups, item_group)
	if not item_groups_list:
		frappe.throw(_("Select at least one category."))
	for name in item_groups_list:
		if not frappe.db.exists("Item Group", name):
			frappe.throw(_("Category {0} was not found.").format(name))
	primary_item_group = item_groups_list[0]

	style_code = (style_code or "").strip()
	if not style_code:
		frappe.throw(_("SKU / Style number is required."))

	template_code = _normalize_item_code(style_code)
	if frappe.db.exists("Item", template_code):
		frappe.throw(_("SKU / Style number {0} already exists.").format(template_code))

	if has_variants:
		_validate_matrix_attributes(matrix, attr_names)

	stock_uom = _resolve_stock_uom(stock_uom)
	main_image = (product_image or "").strip()
	gallery = _parse_image_list(gallery_images)
	attr_images = _parse_attribute_value_images(attribute_value_images)
	company = get_default_company()
	warehouse = central_warehouse or _default_central_warehouse(company)
	if warehouse and not is_kqs_store_warehouse(warehouse, company):
		frappe.throw(_("Select a valid KQS warehouse."))

	template = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": template_code,
			"item_name": item_name,
			"item_group": primary_item_group,
			"stock_uom": stock_uom,
			"is_stock_item": 1,
			"has_variants": 1 if has_variants else 0,
			"description": description,
			"attributes": [{"attribute": name} for name in attr_names] if has_variants else [],
		}
	)
	template.insert(ignore_permissions=True)
	_apply_item_groups(template, item_groups_list)
	_apply_attribute_swatch_images(attr_images)
	_set_item_images(template, main_image, gallery)
	template.save(ignore_permissions=True)

	created = []

	if has_variants:
		for row in matrix:
			attrs = _row_attributes(row, attr_names)
			variant = create_variant(template.name, attrs)
			variant_code = (row.get("sku") or "").strip() or _default_variant_code(
				template_code, attrs, attr_names
			)
			variant_code = _normalize_item_code(variant_code)
			_ensure_new_item_code(variant_code)
			variant.item_code = variant_code
			variant.item_name = _variant_item_name(item_name, attrs)
			variant.standard_rate = flt(row.get("rate"))
			if row.get("barcode"):
				_set_item_barcode(variant, str(row["barcode"]).strip())
			variant_image = (row.get("image") or "").strip() or _variant_image_from_attrs(
				attrs, attr_names, attr_images
			)
			if variant_image:
				variant.image = variant_image
			variant.insert(ignore_permissions=True)
			created.append(variant.name)
			qty = flt(row.get("qty") or opening_qty)
			if qty > 0 and warehouse:
				_receipt_stock(variant.name, warehouse, qty, flt(row.get("rate") or 0))
	else:
		row = matrix[0]
		template.standard_rate = flt(row.get("rate"))
		if row.get("barcode"):
			_set_item_barcode(template, str(row["barcode"]).strip())
		row_image = (row.get("image") or "").strip()
		if row_image:
			template.image = row_image
		template.save(ignore_permissions=True)
		created.append(template.name)
		qty = flt(row.get("qty") or opening_qty)
		if qty > 0 and warehouse:
			_receipt_stock(template.name, warehouse, qty, flt(row.get("rate") or 0))

	return {"template": template.name, "variants": created, "style_code": template_code}


@frappe.whitelist()
def delete_items(item_codes: str):
	"""Delete Item(s) from list/form — variants first; disable if linked to history."""
	raw = json.loads(item_codes) if isinstance(item_codes, str) else item_codes
	if not isinstance(raw, list):
		frappe.throw(_("Invalid item list."))

	codes = [str(code).strip() for code in raw if str(code).strip()]
	if not codes:
		frappe.throw(_("Select at least one Item to delete."))

	if not frappe.has_permission("Item", "delete"):
		frappe.throw(_("Not permitted to delete Items."), frappe.PermissionError)

	assert_stock_manager()
	from kqs_retail.utils.item_delete import delete_catalog_items as _delete_catalog_items

	return _delete_catalog_items(codes)


@frappe.whitelist()
def list_product_category_sections():
	"""Department sections with nested subgroups and leaf categories from Item Group."""
	from kqs_retail.setup.item_group_catalog import ADD_PRODUCT_SECTIONS

	sections = []
	for section in ADD_PRODUCT_SECTIONS:
		parent = section["parent"]
		if not frappe.db.exists("Item Group", parent):
			continue
		if section.get("leaf") or not frappe.db.get_value("Item Group", parent, "is_group"):
			subgroups = _leaf_only_category(parent)
		else:
			subgroups = _item_group_subgroups(parent)
		sections.append(
			{
				"key": section["key"],
				"title": _(section["title"]),
				"column": section["column"],
				"order": section["order"],
				"parent": parent,
				"subgroups": subgroups,
			}
		)

	return {"sections": sections}


def _leaf_only_category(name: str) -> list[dict]:
	"""Single selectable category (e.g. Unisex) with no subgroups."""
	return [
		{
			"name": name,
			"title": _("Category"),
			"categories": [
				{
					"name": name,
					"item_group_name": name,
					"title": name,
				}
			],
		}
	]


def _item_group_subgroups(department: str) -> list[dict]:
	"""Subgroup folders under a department, each with selectable leaf categories."""
	from kqs_retail.setup.item_group_catalog import KQS_DEPARTMENT_TREE, _subgroup_name

	subgroup_order = list(KQS_DEPARTMENT_TREE.get(department, {}).keys())
	subgroups_by_name = {
		row.name: row
		for row in frappe.get_all(
			"Item Group",
			filters={"parent_item_group": department, "is_group": 1},
			fields=["name", "item_group_name"],
			ignore_permissions=True,
		)
	}

	ordered_subgroups = []
	for title in subgroup_order:
		name = _subgroup_name(department, title)
		if name in subgroups_by_name:
			ordered_subgroups.append(subgroups_by_name[name])
	ordered_names = {row.name for row in ordered_subgroups}
	for row in sorted(subgroups_by_name.values(), key=lambda r: r.name):
		if row.name not in ordered_names:
			ordered_subgroups.append(row)
			ordered_names.add(row.name)

	result = []
	for subgroup in ordered_subgroups:
		categories = frappe.get_all(
			"Item Group",
			filters={"parent_item_group": subgroup.name, "is_group": 0},
			fields=["name", "item_group_name"],
			order_by="name asc",
			ignore_permissions=True,
		)
		if not categories:
			continue
		result.append(
			{
				"name": subgroup.name,
				"title": _category_display_name(subgroup.item_group_name or subgroup.name, department),
				"categories": [
					{
						"name": cat.name,
						"item_group_name": cat.item_group_name or cat.name,
						"title": _category_display_name(cat.item_group_name or cat.name, department),
					}
					for cat in categories
				],
			}
		)

	# Fallback: leaf categories attached directly under the department (legacy trees).
	if not result:
		categories = frappe.get_all(
			"Item Group",
			filters={"parent_item_group": department, "is_group": 0},
			fields=["name", "item_group_name"],
			order_by="name asc",
			ignore_permissions=True,
		)
		if categories:
			result.append(
				{
					"name": department,
					"title": _("Categories"),
					"categories": [
						{
							"name": cat.name,
							"item_group_name": cat.item_group_name or cat.name,
							"title": _category_display_name(cat.item_group_name or cat.name, department),
						}
						for cat in categories
					],
				}
			)

	return result


def _category_display_name(stored_name: str, department: str) -> str:
	prefix = f"{department} — "
	if stored_name.startswith(prefix):
		return stored_name[len(prefix) :]
	return stored_name


@frappe.whitelist()
def list_branches(company: str = ""):
	company = company or get_default_company()
	names = get_kqs_branch_warehouse_names(company)
	if not names:
		return []
	return frappe.get_all(
		"Warehouse",
		filters={"name": ["in", names], "disabled": 0},
		fields=["name", "warehouse_name"],
		order_by="name",
	)


def _parse_item_groups(item_groups: str, item_group: str) -> list[str]:
	"""Return ordered, de-duplicated Item Group names from API args."""
	groups: list[str] = []
	if item_groups:
		raw = json.loads(item_groups) if isinstance(item_groups, str) else item_groups
		if isinstance(raw, list):
			groups = [str(name).strip() for name in raw if str(name).strip()]
	if not groups and item_group and str(item_group).strip():
		groups = [str(item_group).strip()]
	seen: set[str] = set()
	ordered: list[str] = []
	for name in groups:
		if name not in seen:
			seen.add(name)
			ordered.append(name)
	return ordered


def _has_kqs_item_groups_field() -> bool:
	return bool(
		frappe.db.get_value("Custom Field", {"dt": "Item", "fieldname": "kqs_item_groups"}, "name")
	)


def _apply_item_groups(item, item_groups: list[str]):
	"""Primary group on Item.item_group; full list stored when custom field exists."""
	if not item_groups:
		return
	item.item_group = item_groups[0]
	if _has_kqs_item_groups_field():
		item.kqs_item_groups = json.dumps(item_groups)


def _parse_variant_attributes(variant_attributes: str, has_variants: int) -> list[str]:
	if not has_variants:
		return []
	raw = json.loads(variant_attributes) if isinstance(variant_attributes, str) else variant_attributes
	if not raw:
		frappe.throw(_("Select at least one variant attribute."))
	names = []
	for name in raw:
		name = (name or "").strip()
		if not name:
			continue
		if not frappe.db.exists("Item Attribute", name):
			frappe.throw(
				_("Item Attribute {0} does not exist. Add it under Stock → Item Attribute.").format(name)
			)
		names.append(name)
	if not names:
		frappe.throw(_("Select at least one variant attribute."))
	return names


def _validate_matrix_attributes(matrix: list, attr_names: list[str]):
	allowed = _attribute_value_map(attr_names)
	for row in matrix:
		attrs = _row_attributes(row, attr_names)
		for name in attr_names:
			value = (attrs.get(name) or "").strip()
			if not value:
				frappe.throw(_("Each variant row needs a value for {0}.").format(name))
			valid = allowed.get(name, set())
			if value not in valid:
				frappe.throw(
					_("{0} value {1} is not defined on Item Attribute {0}. Add it under Stock → Item Attribute.").format(
						name, value
					)
				)


def _attribute_value_map(attr_names: list[str]) -> dict[str, set[str]]:
	result: dict[str, set[str]] = {}
	for name in attr_names:
		values = frappe.get_all(
			"Item Attribute Value",
			filters={"parent": name, "parenttype": "Item Attribute"},
			pluck="attribute_value",
		)
		result[name] = {(v or "").strip() for v in values if (v or "").strip()}
	return result


def _has_swatch_image_field() -> bool:
	return bool(frappe.get_meta("Item Attribute Value").has_field("kqs_swatch_image"))


def _parse_image_list(raw) -> list[str]:
	if not raw:
		return []
	parsed = json.loads(raw) if isinstance(raw, str) else raw
	if not isinstance(parsed, list):
		return []
	seen = set()
	out = []
	for url in parsed:
		url = (url or "").strip()
		if url and url not in seen:
			seen.add(url)
			out.append(url)
	return out


def _parse_attribute_value_images(raw) -> dict[str, dict[str, str]]:
	if not raw:
		return {}
	parsed = json.loads(raw) if isinstance(raw, str) else raw
	if not isinstance(parsed, dict):
		return {}
	out: dict[str, dict[str, str]] = {}
	for attr, values in parsed.items():
		attr = (attr or "").strip()
		if not attr or not isinstance(values, dict):
			continue
		mapped = {}
		for value, image in values.items():
			value = (value or "").strip()
			image = (image or "").strip()
			if value and image:
				mapped[value] = image
		if mapped:
			out[attr] = mapped
	return out


def _set_item_images(item, main_image: str, gallery: list[str]):
	urls = []
	if main_image:
		urls.append(main_image)
	for url in gallery:
		if url not in urls:
			urls.append(url)
	if not urls:
		return
	item.image = urls[0]
	if not hasattr(item, "item_images"):
		return
	for url in urls:
		item.append("item_images", {"image": url})


def _apply_attribute_swatch_images(attr_images: dict[str, dict[str, str]]):
	if not attr_images or not _has_swatch_image_field():
		return
	for attr_name, value_map in attr_images.items():
		if not frappe.db.exists("Item Attribute", attr_name):
			continue
		doc = frappe.get_doc("Item Attribute", attr_name)
		changed = False
		for row in doc.item_attribute_values:
			image = value_map.get((row.attribute_value or "").strip())
			if image and row.get("kqs_swatch_image") != image:
				row.kqs_swatch_image = image
				changed = True
		if changed:
			doc.save(ignore_permissions=True)


def _variant_image_from_attrs(
	attrs: dict, attr_names: list[str], attr_images: dict[str, dict[str, str]]
) -> str:
	for prefer in ("Color", "Colour"):
		if prefer in attrs:
			image = (attr_images.get(prefer) or {}).get(attrs[prefer])
			if image:
				return image
	for name in attr_names:
		value = attrs.get(name)
		if not value:
			continue
		image = (attr_images.get(name) or {}).get(value)
		if image:
			return image
	return ""


def _resolve_stock_uom(stock_uom: str) -> str:
	uom = (stock_uom or "").strip() or get_default_stock_uom()
	if not frappe.db.exists("UOM", uom):
		frappe.throw(_("UOM {0} does not exist. Select a valid unit under Stock → UOM.").format(uom))
	return uom


def _default_central_warehouse(company: str) -> str:
	central = get_kqs_central_warehouse(company)
	if central and frappe.db.exists("Warehouse", central):
		return central
	return ""


def _ensure_item_attributes(names: list[str]):
	"""Seed/demo helper — creates Size/Color with defaults if missing."""
	defaults = {
		"Size": ["5", "6", "7", "8", "9", "10", "11", "12"],
		"Color": ["Black", "White", "Brown", "Red", "Blue"],
	}
	for attr in names:
		if frappe.db.exists("Item Attribute", attr):
			continue
		values = defaults.get(attr, [])
		frappe.get_doc(
			{
				"doctype": "Item Attribute",
				"attribute_name": attr,
				"item_attribute_values": [
					{"attribute_value": v, "abbr": frappe.utils.get_abbr(v, 4)} for v in values
				],
			}
		).insert(ignore_permissions=True)


def _row_attributes(row: dict, attr_names: list[str] | None = None) -> dict:
	if row.get("attributes"):
		return {k: v for k, v in row["attributes"].items() if v}
	attrs = {}
	if attr_names:
		for name in attr_names:
			key = name.lower().replace(" ", "_")
			if row.get(key):
				attrs[name] = row[key]
		if attrs:
			return attrs
	# Legacy size/color keys
	if row.get("size"):
		attrs["Size"] = row["size"]
	if row.get("color"):
		attrs["Color"] = row["color"]
	return attrs


def _normalize_item_code(code: str) -> str:
	return frappe.scrub(code.strip()).replace("_", "-").upper()


def _default_variant_code(parent_code: str, attrs: dict, attribute_order: list[str]) -> str:
	parts = [parent_code]
	for attr in attribute_order:
		value = attrs.get(attr)
		if value:
			parts.append(_normalize_item_code(str(value)))
	return "-".join(parts)


def _variant_item_name(item_name: str, attrs: dict) -> str:
	label = ", ".join(f"{k}: {v}" for k, v in attrs.items())
	return f"{item_name} ({label})" if label else item_name


def _ensure_new_item_code(item_code: str):
	if frappe.db.exists("Item", item_code):
		frappe.throw(_("Item code {0} already exists.").format(item_code))


def _receipt_stock(item_code: str, warehouse: str, qty: float, rate: float):
	_receipt_stock_batch(
		[{"item_code": item_code, "qty": qty, "rate": rate}],
		warehouse,
	)


def _receipt_stock_batch(lines: list[dict], warehouse: str) -> str | None:
	"""Create and submit one Material Receipt for one or more items. Returns SE name."""
	if not warehouse:
		return None
	items = []
	for line in lines:
		qty = flt(line.get("qty"))
		if qty <= 0:
			continue
		rate = flt(line.get("rate") or 0)
		items.append(
			{
				"item_code": line["item_code"],
				"qty": qty,
				"t_warehouse": warehouse,
				"basic_rate": rate or 1,
			}
		)
	if not items:
		return None
	company = frappe.db.get_value("Warehouse", warehouse, "company")
	se = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Receipt",
			"company": company,
			"posting_date": today(),
			"items": items,
		}
	)
	se.insert(ignore_permissions=True)
	se.submit()
	return se.name


@frappe.whitelist()
def search_products_for_edit(query: str = "", start: int = 0, limit: int = 30):
	"""Search templates and standalone stock items for Edit Product."""
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
					SELECT 1 FROM `tabItem Barcode` ib
					WHERE ib.parent = i.name AND ib.barcode LIKE %(search)s
				)
				OR EXISTS (
					SELECT 1 FROM `tabItem` v
					WHERE v.variant_of = i.name
					  AND (
						v.item_name LIKE %(search)s
						OR v.name LIKE %(search)s
						OR v.item_code LIKE %(search)s
						OR EXISTS (
							SELECT 1 FROM `tabItem Barcode` vb
							WHERE vb.parent = v.name AND vb.barcode LIKE %(search)s
						)
					  )
				)
			)
		"""
		params["search"] = f"%{query}%"

	rows = frappe.db.sql(
		f"""
		SELECT
			i.name AS item_code,
			i.item_name,
			i.image,
			i.item_group,
			i.has_variants,
			i.disabled
		FROM `tabItem` i
		WHERE i.disabled = 0
		  AND i.is_stock_item = 1
		  AND IFNULL(i.variant_of, '') = ''
		  {search_sql}
		ORDER BY i.modified DESC
		LIMIT %(start)s, %(limit)s
		""",
		{**params, "start": start, "limit": limit},
		as_dict=True,
	)
	return {"items": rows}


@frappe.whitelist()
def get_product_for_edit(item_code: str):
	"""Load template or standalone item with variants for Edit Product."""
	assert_stock_manager()
	item_code = cstr(item_code or "").strip()
	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} was not found.").format(item_code or ""))

	template_code = resolve_template_code(item_code)
	template = frappe.get_doc("Item", template_code)
	has_variants = bool(template.has_variants)
	attr_names = [row.attribute for row in (template.attributes or []) if row.attribute]

	item_groups = _item_groups_for_item(template)
	gallery = []
	if hasattr(template, "item_images"):
		gallery = [row.image for row in (template.item_images or []) if row.image]

	variants = []
	if has_variants:
		variant_rows = frappe.get_all(
			"Item",
			filters={"variant_of": template_code, "is_stock_item": 1},
			fields=[
				"name",
				"item_code",
				"item_name",
				"standard_rate",
				"image",
				"disabled",
			],
			order_by="name",
		)
		for row in variant_rows:
			attrs = get_variant_attributes(row.name)
			variants.append(
				{
					"item_code": row.name,
					"sku": row.item_code or row.name,
					"item_name": row.item_name,
					"attributes": attrs,
					"attribute_label": ", ".join(f"{k}: {v}" for k, v in attrs.items()),
					"barcode": _get_item_barcode(row.name),
					"rate": flt(row.standard_rate),
					"image": row.image or "",
					"disabled": cint(row.disabled),
					"qty_by_warehouse": _qty_by_kqs_warehouse(row.name),
				}
			)
	else:
		variants.append(
			{
				"item_code": template.name,
				"sku": template.item_code or template.name,
				"item_name": template.item_name,
				"attributes": {},
				"attribute_label": "",
				"barcode": _get_item_barcode(template.name),
				"rate": flt(template.standard_rate),
				"image": template.image or "",
				"disabled": cint(template.disabled),
				"qty_by_warehouse": _qty_by_kqs_warehouse(template.name),
			}
		)

	attr_defs = []
	if attr_names:
		allowed = _attribute_value_map(attr_names)
		for name in attr_names:
			attr_defs.append({"name": name, "values": sorted(allowed.get(name) or [])})

	existing_combos = [
		{k: v for k, v in (row.get("attributes") or {}).items()}
		for row in variants
		if row.get("attributes")
	]

	return {
		"template": {
			"item_code": template.name,
			"style_code": template.name,
			"item_name": template.item_name,
			"description": template.description or "",
			"item_group": template.item_group,
			"item_groups": item_groups,
			"image": template.image or "",
			"gallery_images": gallery,
			"standard_rate": flt(template.standard_rate),
			"stock_uom": template.stock_uom or get_default_stock_uom(),
			"has_variants": has_variants,
			"disabled": cint(template.disabled),
			"attributes": attr_names,
		},
		"attribute_defs": attr_defs,
		"variants": variants,
		"existing_combos": existing_combos,
	}


@frappe.whitelist()
def update_product(
	template: str,
	item_name: str = "",
	description: str = "",
	item_group: str = "",
	item_groups: str = "",
	product_image: str = "",
	gallery_images: str = "",
	standard_rate: float | None = None,
	stock_uom: str = "",
	disabled: int | None = None,
):
	"""Update template / standalone fields. Style code is immutable."""
	assert_stock_manager()
	template = cstr(template or "").strip()
	if not template or not frappe.db.exists("Item", template):
		frappe.throw(_("Item {0} was not found.").format(template or ""))

	doc = frappe.get_doc("Item", template)
	if doc.variant_of:
		frappe.throw(_("Edit the template {0}, not a variant SKU.").format(doc.variant_of))

	groups = _parse_item_groups(item_groups, item_group)
	if groups:
		for name in groups:
			if not frappe.db.exists("Item Group", name):
				frappe.throw(_("Category {0} was not found.").format(name))
		_apply_item_groups(doc, groups)

	if item_name is not None and str(item_name).strip():
		doc.item_name = str(item_name).strip()
	if description is not None:
		doc.description = description
	if standard_rate is not None and str(standard_rate) != "":
		doc.standard_rate = flt(standard_rate)
	if stock_uom and str(stock_uom).strip():
		doc.stock_uom = _resolve_stock_uom(stock_uom)
	if disabled is not None and str(disabled) != "":
		doc.disabled = cint(disabled)

	main_image = (product_image or "").strip()
	gallery = _parse_image_list(gallery_images)
	if main_image or gallery:
		if hasattr(doc, "item_images"):
			doc.set("item_images", [])
		_set_item_images(doc, main_image, gallery)
	elif product_image == "" and gallery_images == "[]":
		doc.image = ""
		if hasattr(doc, "item_images"):
			doc.set("item_images", [])

	doc.save(ignore_permissions=True)
	return {"template": doc.name}


@frappe.whitelist()
def update_variant(
	item_code: str,
	barcode: str | None = None,
	rate: float | None = None,
	image: str | None = None,
	disabled: int | None = None,
):
	"""Update mutable fields on an existing variant or standalone SKU."""
	assert_stock_manager()
	item_code = cstr(item_code or "").strip()
	if not item_code or not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} was not found.").format(item_code or ""))

	doc = frappe.get_doc("Item", item_code)
	if doc.has_variants:
		frappe.throw(_("Use update_product for the template {0}.").format(item_code))

	if rate is not None and str(rate) != "":
		doc.standard_rate = flt(rate)
	if image is not None:
		doc.image = (image or "").strip()
	if disabled is not None and str(disabled) != "":
		doc.disabled = cint(disabled)
	if barcode is not None:
		_set_item_barcode(doc, (barcode or "").strip())

	doc.save(ignore_permissions=True)
	return {"item_code": doc.name}


@frappe.whitelist()
def add_variants_to_product(
	template: str,
	variants_json: str,
	receive_warehouse: str = "",
	attribute_value_images: str = "",
):
	"""Add new attribute combinations under an existing template. Attributes immutable on old SKUs."""
	assert_stock_manager()
	from erpnext.controllers.item_variant import create_variant

	template = cstr(template or "").strip()
	if not template or not frappe.db.exists("Item", template):
		frappe.throw(_("Item {0} was not found.").format(template or ""))

	doc = frappe.get_doc("Item", template)
	if doc.variant_of:
		frappe.throw(_("Select the template {0}, not a variant.").format(doc.variant_of))
	if not doc.has_variants:
		frappe.throw(
			_("This item has no variants. Use Add Product to create a new style with variants.")
		)

	attr_names = [row.attribute for row in (doc.attributes or []) if row.attribute]
	if not attr_names:
		frappe.throw(_("Template {0} has no attributes configured.").format(template))

	matrix = json.loads(variants_json) if isinstance(variants_json, str) else variants_json
	if not matrix:
		frappe.throw(_("Add at least one new variant."))

	_validate_matrix_attributes(matrix, attr_names)
	existing = _existing_variant_combo_keys(template, attr_names)
	attr_images = _parse_attribute_value_images(attribute_value_images)
	if attr_images:
		_apply_attribute_swatch_images(attr_images)

	company = get_default_company()
	warehouse = (receive_warehouse or "").strip() or _default_central_warehouse(company)
	if warehouse and not is_kqs_store_warehouse(warehouse, company):
		frappe.throw(_("Select a valid KQS warehouse."))

	created = []
	receipt_lines = []
	for row in matrix:
		attrs = _row_attributes(row, attr_names)
		combo_key = _combo_key(attrs, attr_names)
		if combo_key in existing:
			label = ", ".join(f"{k}: {attrs[k]}" for k in attr_names if attrs.get(k))
			frappe.throw(_("Variant already exists for {0}.").format(label))

		variant = create_variant(doc.name, attrs)
		variant_code = (row.get("sku") or "").strip() or _default_variant_code(
			template, attrs, attr_names
		)
		variant_code = _normalize_item_code(variant_code)
		_ensure_new_item_code(variant_code)
		variant.item_code = variant_code
		variant.item_name = _variant_item_name(doc.item_name or template, attrs)
		variant.standard_rate = flt(row.get("rate") or doc.standard_rate)
		if row.get("barcode"):
			_set_item_barcode(variant, str(row["barcode"]).strip())
		variant_image = (row.get("image") or "").strip() or _variant_image_from_attrs(
			attrs, attr_names, attr_images
		)
		if variant_image:
			variant.image = variant_image
		variant.insert(ignore_permissions=True)
		created.append(variant.name)
		existing.add(combo_key)
		qty = flt(row.get("qty"))
		if qty > 0 and warehouse:
			receipt_lines.append(
				{
					"item_code": variant.name,
					"qty": qty,
					"rate": flt(row.get("rate") or variant.standard_rate or 0),
				}
			)

	stock_entry = None
	if receipt_lines and warehouse:
		stock_entry = _receipt_stock_batch(receipt_lines, warehouse)

	return {"template": template, "variants": created, "stock_entry": stock_entry}


def _item_groups_for_item(item) -> list[str]:
	groups = []
	if _has_kqs_item_groups_field() and getattr(item, "kqs_item_groups", None):
		try:
			parsed = json.loads(item.kqs_item_groups)
			if isinstance(parsed, list):
				groups = [str(g).strip() for g in parsed if str(g).strip()]
		except (TypeError, ValueError, json.JSONDecodeError):
			groups = []
	if not groups and item.item_group:
		groups = [item.item_group]
	return groups


def _get_item_barcode(item_code: str) -> str:
	rows = frappe.get_all(
		"Item Barcode",
		filters={"parent": item_code},
		fields=["barcode"],
		order_by="idx asc",
		limit=1,
	)
	if rows and rows[0].barcode:
		return rows[0].barcode
	# Legacy / create path may set Item.barcode when present
	if frappe.get_meta("Item").has_field("barcode"):
		return frappe.db.get_value("Item", item_code, "barcode") or ""
	return ""


def _set_item_barcode(item, barcode: str):
	barcode = (barcode or "").strip()
	if frappe.get_meta("Item").has_field("barcode"):
		item.barcode = barcode
	if not hasattr(item, "barcodes"):
		return
	item.set("barcodes", [])
	if barcode:
		item.append("barcodes", {"barcode": barcode})


def _qty_by_kqs_warehouse(item_code: str) -> dict[str, float]:
	company = get_default_company()
	try:
		from kqs_retail.utils.warehouses import get_kqs_warehouse_names

		warehouses = get_kqs_warehouse_names(company)
	except Exception:
		warehouses = []
	if not warehouses:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT warehouse, actual_qty
		FROM `tabBin`
		WHERE item_code = %s AND warehouse IN %s AND actual_qty != 0
		""",
		(item_code, warehouses),
		as_dict=True,
	)
	return {row.warehouse: flt(row.actual_qty) for row in rows}


def _combo_key(attrs: dict, attr_names: list[str]) -> tuple:
	return tuple((name, (attrs.get(name) or "").strip()) for name in attr_names)


def _existing_variant_combo_keys(template: str, attr_names: list[str]) -> set[tuple]:
	codes = frappe.get_all("Item", filters={"variant_of": template}, pluck="name")
	keys: set[tuple] = set()
	for code in codes:
		attrs = get_variant_attributes(code)
		keys.add(_combo_key(attrs, attr_names))
	return keys
