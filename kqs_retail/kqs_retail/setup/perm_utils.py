# Copyright (c) 2026, KQS
"""Shared helpers for layering KQS Custom DocPerm rules on top of standard perms.

Frappe drops a doctype's standard DocPerm rows the moment ANY Custom DocPerm
exists for that doctype — only Custom DocPerm rows are then evaluated. Adding a
role rule directly (as older KQS setup code did) therefore silently stripped
create/write from System Manager and every other role, e.g. leaving Company,
Warehouse and Mode of Payment read-only for admins.

`ensure_custom_perm` copies the standard perms into Custom DocPerm first (once
per doctype), then adds or updates the requested role rule on top.
"""

from __future__ import annotations

import frappe


def ensure_custom_perm(role: str, doctype: str, permlevel: int = 0, **flags: int) -> None:
	"""Add/update a Custom DocPerm rule without discarding standard permissions."""
	# Preserve the doctype's standard DocPerms as Custom DocPerm before we add a
	# role rule; no-op once custom perms already exist for the doctype.
	frappe.permissions.setup_custom_perms(doctype)

	existing = frappe.db.get_value(
		"Custom DocPerm",
		{"parent": doctype, "role": role, "permlevel": permlevel},
		"name",
	)
	if existing:
		frappe.db.set_value("Custom DocPerm", existing, flags, update_modified=False)
		return

	frappe.get_doc(
		{
			"doctype": "Custom DocPerm",
			"parent": doctype,
			"parenttype": "DocType",
			"parentfield": "permissions",
			"role": role,
			"permlevel": permlevel,
			**flags,
		}
	).insert(ignore_permissions=True)
