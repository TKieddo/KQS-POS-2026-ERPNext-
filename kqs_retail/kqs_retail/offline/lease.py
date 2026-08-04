# Copyright (c) 2026, KQS
"""Offline lease telemetry per warehouse (non-blocking).

One row per warehouse (autoname = warehouse). Always update-in-place —
never insert a second doc (that caused Duplicate Name on 2nd till).
Never blocks cache pull or sync.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime


LEASE_HOURS = 6


def _expire_stale_leases(warehouse: str | None = None) -> None:
	filters: dict = {"is_active": 1, "expires_at": ("<", now_datetime())}
	if warehouse:
		filters["warehouse"] = warehouse
	for name in frappe.get_all("Warehouse Offline Lease", filters=filters, pluck="name"):
		frappe.db.set_value("Warehouse Offline Lease", name, "is_active", 0)


def _lease_name_for_warehouse(warehouse: str) -> str | None:
	"""Doc name equals warehouse (autoname). Inactive rows still occupy the name."""
	if frappe.db.exists("Warehouse Offline Lease", warehouse):
		return warehouse
	return frappe.db.get_value("Warehouse Offline Lease", {"warehouse": warehouse}, "name")


def acquire_lease(
	warehouse: str,
	pos_profile: str,
	opening_entry: str | None = None,
	user: str | None = None,
) -> dict:
	"""Record last till that opened offline cache (never blocks, never Duplicate Name)."""
	if not warehouse:
		frappe.throw(_("Warehouse is required."))
	if not pos_profile:
		frappe.throw(_("POS Profile is required."))

	user = user or frappe.session.user
	_expire_stale_leases(warehouse)

	now = now_datetime()
	expires = add_to_date(now, hours=LEASE_HOURS)
	existing_name = _lease_name_for_warehouse(warehouse)

	if existing_name:
		doc = frappe.get_doc("Warehouse Offline Lease", existing_name)
		doc.pos_profile = pos_profile
		doc.user = user
		doc.opening_entry = opening_entry or doc.opening_entry
		doc.acquired_at = now
		doc.expires_at = expires
		doc.is_active = 1
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse Offline Lease",
				"warehouse": warehouse,
				"pos_profile": pos_profile,
				"user": user,
				"opening_entry": opening_entry,
				"acquired_at": now,
				"expires_at": expires,
				"is_active": 1,
			}
		)
		doc.insert(ignore_permissions=True)

	return {
		"warehouse": doc.warehouse,
		"pos_profile": doc.pos_profile,
		"user": doc.user,
		"opening_entry": doc.opening_entry,
		"acquired_at": str(doc.acquired_at),
		"expires_at": str(doc.expires_at),
		"is_active": 1,
	}


def release_lease(warehouse: str, user: str | None = None) -> dict:
	_expire_stale_leases(warehouse)
	name = _lease_name_for_warehouse(warehouse)
	if not name:
		return {"released": False, "warehouse": warehouse}
	doc = frappe.get_doc("Warehouse Offline Lease", name)
	if not doc.is_active:
		return {"released": False, "warehouse": warehouse}
	doc.is_active = 0
	doc.save(ignore_permissions=True)
	return {"released": True, "warehouse": warehouse}


def get_active_lease(warehouse: str) -> dict | None:
	_expire_stale_leases(warehouse)
	row = frappe.db.get_value(
		"Warehouse Offline Lease",
		{"warehouse": warehouse, "is_active": 1},
		["warehouse", "pos_profile", "user", "opening_entry", "acquired_at", "expires_at"],
		as_dict=True,
	)
	if not row:
		return None
	return {
		"warehouse": row.warehouse,
		"pos_profile": row.pos_profile,
		"user": row.user,
		"opening_entry": row.opening_entry,
		"acquired_at": str(row.acquired_at),
		"expires_at": str(row.expires_at),
		"is_active": 1,
	}


def assert_lease_allows_push(warehouse: str, user: str | None = None) -> None:
	"""No longer exclusive — any signed-in till may sync offline events for the store."""
	return
