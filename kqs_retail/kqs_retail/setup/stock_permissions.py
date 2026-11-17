# Copyright (c) 2026, KQS
"""Stock DocPerms for KQS Store Manager (receipts, transfers, stock take)."""

from __future__ import annotations

import frappe

from kqs_retail.setup.perm_utils import ensure_custom_perm

ROLE = "KQS Store Manager"

# Stock Reconciliation standard DocPerm is Stock Manager only — Store Managers /
# owners need it to correct over-received qty without System Manager hacks.
_STOCK_PERMS = [
	("Stock Entry", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1, "delete": 0}),
	(
		"Stock Reconciliation",
		{"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1, "delete": 0},
	),
	("Warehouse", {"read": 1, "write": 1, "create": 1}),
	("Bin", {"read": 1}),
	("UOM", {"read": 1, "write": 1, "create": 1}),
	("File", {"read": 1, "write": 1, "create": 1}),
	("Batch", {"read": 1, "write": 1, "create": 1}),
	("Stock Ledger Entry", {"read": 1}),
	("Delivery Note", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
	# Managers close any open till (including cashiers who left mid-shift).
	("POS Opening Entry", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
	("POS Closing Entry", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
]


def ensure() -> None:
	for doctype, flags in _STOCK_PERMS:
		if not frappe.db.exists("DocType", doctype):
			continue
		ensure_custom_perm(ROLE, doctype, **flags)
	# System Manager must also get Stock Reconciliation when custom perms exist
	# (setup_custom_perms only copies Stock Manager from standard DocPerm).
	if frappe.db.exists("DocType", "Stock Reconciliation"):
		ensure_custom_perm(
			"System Manager",
			"Stock Reconciliation",
			read=1,
			write=1,
			create=1,
			submit=1,
			cancel=1,
			delete=1,
		)
	frappe.db.commit()
	print(f"Stock permissions ensured for {ROLE}.")
