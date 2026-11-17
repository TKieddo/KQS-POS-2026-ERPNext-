# Copyright (c) 2026, KQS
"""Business-owner Desk access (not technical System Manager-only).

Owners need full day-to-day Desk control (stock take, invoices, users' tills,
settings) without being stuck as cashiers. Matsebiso is the primary owner.
"""

from __future__ import annotations

import frappe

# Primary business owner(s). Add emails here when new owners join.
OWNER_EMAILS = (
	"matsebiso@kqsfootwear.com",
)

# Roles that unlock ERPNext business modules. System Manager stays so she can
# open Setup / Users / Role Permission Manager without a developer; Script Manager
# is intentionally omitted (server scripts = security risk).
OWNER_ROLES = (
	"System Manager",
	"KQS Store Manager",
	"Stock Manager",
	"Sales Manager",
	"Accounts Manager",
	"Sales User",
	"Stock User",
	"Accounts User",
	"Purchase Manager",
	"Purchase User",
	"Report Manager",
	"Dashboard Manager",
	"Workspace Manager",
)

# Never leave these on an owner account.
REMOVE_ROLES = (
	"KQS Cashier",  # triggers POS-only / role stripping on migrate
	"Script Manager",  # can edit/run server scripts
)


def ensure() -> None:
	"""Apply owner role set + clear cashier module blocks for listed users."""
	for email in OWNER_EMAILS:
		if not frappe.db.exists("User", email):
			print(f"Owner user missing (skip): {email}")
			continue
		_ensure_owner_user(email)
	frappe.db.commit()
	print(f"Business owner Desk roles ensured for {len(OWNER_EMAILS)} user(s).")


def _ensure_owner_user(email: str) -> None:
	user = frappe.get_doc("User", email)
	have = {row.role for row in (user.roles or []) if row.role}
	changed = False

	for role in REMOVE_ROLES:
		if role in have:
			for row in list(user.roles):
				if row.role == role:
					user.remove(row)
					changed = True
			have.discard(role)

	for role in OWNER_ROLES:
		if not frappe.db.exists("Role", role):
			continue
		if role not in have:
			user.append("roles", {"role": role})
			have.add(role)
			changed = True

	# Owners must see Stock / Selling / Accounts sidebars.
	if user.get("block_modules"):
		user.set("block_modules", [])
		changed = True

	# Desk home — not forced to POS.
	if user.meta.get_field("home_page") and user.get("home_page") == "point-of-sale":
		user.home_page = ""
		changed = True

	if changed:
		user.flags.ignore_permissions = True
		user.save()
		print(f"  Updated owner roles: {email}")
	else:
		print(f"  Owner already OK: {email}")
