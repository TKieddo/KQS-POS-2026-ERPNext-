# Copyright (c) 2026, KQS
"""Restore standard DocPerms stripped by early KQS permission setup.

Older KQS setup inserted Custom DocPerm rows directly. In Frappe, the presence
of any Custom DocPerm makes the standard DocPerms for that doctype be ignored,
so read-only cashier rules (e.g. Company, Warehouse, Mode of Payment) silently
removed create/write from System Manager and every other role — hiding the
"Add"/"Save" buttons in Desk.

This patch drops the Custom DocPerm rows for the affected doctypes so their
standard permissions are restored. The `after_migrate` hooks (catalog / cashier
/ manager `ensure`) then re-layer the KQS rules using `ensure_custom_perm`,
which copies the standard perms first.
"""

from __future__ import annotations

import frappe

from kqs_retail.setup.cashier_permissions import _CASHIER_PERMS
from kqs_retail.setup.manager_permissions import _MANAGER_PERMS

_CATALOG_DOCTYPES = ("Item", "Item Group", "Item Attribute")


def _managed_doctypes() -> list[str]:
	doctypes = {dt for dt, _ in _CASHIER_PERMS}
	doctypes.update(dt for dt, _ in _MANAGER_PERMS)
	doctypes.update(_CATALOG_DOCTYPES)
	doctypes.add("Global Defaults")
	return sorted(doctypes)


def execute() -> None:
	reset = []
	for doctype in _managed_doctypes():
		if not frappe.db.exists("DocType", doctype):
			continue
		if frappe.db.exists("Custom DocPerm", {"parent": doctype}):
			frappe.permissions.reset_perms(doctype)
			reset.append(doctype)
	if reset:
		frappe.clear_cache()
		frappe.db.commit()
		print(f"Restored standard permissions for: {', '.join(reset)}")
	else:
		print("No Custom DocPerms to reset.")
