# Copyright (c) 2026, KQS

"""Catalog item deletion — zero stock, purge when safe, else archive to free the SKU."""

from __future__ import annotations

from datetime import datetime

import frappe
from frappe import _
from frappe.utils import cstr, flt

from kqs_retail.utils.defaults import get_default_company


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
	"""Remove products from the catalog and free their SKUs for reuse.

	1. Block if any code is on an Active layby (cancel/complete first).
	2. Zero on-hand qty (Stock Reconciliation) so old stock cannot resurface.
	3. Drop draft stock docs / side tables that safely unblock delete.
	4. Hard-delete when ERPNext allows.
	5. Otherwise archive (rename + disable) so the original SKU is free and
	   sales history stays on the archived code — never cancel customer invoices.
	"""
	if not item_codes:
		frappe.throw(_("Select at least one product to delete."))

	to_delete = expand_catalog_deletion_codes(item_codes)
	if not to_delete:
		frappe.throw(_("No matching products found."))

	_assert_no_active_layby(to_delete)

	company = get_default_company()
	if not company:
		frappe.throw(_("No default company configured."))

	deleted: list[str] = []
	archived: list[dict] = []
	failed: list[dict] = []

	for code in deletion_order(to_delete):
		if not frappe.db.exists("Item", code):
			continue
		try:
			outcome = _purge_or_archive_item(code, company)
			if outcome["status"] == "deleted":
				deleted.append(code)
			elif outcome["status"] == "archived":
				archived.append(
					{
						"item_code": code,
						"archived_as": outcome["archived_as"],
						"message": _(
							"Had sales/stock history — archived as {0}; SKU {1} is free to recreate."
						).format(outcome["archived_as"], code),
					}
				)
			else:
				failed.append({"item_code": code, "message": outcome.get("message") or _("Unknown error")})
		except Exception as exc:
			failed.append({"item_code": code, "message": str(exc)})
			frappe.log_error(
				title=f"KQS item delete failed: {code}",
				message=frappe.get_traceback(),
			)

	frappe.db.commit()
	return {
		"deleted": deleted,
		"archived": archived,
		"disabled": archived,  # back-compat for older UI handlers
		"failed": failed,
		"deleted_count": len(deleted),
		"archived_count": len(archived),
		"disabled_count": len(archived),
		"failed_count": len(failed),
	}


def _assert_no_active_layby(item_codes: set[str]) -> None:
	"""Catalog delete must not orphan reserved stock on open agreements."""
	if not item_codes:
		return
	placeholders = ", ".join(["%s"] * len(item_codes))
	rows = frappe.db.sql(
		f"""
		SELECT DISTINCT li.item_code, la.name AS layby
		FROM `tabLayby Item` li
		INNER JOIN `tabLayby Agreement` la ON la.name = li.parent
		WHERE li.item_code IN ({placeholders})
		  AND la.docstatus = 1
		  AND la.status = 'Active'
		LIMIT 10
		""",
		tuple(item_codes),
		as_dict=True,
	)
	if not rows:
		return
	sample = ", ".join(f"{r.item_code} ({r.layby})" for r in rows[:5])
	frappe.throw(
		_(
			"Cannot delete — product(s) are on active layby: {0}. "
			"Complete or cancel those laybys first."
		).format(sample)
	)


def _purge_or_archive_item(item_code: str, company: str) -> dict:
	_zero_stock_for_item(item_code, company)
	_cleanup_draft_stock_docs(item_code)
	_cleanup_side_tables(item_code)

	try:
		frappe.delete_doc("Item", item_code, force=1, ignore_permissions=True)
		return {"status": "deleted"}
	except Exception as exc:
		if not frappe.db.exists("Item", item_code):
			return {"status": "deleted"}
		# Still linked (sales invoice, submitted stock, layby, …) — archive frees SKU.
		try:
			archived_as = _archive_item(item_code, company)
			return {"status": "archived", "archived_as": archived_as}
		except Exception as archive_exc:
			return {"status": "failed", "message": f"{exc} / {archive_exc}"}


