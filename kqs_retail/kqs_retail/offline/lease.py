# Copyright (c) 2026, KQS
"""Single-till offline lease per warehouse (short outages)."""

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


def acquire_lease(
	warehouse: str,
	pos_profile: str,
	opening_entry: str | None = None,
	user: str | None = None,
) -> dict:
	"""Grant exclusive offline lease for this warehouse to the current till."""
	if not warehouse:
		frappe.throw(_("Warehouse is required."))
	if not pos_profile:
		frappe.throw(_("POS Profile is required."))

	user = user or frappe.session.user
	_expire_stale_leases(warehouse)

	existing = frappe.db.get_value(
		"Warehouse Offline Lease",
		{"warehouse": warehouse, "is_active": 1},
		["name", "user", "pos_profile", "expires_at"],
		as_dict=True,
	)
	if existing and existing.user != user:
		frappe.throw(
			_(
				"Warehouse {0} offline lease is held by {1} until {2}. "
				"Only one till may work offline per store."
			).format(warehouse, existing.user, existing.expires_at)
		)

	now = now_datetime()
	expires = add_to_date(now, hours=LEASE_HOURS)
	if existing:
		doc = frappe.get_doc("Warehouse Offline Lease", existing.name)
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
	user = user or frappe.session.user
	_expire_stale_leases(warehouse)
	name = frappe.db.get_value(
		"Warehouse Offline Lease",
		{"warehouse": warehouse, "is_active": 1},
		"name",
	)
	if not name:
		return {"released": False, "warehouse": warehouse}
	doc = frappe.get_doc("Warehouse Offline Lease", name)
	if doc.user != user and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only the lease holder or a System Manager can release this lease."))
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
	"""Push is allowed for the lease holder, or when no active lease (online sync)."""
	user = user or frappe.session.user
	lease = get_active_lease(warehouse) if warehouse else None
	if lease and lease["user"] != user:
		frappe.throw(
			_("Cannot sync offline events: warehouse {0} lease belongs to {1}.").format(
				warehouse, lease["user"]
			)
		)
