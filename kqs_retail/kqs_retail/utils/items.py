# Copyright (c) 2026, KQS

"""Item / variant helpers shared by product setup and stock transfer."""

import frappe


def infer_template_code(item_code: str) -> str:
	"""Guess template item code from a variant SKU (e.g. STYLE-9-BLACK → STYLE)."""
	code = (item_code or "").strip()
	if not code:
		return ""
	parts = code.split("-")
	for i in range(len(parts) - 1, 0, -1):
		candidate = "-".join(parts[:i])
		if frappe.db.get_value("Item", candidate, "has_variants"):
			return candidate
	return ""


def resolve_template_code(item_code: str) -> str:
	"""Template code for catalog grouping — variant_of or inferred parent style."""
	item_code = (item_code or "").strip()
	if not item_code:
		return ""
	variant_of = frappe.db.get_value("Item", item_code, "variant_of")
	if variant_of:
		return variant_of
	inferred = infer_template_code(item_code)
	return inferred or item_code


def variant_item_name(parent_name: str, attrs: dict) -> str:
	label = ", ".join(f"{k}: {v}" for k, v in attrs.items())
	return f"{parent_name} ({label})" if label else parent_name


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
	"""Mutate ERPNext POS get_items payload with variant_attributes lists."""
	if not result or not isinstance(result, dict):
		return
	items = result.get("items") or []
	if not items:
		return

	codes = [item.get("item_code") for item in items if item.get("item_code")]
	attr_map = get_variant_attributes_bulk(codes)
	for item in items:
		code = item.get("item_code")
		attrs = attr_map.get(code) or []
		if attrs:
			item["variant_attributes"] = attrs


def ensure_variant_not_orphaned(item_code: str) -> None:
	"""Link variant to template when possible and sync item_name from parent + attributes."""
	item_code = (item_code or "").strip()
	if not item_code or not frappe.db.exists("Item", item_code):
		return

	item = frappe.get_cached_doc("Item", item_code)
	if item.has_variants:
		return

	template_code = (item.variant_of or "").strip()
	if not template_code:
		template_code = infer_template_code(item_code)
		if template_code:
			frappe.db.set_value("Item", item_code, "variant_of", template_code, update_modified=False)
			item.variant_of = template_code

	if not template_code:
		return

	template = frappe.get_cached_doc("Item", template_code)
	attrs = get_variant_attributes(item_code)
	if not attrs:
		return

	new_name = variant_item_name(template.item_name or template_code, attrs)
	if (item.item_name or "").strip() != new_name:
		frappe.db.set_value("Item", item_code, "item_name", new_name, update_modified=False)
