# Copyright (c) 2026, KQS
"""Shared helpers for layby cancel, amend, and forfeit."""

from __future__ import annotations

import frappe
from frappe import _

MANAGER_ROLES = frozenset({"KQS Store Manager", "System Manager", "Sales Manager"})


def is_manager_user(user: str | None = None) -> bool:
	roles = set(frappe.get_roles(user))
	return bool(roles & MANAGER_ROLES)


def require_manager() -> None:
	if not is_manager_user():
		frappe.throw(_("Store Manager approval is required."), frappe.PermissionError)


def assert_active_layby(doc) -> None:
	if doc.docstatus != 1:
		frappe.throw(_("Layby Agreement must be submitted."))
	if doc.status != "Active":
		frappe.throw(_("Layby {0} is {1} — only Active laybys can be changed.").format(doc.name, doc.status))


def get_layby_agreement(name: str):
	doc = frappe.get_doc("Layby Agreement", name)
	assert_active_layby(doc)
	return doc
