# Copyright (c) 2026, KQS
"""Custom fields on POS Profile for per-branch thermal receipt contact."""

from __future__ import annotations

import frappe

MODULE = "KQS Layby"

# (fieldname, fieldtype, label, options/None, description)
_POS_PROFILE_RECEIPT_FIELDS = (
	(
		"kqs_receipt_section",
		"Section Break",
		"KQS Receipt Contact",
		None,
		"Printed on 80mm sale receipts for this till / store. Leave blank to fall back to Company.",
	),
	(
		"kqs_receipt_address",
		"Small Text",
		"Receipt Address",
		None,
		"Branch address shown under the company name on thermal receipts.",
	),
	(
		"kqs_receipt_phone",
		"Data",
		"Receipt Phone",
		None,
		"Phone number. Used as WhatsApp fallback if WhatsApp is blank. Blank phone → Company phone.",
	),
	(
		"kqs_receipt_facebook",
		"Data",
		"Receipt Facebook",
		None,
		"Facebook page or handle shown with icon under the policy.",
	),
	(
		"kqs_receipt_whatsapp",
		"Data",
		"Receipt WhatsApp",
		None,
		"WhatsApp number shown with icon. Blank → Receipt Phone / Company phone.",
	),
	(
		"kqs_receipt_website",
		"Data",
		"Receipt Website",
		None,
		"Website shown with icon. Blank → Company website.",
	),
)


def ensure_pos_profile_receipt_fields() -> None:
	"""Add per-branch receipt contact fields on POS Profile."""
	if not frappe.db.exists("DocType", "POS Profile"):
		return

	insert_after = "print_format"
	for fieldname, fieldtype, label, options, description in _POS_PROFILE_RECEIPT_FIELDS:
		cf_name = f"POS Profile-{fieldname}"
		if frappe.db.exists("Custom Field", cf_name):
			insert_after = fieldname
			continue

		payload = {
			"doctype": "Custom Field",
			"dt": "POS Profile",
			"fieldname": fieldname,
			"fieldtype": fieldtype,
			"label": label,
			"insert_after": insert_after,
			"description": description,
			"module": MODULE,
		}
		if options:
			payload["options"] = options
		frappe.get_doc(payload).insert(ignore_permissions=True)
		insert_after = fieldname

	frappe.clear_cache(doctype="POS Profile")
