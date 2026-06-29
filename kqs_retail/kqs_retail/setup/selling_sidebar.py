# Copyright (c) 2026, KQS

import frappe

SETTINGS_LABEL = "KQS Retail Settings"
SETTINGS_LINK = "KQS Retail Settings"


def ensure_selling_sidebar_link() -> None:
	"""Add KQS Retail Settings under Selling sidebar near POS Settings."""
	parent = "Selling"
	if not frappe.db.exists("Workspace Sidebar", parent):
		return

	if frappe.db.exists(
		"Workspace Sidebar Item",
		{"parent": parent, "link_to": SETTINGS_LINK, "link_type": "DocType"},
	):
		return

	anchor_idx = frappe.db.get_value(
		"Workspace Sidebar Item",
		{"parent": parent, "link_to": "POS Settings", "link_type": "DocType"},
		"idx",
	)
	if not anchor_idx:
		anchor_idx = frappe.db.get_value(
			"Workspace Sidebar Item",
			{"parent": parent, "link_to": "POS Profile", "link_type": "DocType"},
			"idx",
		)
	if not anchor_idx:
		return

	frappe.db.sql(
		"""
		UPDATE `tabWorkspace Sidebar Item`
		SET idx = idx + 1
		WHERE parent = %s AND idx > %s
		""",
		(parent, anchor_idx),
	)

	frappe.get_doc(
		{
			"doctype": "Workspace Sidebar Item",
			"parent": parent,
			"parenttype": "Workspace Sidebar",
			"parentfield": "items",
			"idx": anchor_idx + 1,
			"label": SETTINGS_LABEL,
			"link_to": SETTINGS_LINK,
			"link_type": "DocType",
			"type": "Link",
			"child": 1,
			"collapsible": 1,
			"indent": 0,
			"keep_closed": 0,
			"show_arrow": 0,
		}
	).insert(ignore_permissions=True)

	frappe.db.set_value("Workspace Sidebar", parent, "modified", frappe.utils.now())
	frappe.clear_cache()
