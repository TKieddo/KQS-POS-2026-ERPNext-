# Copyright (c) 2026, KQS
"""Site defaults for Customer master — retail shoppers are usually individuals."""

import frappe


def ensure_customer_defaults() -> None:
	"""Default Customer Type to Individual (ERPNext stock default is Company)."""
	filters = {
		"doc_type": "Customer",
		"field_name": "customer_type",
		"property": "default",
	}
	existing = frappe.db.get_value("Property Setter", filters, "name")
	if existing:
		if frappe.db.get_value("Property Setter", existing, "value") != "Individual":
			frappe.db.set_value("Property Setter", existing, "value", "Individual")
	else:
		frappe.get_doc(
			{
				"doctype": "Property Setter",
				"doctype_or_field": "DocField",
				"doc_type": "Customer",
				"field_name": "customer_type",
				"property": "default",
				"value": "Individual",
				"property_type": "Text",
			}
		).insert(ignore_permissions=True)

	frappe.clear_cache(doctype="Customer")
