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
	ensure_pos_profile_walk_in_customer()


def resolve_walk_in_customer() -> str | None:
	"""ERPNext / KQS Walk-in customer name for POS Profile default."""
	if frappe.db.exists("Customer", "Walk-in Customer"):
		return "Walk-in Customer"
	return frappe.db.get_value("Customer", {"customer_name": ["like", "%Walk-in%"]}, "name")


def ensure_pos_profile_walk_in_customer() -> None:
	"""Set POS Profile default customer to Walk-in when unset (cashiers skip picking)."""
	walk_in = resolve_walk_in_customer()
	if not walk_in:
		return
	for name in frappe.get_all("POS Profile", pluck="name"):
		if frappe.db.get_value("POS Profile", name, "customer"):
			continue
		frappe.db.set_value("POS Profile", name, "customer", walk_in, update_modified=False)
