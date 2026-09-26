# Copyright (c) 2026, KQS

import frappe

from kqs_retail.kqs_layby.settings import DEFAULT_KQS_RETAIL_SETTINGS

# Link fields whose targets may not exist yet during after_migrate ordering.
_PRINT_FORMAT_FIELDS = (
	"layby_customer_print_format",
	"layby_reserve_print_format",
	"layby_complete_print_format",
	"ar_payment_print_format",
	"cashup_print_format",
)


def ensure_kqs_retail_settings() -> None:
	"""Hook: create the KQS Retail Settings single with defaults after migrate."""
	# Always re-import DocType JSON so new sections (e.g. Bulk Import AI) appear after pull.
	try:
		from pathlib import Path

		from frappe.modules.import_file import import_file_by_path

		json_path = (
			Path(frappe.get_app_path("kqs_retail"))
			/ "kqs_layby"
			/ "doctype"
			/ "kqs_retail_settings"
			/ "kqs_retail_settings.json"
		)
		if json_path.is_file():
			import_file_by_path(str(json_path), force=True)
			frappe.clear_cache(doctype="KQS Retail Settings")
	except Exception:
		frappe.log_error(title="KQS Retail Settings DocType sync")

	if not frappe.db.exists("DocType", "KQS Retail Settings"):
		return

	doc = frappe.get_single("KQS Retail Settings")
	updated = False
	for field, default in DEFAULT_KQS_RETAIL_SETTINGS.items():
		if doc.get(field) not in (None, ""):
			continue
		if field in _PRINT_FORMAT_FIELDS and not frappe.db.exists("Print Format", default):
			continue
		doc.set(field, default)
		updated = True

	if updated:
		doc.save(ignore_permissions=True)
