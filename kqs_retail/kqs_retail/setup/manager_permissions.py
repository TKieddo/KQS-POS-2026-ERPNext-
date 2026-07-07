# Copyright (c) 2026, KQS
"""Desk permissions for KQS Store Manager (loyalty, customer setup)."""

from __future__ import annotations

import frappe

from kqs_retail.setup.perm_utils import ensure_custom_perm

ROLE = "KQS Store Manager"

# ERPNext v16 ships Loyalty Program with System Manager only — managers need access
# to enroll customers and configure programs.
# ERPNext Settings sidebar routes to /desk/global-defaults. That slug is registered
# only for doctypes in boot.user.can_read. Global Defaults is read_only, so users
# with read-only DocPerm land in all_read and the route 404s — write is required.
_SETTINGS_ROUTE = {"read": 1, "write": 1}
_SETTINGS_READ = {"read": 1}
_MANAGER_PERMS = [
	("Loyalty Program", {"read": 1, "write": 1, "create": 1, "delete": 0}),
	("Loyalty Point Entry", {"read": 1, "write": 1, "create": 1, "delete": 0}),
	("Loyalty Program Collection", {"read": 1, "write": 1, "create": 1, "delete": 0}),
	("Layby Agreement", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
	("Layby Payment", {"read": 1, "write": 1, "create": 1, "submit": 1}),
	("Global Defaults", _SETTINGS_ROUTE),
	("Selling Settings", {"read": 1, "write": 1}),
	("POS Settings", {"read": 1, "write": 1}),
	("Stock Settings", _SETTINGS_READ),
	("Accounts Settings", _SETTINGS_READ),
	("Buying Settings", _SETTINGS_READ),
	("Print Settings", _SETTINGS_READ),
]


def ensure() -> None:
	for doctype, flags in _MANAGER_PERMS:
		ensure_custom_perm(ROLE, doctype, **flags)
	ensure_custom_perm("System Manager", "Global Defaults", **_SETTINGS_ROUTE)
	frappe.db.commit()
	print(f"Manager Desk permissions ensured for {ROLE} and System Manager Global Defaults.")
