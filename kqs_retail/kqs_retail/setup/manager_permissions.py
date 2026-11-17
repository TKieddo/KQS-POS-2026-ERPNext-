# Copyright (c) 2026, KQS
"""Desk permissions for KQS Store Manager (loyalty, selling, accounts ops)."""

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
	("Stock Settings", {"read": 1, "write": 1}),
	("Accounts Settings", _SETTINGS_READ),
	("Buying Settings", _SETTINGS_READ),
	("Print Settings", {"read": 1, "write": 1}),
	# Day-to-day owner / store manager Desk ops
	("Customer", {"read": 1, "write": 1, "create": 1, "delete": 0, "export": 1}),
	("Address", {"read": 1, "write": 1, "create": 1}),
	("Contact", {"read": 1, "write": 1, "create": 1}),
	("Sales Invoice", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1, "print": 1}),
	("POS Invoice", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1, "print": 1}),
	("Payment Entry", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
	("POS Profile", {"read": 1, "write": 1}),
	("Mode of Payment", {"read": 1, "write": 1}),
	("Company", {"read": 1}),
	("Account", {"read": 1}),
	("Cost Center", {"read": 1}),
	("Price List", {"read": 1, "write": 1, "create": 1}),
	("Item Price", {"read": 1, "write": 1, "create": 1, "delete": 1}),
	("Pricing Rule", {"read": 1, "write": 1, "create": 1}),
	("Print Format", {"read": 1}),
	("Letter Head", {"read": 1, "write": 1}),
	("Territory", {"read": 1, "write": 1, "create": 1}),
	("Customer Group", {"read": 1, "write": 1, "create": 1}),
	("Brand", {"read": 1, "write": 1, "create": 1}),
	("Supplier", {"read": 1, "write": 1, "create": 1}),
	("Purchase Invoice", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
	("Purchase Order", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
	("Purchase Receipt", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
]


def ensure() -> None:
	for doctype, flags in _MANAGER_PERMS:
		if not frappe.db.exists("DocType", doctype):
			continue
		ensure_custom_perm(ROLE, doctype, **flags)
	ensure_custom_perm("System Manager", "Global Defaults", **_SETTINGS_ROUTE)
	frappe.db.commit()
	print(f"Manager Desk permissions ensured for {ROLE} and System Manager Global Defaults.")