def _zero_stock_for_item(item_code: str, company: str) -> None:
	"""Bring every warehouse Bin to 0 via Stock Reconciliation (auditable SLE)."""
	bins = frappe.get_all(
		"Bin",
		filters={"item_code": item_code, "actual_qty": ["!=", 0]},
		fields=["warehouse", "actual_qty", "valuation_rate"],
	)
	if not bins:
		return

	fallback_rate = (
		flt(frappe.db.get_value("Item", item_code, "valuation_rate"))
		or flt(frappe.db.get_value("Item", item_code, "standard_rate"))
		or 1.0
	)
	rows = []
	for bin_row in bins:
		wh = cstr(bin_row.warehouse).strip()
		if not wh or not frappe.db.exists("Warehouse", wh):
			continue
		rate = flt(bin_row.valuation_rate) or fallback_rate
		rows.append(
			{
				"item_code": item_code,
				"warehouse": wh,
				"qty": 0,
				"valuation_rate": rate,
			}
		)
	if not rows:
		return

	sr = frappe.get_doc(
		{
			"doctype": "Stock Reconciliation",
			"company": company,
			"purpose": "Stock Reconciliation",
			"items": rows,
		}
	)
	sr.insert(ignore_permissions=True)
	sr.submit()


def _cleanup_draft_stock_docs(item_code: str) -> None:
	"""Delete draft stock docs that reference this item so delete can proceed.

	Never cancel submitted multi-item stock vouchers — that would reverse
	unrelated lines. Submitted history is preserved via the archive path.
	"""
	_cleanup_draft_parent("Stock Entry", "Stock Entry Detail", item_code)
	_cleanup_draft_parent("Purchase Receipt", "Purchase Receipt Item", item_code)
	_cleanup_draft_parent("Delivery Note", "Delivery Note Item", item_code)
	_cleanup_draft_parent("Stock Reconciliation", "Stock Reconciliation Item", item_code)


def _cleanup_draft_parent(parent_dt: str, child_dt: str, item_code: str) -> None:
	if not frappe.db.table_exists(parent_dt) or not frappe.db.table_exists(child_dt):
		return
	parents = frappe.db.sql(
		f"""
		SELECT DISTINCT p.name
		FROM `tab{parent_dt}` p
		INNER JOIN `tab{child_dt}` c ON c.parent = p.name
		WHERE c.item_code = %s AND p.docstatus = 0
		""",
		item_code,
		as_dict=True,
	)
	for row in parents:
		if not frappe.db.exists(parent_dt, row.name):
			continue
		try:
			frappe.delete_doc(parent_dt, row.name, force=1, ignore_permissions=True)
		except Exception:
			frappe.log_error(
				title=f"KQS draft cleanup: {parent_dt} {row.name}",
				message=frappe.get_traceback(),
			)


def _cleanup_side_tables(item_code: str) -> None:
	"""Remove non-transactional rows that often block or confuse recreate."""
	for doctype, field in (
		("Item Price", "item_code"),
		("Item Barcode", "parent"),
		("Bin", "item_code"),
	):
		if not frappe.db.table_exists(doctype):
			continue
		try:
			# Only wipe Bin when qty is already 0 (after reconciliation).
			if doctype == "Bin":
				frappe.db.sql(
					"DELETE FROM `tabBin` WHERE item_code=%s AND IFNULL(actual_qty,0)=0",
					item_code,
				)
			elif doctype == "Item Barcode":
				frappe.db.sql("DELETE FROM `tabItem Barcode` WHERE parent=%s", item_code)
			else:
				frappe.db.sql(f"DELETE FROM `tab{doctype}` WHERE {field}=%s", item_code)
		except Exception:
			frappe.log_error(
				title=f"KQS side cleanup: {doctype} {item_code}",
				message=frappe.get_traceback(),
			)


def _archive_item(item_code: str, company: str) -> str:
	"""Rename + disable so the original SKU can be created again with empty stock."""
	_zero_stock_for_item(item_code, company)
	_cleanup_side_tables(item_code)

	archived_as = _next_archive_name(item_code)
	frappe.rename_doc("Item", item_code, archived_as, force=True, merge=False)
	frappe.db.set_value(
		"Item",
		archived_as,
		{"disabled": 1, "item_code": archived_as},
		update_modified=True,
	)
	return archived_as


def _next_archive_name(item_code: str) -> str:
	stamp = datetime.now().strftime("%Y%m%d%H%M%S")
	base = cstr(item_code).strip()
	# Keep within typical Item name limits; prefix marks it as removed from catalog.
	prefix = "DEL-"
	max_len = 140
	room = max_len - len(prefix) - 1 - len(stamp)
	core = base[: max(8, room)]
	candidate = f"{prefix}{core}-{stamp}"
	n = 1
	while frappe.db.exists("Item", candidate):
		n += 1
		candidate = f"{prefix}{core}-{stamp}-{n}"
		if len(candidate) > max_len:
			candidate = candidate[:max_len]
	return candidate
