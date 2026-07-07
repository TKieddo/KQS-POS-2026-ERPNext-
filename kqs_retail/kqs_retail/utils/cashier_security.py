# Copyright (c) 2026, KQS
"""Helpers for KQS Cashier POS-only access (server-side enforcement)."""

from __future__ import annotations

import frappe

CASHIER_ROLE = "KQS Cashier"

# Desk Page names cashiers may load (Point of Sale uses frappe.desk.desk_page.getpage).
CASHIER_ALLOWED_DESK_PAGES = frozenset({"point-of-sale"})

# Roles that override POS-only mode — these users may use Desk normally.
DESK_OVERRIDE_ROLES = frozenset(
	{
		"Administrator",
		"System Manager",
		"KQS Store Manager",
		"Sales Manager",
		"Stock Manager",
		"Accounts Manager",
	}
)

# Extra ERPNext roles stripped from cashier users on migrate (see cashier_permissions.ensure).
FORBIDDEN_EXTRA_CASHIER_ROLES = frozenset(
	{
		"Sales User",
		"Sales Manager",
		"Stock Manager",
		"Accounts User",
		"Accounts Manager",
		"Item Manager",
		"Purchase User",
		"Purchase Manager",
	}
)


def is_kqs_cashier_only(user: str | None = None) -> bool:
	"""True when user is a till cashier without manager/admin Desk access."""
	user = user or frappe.session.user
	if not user or user == "Guest":
		return False
	roles = set(frappe.get_roles(user))
	if CASHIER_ROLE not in roles:
		return False
	return not bool(roles & DESK_OVERRIDE_ROLES)


def get_cashier_pos_profiles(user: str | None = None) -> list[str]:
	"""POS Profile names assigned via User Permission (empty = use broad POS filter)."""
	user = user or frappe.session.user
	return frappe.get_all(
		"User Permission",
		filters={"user": user, "allow": "POS Profile"},
		pluck="for_value",
	)


def get_cashier_companies(user: str | None = None) -> list[str]:
	user = user or frappe.session.user
	return frappe.get_all(
		"User Permission",
		filters={"user": user, "allow": "Company"},
		pluck="for_value",
	)


def sql_in_list(values: list[str]) -> str:
	if not values:
		return "''"
	return ", ".join(frappe.db.escape(v) for v in values)
