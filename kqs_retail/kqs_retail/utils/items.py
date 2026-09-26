# Copyright (c) 2026, KQS

"""Item / variant helpers shared by product setup and stock transfer."""

import frappe
from frappe.utils import cint, cstr, flt


def infer_template_code(item_code: str) -> str:
	"""Guess template from a hyphenated variant SKU (e.g. STYLE-9-BLACK → STYLE).

	Only for orphan repair. Never use this to group catalog rows — style codes
	like ``1234-7`` are valid standalones and must not collapse under ``1234``.
	"""
	code = cstr(item_code or "").strip()
	if not code or "-" not in code:
		return ""
	parts = code.split("-")
	for i in range(len(parts) - 1, 0, -1):
		candidate = "-".join(parts[:i])
		if frappe.db.get_value("Item", candidate, "has_variants"):
			return candidate
	return ""


def resolve_template_code(item_code: str) -> str:
	"""Catalog / edit key: trust ``variant_of``, never hyphen-guess over real items.

	If Item ``1234-7`` exists with empty ``variant_of``, it is its own style
	(template or standalone) — even when ``1234`` also exists as a template.
	"""
	item_code = cstr(item_code or "").strip()
	if not item_code:
		return ""
	row = frappe.db.get_value(
		"Item", item_code, ["variant_of", "has_variants"], as_dict=True
	)
	if not row:
		# Missing Item row — last-resort hyphen guess for legacy callers.
		return infer_template_code(item_code) or item_code
	if row.variant_of:
		return cstr(row.variant_of).strip()
	# Existing item without variant_of = its own catalog key.
	return item_code


def variant_item_name(parent_name: str, attrs: dict) -> str:
	label = ", ".join(f"{k}: {v}" for k, v in attrs.items())
	return f"{parent_name} ({label})" if label else parent_name


def format_receipt_qty(qty) -> str:
	"""Whole quantities as 1, 2, 4 — not 1.0 — to save thermal width."""
	q = flt(qty)
	if abs(q - cint(q)) < 1e-9:
		return str(cint(q))
	return f"{q:g}"


def format_receipt_item_name(item_name: str | None = None, item_code: str | None = None) -> str:
	"""Compact POS line: ``Nike Sneaker (Black, 6)`` — no SKU, no Colour:/Size: labels."""
	code = (item_code or "").strip()
	name = (item_name or code or "").strip()
	if not name:
		return ""

	base = name
	if "(" in name and name.endswith(")"):
		base = name[: name.rfind("(")].strip() or name

	values: list[str] = []
	if code and frappe.db.exists("Item", code):
		rows = frappe.get_all(
			"Item Variant Attribute",
			filters={"parent": code},
			fields=["attribute_value"],
			order_by="idx asc",
		)
		values = [cstr(r.attribute_value).strip() for r in rows if cstr(r.attribute_value).strip()]

	if not values and "(" in name and name.endswith(")"):
		inner = name[name.rfind("(") + 1 : -1]
		for part in inner.split(","):
			part = part.strip()
			if not part:
				continue
			if ":" in part:
				values.append(part.split(":", 1)[1].strip())
			else:
				values.append(part)

	if values:
		return f"{base} ({', '.join(values)})"
	return base


def get_variant_attributes(item_code: str) -> dict[str, str]:
	rows = frappe.get_all(
		"Item Variant Attribute",
		filters={"parent": item_code},
		fields=["attribute", "attribute_value"],
		order_by="idx",
	)
	return {row.attribute: row.attribute_value for row in rows if row.attribute}


def get_variant_attributes_bulk(item_codes: list[str]) -> dict[str, list[dict[str, str]]]:
	"""POS/catalog: attribute badges per variant item, ordered by Item Variant Attribute idx."""
	codes = [code for code in item_codes if code]
	if not codes:
		return {}

	rows = frappe.get_all(
		"Item Variant Attribute",
		filters={"parent": ["in", codes]},
		fields=["parent", "attribute", "attribute_value"],
		order_by="parent asc, idx asc",
	)
	result: dict[str, list[dict[str, str]]] = {}
	for row in rows:
		attr = (row.attribute or "").strip()
		if not attr:
			continue
		result.setdefault(row.parent, []).append(
			{
				"attribute": attr,
				"value": (row.attribute_value or "").strip(),
			}
		)
	return result


def attach_variant_attributes_to_pos_items(result) -> None:
	"""Mutate ERPNext POS get_items payload with variant badges + style code.

	``style_code`` is the template (variant_of) when present, else item_code —
	so the till shows ``12345`` not ``12345-BLACK-8``.
	"""
	if not result or not isinstance(result, dict):
		return
	items = result.get("items") or []
	if not items:
		return

	codes = [item.get("item_code") for item in items if item.get("item_code")]
	attr_map = get_variant_attributes_bulk(codes)
	variant_of_map: dict[str, str] = {}
	if codes:
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", codes]},
			fields=["name", "variant_of"],
		):
			parent = cstr(row.variant_of or "").strip()
			if parent:
				variant_of_map[row.name] = parent

	for item in items:
		code = item.get("item_code")
		attrs = attr_map.get(code) or []
		if attrs:
			item["variant_attributes"] = attrs
		style = variant_of_map.get(code) or cstr(code or "").strip()
		item["style_code"] = style
		if style != code:
			item["variant_of"] = style


def ensure_variant_not_orphaned(item_code: str) -> None:
	"""Link variant to template when possible and sync item_name from parent + attributes."""
	item_code = (item_code or "").strip()
	if not item_code or not frappe.db.exists("Item", item_code):
		return

	item = frappe.get_cached_doc("Item", item_code)
	if item.has_variants:
		return

	template_code = cstr(item.variant_of or "").strip()
	attrs = get_variant_attributes(item_code)
	# Only hyphen-infer when this SKU already has variant attributes — so a
	# standalone style like 1234-7 is never force-linked under template 1234.
	if not template_code and attrs:
		template_code = infer_template_code(item_code)
		if template_code:
			frappe.db.set_value("Item", item_code, "variant_of", template_code, update_modified=False)
			item.variant_of = template_code

	if not template_code or not attrs:
		return

	template = frappe.get_cached_doc("Item", template_code)

	new_name = variant_item_name(template.item_name or template_code, attrs)
	if (item.item_name or "").strip() != new_name:
		frappe.db.set_value("Item", item_code, "item_name", new_name, update_modified=False)
