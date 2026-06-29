# Copyright (c) 2026, KQS

import frappe


def ensure_product_custom_fields():
	"""Swatch image on Item Attribute Value; multi-category list on Item."""
	_ensure_item_attribute_swatch_field()
	_ensure_item_groups_field()


def _ensure_item_attribute_swatch_field():
	if frappe.db.exists("Custom Field", "Item Attribute Value-kqs_swatch_image"):
		return
	frappe.get_doc(
		{
			"doctype": "Custom Field",
			"dt": "Item Attribute Value",
			"fieldname": "kqs_swatch_image",
			"fieldtype": "Attach Image",
			"label": "Swatch Image",
			"insert_after": "attribute_value",
			"description": "Optional swatch or sample image for this attribute value (e.g. color).",
			"module": "KQS Layby",
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype="Item Attribute Value")


def _ensure_item_groups_field():
	if frappe.db.exists("Custom Field", "Item-kqs_item_groups"):
		return
	frappe.get_doc(
		{
			"doctype": "Custom Field",
			"dt": "Item",
			"fieldname": "kqs_item_groups",
			"fieldtype": "Small Text",
			"label": "KQS Item Groups",
			"insert_after": "item_group",
			"hidden": 1,
			"read_only": 1,
			"description": "JSON list of all categories assigned to this product.",
			"module": "KQS Layby",
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype="Item")
