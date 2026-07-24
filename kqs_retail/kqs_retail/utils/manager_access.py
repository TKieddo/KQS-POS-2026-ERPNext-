# Copyright (c) 2026, KQS
"""Role gates for manager stock/catalog whitelist APIs."""

from __future__ import annotations

import frappe
from frappe import _

STOCK_MANAGER_ROLES = ("System Manager", "KQS Store Manager", "Stock Manager")


def is_stock_manager(user: str | None = None) -> bool:
	roles = set(frappe.get_roles(user)) if user else set(frappe.get_roles())
	return bool(roles.intersection(STOCK_MANAGER_ROLES))


def assert_stock_manager() -> None:
	"""Deny cashiers and other non-manager roles from stock/catalog mutate APIs."""
	if is_stock_manager():
		return
	frappe.throw(_("Not permitted."), frappe.PermissionError)
