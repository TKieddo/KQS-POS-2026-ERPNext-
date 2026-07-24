# Copyright (c) 2026, KQS

import frappe

STOCK_PAGE_LINKS = (
	("Add Product", "quick-add-product"),
	("Edit Product", "edit-product"),
	("Receive Stock", "receive-stock"),
	("Assign to Branch", "assign-to-branch"),
)


def ensure_stock_sidebar_links():
	"""Add KQS catalog pages under Stock → Setup (after Item)."""
	if not frappe.db.exists("Workspace Sidebar", "Stock"):
		return

	parent = "Stock"
	existing = set(
		frappe.get_all(
			"Workspace Sidebar Item",
			filters={"parent": parent, "link_to": ["in", [link for _, link in STOCK_PAGE_LINKS]]},
			pluck="link_to",
		)
	)
	missing = [(label, link) for label, link in STOCK_PAGE_LINKS if link not in existing]
	if not missing:
		return

	item_idx = frappe.db.get_value(
		"Workspace Sidebar Item",
		{"parent": parent, "link_to": "Item", "link_type": "DocType"},
		"idx",
	)
	if not item_idx:
		return

	frappe.db.sql(
		"""
		UPDATE `tabWorkspace Sidebar Item`
		SET idx = idx + %s
		WHERE parent = %s AND idx > %s
		""",
		(len(missing), parent, item_idx),
	)

	for offset, (label, link_to) in enumerate(missing):
		frappe.get_doc(
			{
				"doctype": "Workspace Sidebar Item",
				"parent": parent,
				"parenttype": "Workspace Sidebar",
				"parentfield": "items",
				"idx": item_idx + offset + 1,
				"label": label,
				"link_to": link_to,
				"link_type": "Page",
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
