# Copyright (c) 2026, KQS

import frappe

from kqs_retail.kqs_layby.settings import DEFAULT_KQS_RETAIL_SETTINGS


def ensure_kqs_retail_settings() -> None:
	"""Hook: create the KQS Retail Settings single with defaults after migrate."""
	if not frappe.db.exists("DocType", "KQS Retail Settings"):
		return

	doc = frappe.get_single("KQS Retail Settings")
	updated = False
	for field, default in DEFAULT_KQS_RETAIL_SETTINGS.items():
		if doc.get(field) in (None, ""):
			doc.set(field, default)
			updated = True

	if updated:
		doc.save(ignore_permissions=True)
