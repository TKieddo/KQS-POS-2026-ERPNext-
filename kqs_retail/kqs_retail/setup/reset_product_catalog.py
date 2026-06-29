# Copyright (c) 2026, KQS
"""
Remove all catalog items and retail Item Groups for a clean category rebuild.

Keeps ERPNext defaults (All Item Groups, Products subtree). Does not touch
warehouses, POS profiles, users, or company setup.

Run:
  bench --site frontend execute kqs_retail.setup.reset_product_catalog.reset
"""

from __future__ import annotations

import frappe
from frappe import _

from kqs_retail.utils.defaults import get_default_company

# ERPNext default tree under All Item Groups — never delete.
_PROTECTED_TOP_LEVEL_GROUPS = frozenset({"Products"})


def reset(company: str | None = None):
	"""Delete all items and non-default Item Groups for the active company."""
	frappe.set_user("Administrator")
	frappe.flags.mute_emails = True
	company = company or get_default_company()
	if not company:
		frappe.throw(_("No default company configured."))

	print(f"Resetting product catalog for company: {company}")

	stats = {
		"layby_payments": _cancel_and_delete_docs("Layby Payment"),
		"layby_agreements": _purge_layby_agreements(company),
		"sales_invoices": _cancel_and_delete_docs("Sales Invoice", {"company": company}),
		"stock_entries": _cancel_and_delete_docs("Stock Entry", {"company": company}),
		"delivery_notes": _cancel_and_delete_docs("Delivery Note", {"company": company}),
		"items": _delete_all_items(),
		"item_groups": _delete_retail_item_groups(),
	}

	frappe.db.commit()
	print("Product catalog reset complete.")
	for key, count in stats.items():
		print(f"  {key}: {count}")
	return stats


def _cancel_and_delete_docs(doctype: str, filters: dict | None = None) -> int:
	names = frappe.get_all(
		doctype,
		filters=filters or {},
		pluck="name",
		order_by="modified desc",
		limit=10000,
	)
	if not names:
		return 0

	deleted = 0
	for name in names:
		if not frappe.db.exists(doctype, name):
			continue
		doc = frappe.get_doc(doctype, name)
		if doc.docstatus == 1:
			frappe.flags.ignore_links = True
			try:
				doc.cancel()
			finally:
				frappe.flags.ignore_links = False
		frappe.delete_doc(doctype, name, force=1, ignore_permissions=True)
		deleted += 1
		if deleted % 25 == 0:
			frappe.db.commit()
	return deleted


def _purge_layby_agreements(company: str) -> int:
	"""Remove layby docs and clear links that block Sales Invoice cancellation."""
	if not frappe.db.table_exists("Layby Agreement"):
		return 0

	names = frappe.get_all("Layby Agreement", filters={"company": company}, pluck="name", limit=10000)
	if not names:
		return 0

	for name in names:
		frappe.db.set_value(
			"Layby Agreement",
			name,
			{"sales_invoice": None, "stock_reservation": None},
			update_modified=False,
		)
	frappe.db.commit()
	return _cancel_and_delete_docs("Layby Agreement", {"company": company})


def _delete_all_items() -> int:
	deleted = 0
	for _pass in range(6):
		names = frappe.get_all(
			"Item",
			fields=["name", "variant_of", "has_variants"],
			order_by="has_variants desc, variant_of desc",
			limit=500,
		)
		if not names:
			break
		for row in names:
			if not frappe.db.exists("Item", row.name):
				continue
			try:
				frappe.delete_doc("Item", row.name, force=1, ignore_permissions=True)
				deleted += 1
			except Exception as exc:
				frappe.log_error(
					title=f"Item delete failed: {row.name}",
					message=frappe.get_traceback(),
				)
				print(f"  Warning: could not delete Item {row.name}: {exc}")
		frappe.db.commit()

	remaining = frappe.db.count("Item")
	if remaining:
		disabled = _disable_remaining_items()
		print(f"  Disabled {disabled} Item(s) that could not be deleted.")
		remaining = frappe.db.count("Item", {"disabled": 0})
		if remaining:
			print(f"  Warning: {remaining} active Item(s) remain (check Error Log).")
	return deleted


def _disable_remaining_items() -> int:
	disabled = 0
	for name in frappe.get_all("Item", filters={"disabled": 0}, pluck="name", limit=10000):
		try:
			frappe.db.set_value("Item", name, "disabled", 1, update_modified=False)
			disabled += 1
		except Exception:
			pass
	frappe.db.commit()
	return disabled


def _delete_retail_item_groups() -> int:
	top_level = frappe.get_all(
		"Item Group",
		filters={"parent_item_group": "All Item Groups"},
		pluck="name",
	)
	deleted = 0
	for name in top_level:
		if name in _PROTECTED_TOP_LEVEL_GROUPS:
			continue
		deleted += _delete_item_group_subtree(name)
	return deleted


def _delete_item_group_subtree(root: str) -> int:
	if not frappe.db.exists("Item Group", root):
		return 0

	rows = frappe.db.sql(
		"""
		SELECT child.name
		FROM `tabItem Group` AS child
		INNER JOIN `tabItem Group` AS parent ON parent.name = %s
		WHERE child.lft >= parent.lft AND child.rgt <= parent.rgt
		ORDER BY child.rgt - child.lft ASC
		""",
		root,
		as_dict=True,
	)

	deleted = 0
	for row in rows:
		name = row.name
		if not frappe.db.exists("Item Group", name):
			continue
		if name in _PROTECTED_TOP_LEVEL_GROUPS:
			continue
		frappe.delete_doc("Item Group", name, force=1, ignore_permissions=True)
		deleted += 1
	return deleted
