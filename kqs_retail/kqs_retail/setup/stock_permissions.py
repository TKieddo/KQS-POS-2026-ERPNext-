# Copyright (c) 2026, KQS
"""Stock DocPerms for KQS Store Manager (Material Receipt / Transfer)."""

from __future__ import annotations

import frappe

from kqs_retail.setup.perm_utils import ensure_custom_perm

ROLE = "KQS Store Manager"

_STOCK_PERMS = [
	("Stock Entry", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 0, "delete": 0}),
	("Warehouse", {"read": 1}),
	("Bin", {"read": 1}),
	("UOM", {"read": 1}),
	("File", {"read": 1, "write": 1, "create": 1}),
	# Managers close any open till (including cashiers who left mid-shift).
	("POS Opening Entry", {"read": 1, "write": 1, "create": 1, "submit": 1}),
	("POS Closing Entry", {"read": 1, "write": 1, "create": 1, "submit": 1}),
]


def ensure() -> None:
	for doctype, flags in _STOCK_PERMS:
		ensure_custom_perm(ROLE, doctype, **flags)
	frappe.db.commit()
	print(f"Stock permissions ensured for {ROLE}.")
