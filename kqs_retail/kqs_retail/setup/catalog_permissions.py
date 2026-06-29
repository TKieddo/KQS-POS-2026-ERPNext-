# Copyright (c) 2026, KQS
"""Ensure store manager can read and manage catalog metadata for Add Product."""

import frappe


def ensure():
	_ensure_perm("KQS Store Manager", "Item", read=1, write=1, create=1, delete=1)
	_ensure_perm("KQS Store Manager", "Item Group", read=1, write=1, create=1, delete=1)
	_ensure_perm("KQS Store Manager", "Item Attribute", read=1, write=1, create=1, delete=1)
	frappe.db.commit()
	print("Catalog permissions ensured for KQS Store Manager.")


def _ensure_perm(
	role: str,
	doctype: str,
	read: int = 0,
	write: int = 0,
	create: int = 0,
	delete: int = 0,
	submit: int = 0,
):
	existing = frappe.db.get_value(
		"Custom DocPerm",
		{"parent": doctype, "role": role, "permlevel": 0},
		"name",
	)
	if existing:
		frappe.db.set_value(
			"Custom DocPerm",
			existing,
			{
				"read": read,
				"write": write,
				"create": create,
				"delete": delete,
				"submit": submit,
			},
			update_modified=False,
		)
		return
	if frappe.db.exists("DocPerm", {"parent": doctype, "role": role, "permlevel": 0}):
		frappe.get_doc(
			{
				"doctype": "Custom DocPerm",
				"parent": doctype,
				"parenttype": "DocType",
				"parentfield": "permissions",
				"role": role,
				"permlevel": 0,
				"read": read,
				"write": write,
				"create": create,
				"delete": delete,
				"submit": submit,
			}
		).insert(ignore_permissions=True)
		return
	frappe.get_doc(
		{
			"doctype": "Custom DocPerm",
			"parent": doctype,
			"parenttype": "DocType",
			"parentfield": "permissions",
			"role": role,
			"permlevel": 0,
			"read": read,
			"write": write,
			"create": create,
			"delete": delete,
			"submit": submit,
		}
	).insert(ignore_permissions=True)
