# Copyright (c) 2026, KQS
"""Role permissions so KQS Cashier can open ERPNext Point of Sale."""

import frappe

from kqs_retail.setup.perm_utils import ensure_custom_perm
from kqs_retail.utils.cashier_security import FORBIDDEN_EXTRA_CASHIER_ROLES

ROLE = "KQS Cashier"

# ERPNext Point of Sale desk page. Its standard roles are Sales/Accounts only,
# so KQS Cashier must be granted access to open it.
POS_PAGE = "point-of-sale"

# Hide Desk modules cashiers must not use (catalog, stock, accounting, KQS manager workspace, etc.).
CASHIER_BLOCKED_MODULES = [
	"Accounts",
	"Assets",
	"Automation",
	"Bulk Transaction",
	"Buying",
	"CRM",
	"ERPNext Integrations",
	"ERPNext Settings",
	"HR",
	"Integrations",
	"KQS Layby",
	"Maintenance",
	"Manufacturing",
	"Projects",
	"Quality Management",
	"Regional",
	"Selling",
	"Setup",
	"Stock",
	"Support",
	"Website",
]
_SALES_INVOICE_PERMS = {
	"read": 1,
	"write": 1,
	"create": 1,
	"submit": 1,
	"cancel": 1,
	"print": 1,
	"email": 1,
}

# POS checkout and past orders (returns/exchanges) use Sales Invoice in ERPNext 16+.
_CASHIER_PERMS = [
	("POS Profile", {"read": 1}),
	("Sales Invoice", _SALES_INVOICE_PERMS),
	("POS Invoice", _SALES_INVOICE_PERMS),
	("POS Opening Entry", {"read": 1, "write": 1, "create": 1, "submit": 1}),
	("POS Closing Entry", {"read": 1, "write": 1, "create": 1, "submit": 1}),
	("Customer", {"read": 1, "write": 1, "create": 1, "select": 1}),
	# Selecting a customer at POS loads their linked Address / Contact records.
	("Address", {"read": 1, "write": 1, "create": 1}),
	("Contact", {"read": 1, "write": 1, "create": 1}),
	("Item", {"read": 1, "select": 1}),
	("Warehouse", {"read": 1}),
	("Company", {"read": 1}),
	("Mode of Payment", {"read": 1}),
	# On Account checkout, return refunds, and AR collection all validate the
	# receivable / bank Account (and its Cost Center) behind the mode of payment
	# when the invoice or Payment Entry is submitted. Without read here ERPNext
	# raises "Insufficient Permission for Account" / "... for Cost Center".
	# Read-only: cashiers cannot browse these on Desk (blocked by cashier_desk guard).
	("Account", {"read": 1}),
	("Cost Center", {"read": 1}),
	# Collect on-account balances at POS (Customer Account hub posts Payment Entry Receive).
	("Payment Entry", {"read": 1, "write": 1, "create": 1, "submit": 1}),
	("Price List", {"read": 1}),
	("Bin", {"read": 1}),
	("Customer Group", {"read": 1}),
	("Territory", {"read": 1}),
	("Item Group", {"read": 1}),
	("Stock Settings", {"read": 1}),
	("Selling Settings", {"read": 1}),
	("Global Defaults", {"read": 1}),
	("POS Settings", {"read": 1}),
	("Layby Agreement", {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}),
	("Layby Payment", {"read": 1, "write": 1, "create": 1, "submit": 1}),
	# Loyalty earn/redeem at POS (program setup stays with admin / System Manager).
	("Loyalty Program", {"read": 1}),
	("Loyalty Point Entry", {"read": 1, "write": 1, "create": 1}),
	("Loyalty Program Collection", {"read": 1}),
	# Receipt print (QZ / browser printview loads Print Format HTML).
	("Print Format", {"read": 1}),
	("Letter Head", {"read": 1}),
	("Print Settings", {"read": 1}),
]


def ensure():
	for doctype, flags in _CASHIER_PERMS:
		ensure_custom_perm(ROLE, doctype, **flags)
	_ensure_pos_page_access()
	_fix_cashier_user_permission_scope()
	_strip_forbidden_cashier_roles()
	_apply_cashier_blocked_modules()
	frappe.db.commit()
	print(f"POS permissions ensured for {ROLE}.")


def _ensure_pos_page_access():
	"""Allow KQS Cashier to open the Point of Sale page.

	The standard `point-of-sale` Page only lists Sales/Accounts roles. A Custom
	Role adds KQS Cashier without editing the standard Page, so the grant
	survives `bench migrate` (which re-syncs standard Page roles).
	"""
	if not frappe.db.exists("Page", POS_PAGE):
		return
	name = frappe.db.get_value("Custom Role", {"page": POS_PAGE}, "name")
	if name:
		doc = frappe.get_doc("Custom Role", name)
	else:
		doc = frappe.new_doc("Custom Role")
		doc.page = POS_PAGE
	if any(row.role == ROLE for row in doc.roles):
		return
	doc.append("roles", {"role": ROLE})
	doc.flags.ignore_permissions = True
	doc.save()


def verify_cashier_access(email: str = "cashier@kqs.local") -> None:
	"""Smoke-check POS-related singles for a cashier user."""
	frappe.set_user(email)
	for doctype in (
		"Stock Settings",
		"POS Profile",
		"Selling Settings",
		"Sales Invoice",
		"Payment Entry",
		"Account",
		"Cost Center",
	):
		print(doctype, frappe.has_permission(doctype, "read"), frappe.has_permission(doctype, "submit"))


def _fix_cashier_user_permission_scope():
	"""Warehouse User Permission blocks Stock-module singles (e.g. Stock Settings)."""
	cashiers = frappe.get_all(
		"Has Role",
		filters={"role": ROLE, "parenttype": "User"},
		pluck="parent",
	)
	for user in cashiers:
		for row in frappe.get_all(
			"User Permission",
			filters={"user": user},
			fields=["name", "allow", "apply_to_all_doctypes"],
		):
			if row.allow == "Warehouse":
				frappe.delete_doc("User Permission", row.name, ignore_permissions=True)
				continue
			if row.apply_to_all_doctypes:
				frappe.db.set_value("User Permission", row.name, "apply_to_all_doctypes", 0)


def _strip_forbidden_cashier_roles():
	"""Cashiers must not carry Sales User / manager roles that unlock Desk workspaces."""
	cashiers = frappe.get_all(
		"Has Role",
		filters={"role": ROLE, "parenttype": "User"},
		pluck="parent",
	)
	for email in cashiers:
		user = frappe.get_doc("User", email)
		changed = False
		for row in list(user.roles):
			if row.role in FORBIDDEN_EXTRA_CASHIER_ROLES:
				user.remove(row)
				changed = True
		# ERPNext v16 dropped User.home_page; cashier POS redirect is handled at
		# runtime in boot.redirect_cashier_to_pos, so only set it where it exists.
		if user.meta.get_field("home_page") and user.get("home_page") != "point-of-sale":
			user.home_page = "point-of-sale"
			changed = True
		if changed:
			user.flags.ignore_permissions = True
			user.save()


def _apply_cashier_blocked_modules():
	"""Keep cashiers on POS — no Stock/Selling sidebars on Desk."""
	cashiers = frappe.get_all(
		"Has Role",
		filters={"role": ROLE, "parenttype": "User"},
		pluck="parent",
	)
	for email in cashiers:
		user = frappe.get_doc("User", email)
		user.set("block_modules", [])
		for module in CASHIER_BLOCKED_MODULES:
			user.append("block_modules", {"module": module})
		user.flags.ignore_permissions = True
		user.save()
