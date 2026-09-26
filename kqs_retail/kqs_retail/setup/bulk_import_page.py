# Copyright (c) 2026, KQS
"""Ensure Bulk Stock Import Page + DocType exist after migrate / deploy."""

from __future__ import annotations

from pathlib import Path

import frappe


def ensure_bulk_import_page() -> None:
	"""Import Page + KQS Stock Import Batch from app files if missing or outdated."""
	app_root = Path(frappe.get_app_path("kqs_retail"))
	paths = [
		app_root
		/ "kqs_layby"
		/ "doctype"
		/ "kqs_stock_import_batch"
		/ "kqs_stock_import_batch.json",
		app_root / "kqs_layby" / "page" / "bulk_stock_import" / "bulk_stock_import.json",
	]

	from frappe.modules.import_file import import_file_by_path

	for path in paths:
		if not path.is_file():
			frappe.log_error(
				title="KQS bulk import sync missing file",
				message=str(path),
			)
			continue
		import_file_by_path(str(path), force=True)

	# Reload JS for the page
	frappe.clear_cache()
