# Copyright (c) 2026, KQS

"""Safe deletion of catalog items (templates, variants, standalone)."""

from __future__ import annotations

import frappe
from frappe import _


def expand_catalog_deletion_codes(item_codes: list[str]) -> set[str]:
	"""Include all variants when a template is selected."""
	codes: set[str] = set()
	for raw in item_codes:
		code = (raw or "").strip()
		if not code or not frappe.db.exists("Item", code):
			continue
		codes.add(code)
		if frappe.db.get_value("Item", code, "has_variants"):
			for variant in frappe.get_all("Item", filters={"variant_of": code}, pluck="name"):
				codes.add(variant)
	return codes


def deletion_order(codes: set[str]) -> list[str]:
	"""Delete variants before templates."""
	rows = frappe.get_all(
		"Item",
		filters={"name": ["in", list(codes)]},
		fields=["name", "variant_of", "has_variants"],
	)
	rows.sort(
		key=lambda row: (
			0 if (row.variant_of or "").strip() else 1,
			1 if row.has_variants else 0,
			row.name,
		)
	)
	return [row.name for row in rows]


def delete_catalog_items(item_codes: list[str]) -> dict:
	"""Delete items; disable when linked to submitted transactions."""
	if not item_codes:
		frappe.throw(_("Select at least one product to delete."))

	to_delete = expand_catalog_deletion_codes(item_codes)
	if not to_delete:
		frappe.throw(_("No matching products found."))

	deleted: list[str] = []
	disabled: list[dict] = []
	failed: list[dict] = []

	for code in deletion_order(to_delete):
		if not frappe.db.exists("Item", code):
			continue
		try:
			frappe.delete_doc("Item", code, force=1, ignore_permissions=True)
			deleted.append(code)
		except frappe.LinkExistsError:
			try:
				frappe.db.set_value("Item", code, "disabled", 1, update_modified=True)
				disabled.append(
					{
						"item_code": code,
						"message": _(
							"Linked to existing transactions — disabled instead of deleted."
						),
					}
				)
			except Exception as exc:
				failed.append({"item_code": code, "message": str(exc)})
		except Exception as exc:
			failed.append({"item_code": code, "message": str(exc)})

	frappe.db.commit()
	return {
		"deleted": deleted,
		"disabled": disabled,
		"failed": failed,
		"deleted_count": len(deleted),
		"disabled_count": len(disabled),
		"failed_count": len(failed),
	}
