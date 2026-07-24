# Copyright (c) 2026, KQS
"""Install KQS 80mm thermal receipt Print Formats after migrate."""

from __future__ import annotations

from pathlib import Path

import frappe

MODULE = "KQS Layby"
PRINT_DIR = Path(__file__).resolve().parent.parent / "print_format"

# Winner layout for till sales (user-selected).
SALE_COLUMNS = "KQS Receipt Columns"
SALE_COLUMNS_SI = "KQS Receipt Columns (SI)"
LAYBY_CUSTOMER = "KQS Layby Customer"
LAYBY_RESERVE = "KQS Layby Reserve"
ACCOUNT_PAYMENT = "KQS Account Payment"

# (name, doc_type, html file)
FORMATS = (
	("KQS Receipt Classic", "POS Invoice", "kqs_receipt_classic.html"),
	("KQS Receipt Classic (SI)", "Sales Invoice", "kqs_receipt_classic.html"),
	(SALE_COLUMNS, "POS Invoice", "kqs_receipt_columns.html"),
	(SALE_COLUMNS_SI, "Sales Invoice", "kqs_receipt_columns.html"),
	("KQS Receipt Hybrid", "POS Invoice", "kqs_receipt_hybrid.html"),
	("KQS Receipt Hybrid (SI)", "Sales Invoice", "kqs_receipt_hybrid.html"),
	(LAYBY_CUSTOMER, "Layby Agreement", "kqs_layby_customer.html"),
	(LAYBY_RESERVE, "Layby Agreement", "kqs_layby_reserve.html"),
	(ACCOUNT_PAYMENT, "Payment Entry", "kqs_account_payment.html"),
)


def ensure_receipt_print_formats() -> None:
	"""Upsert thermal print formats and link Columns defaults in settings / POS."""
	if not frappe.db.exists("DocType", "Print Format"):
		return

	css = _read("thermal_shared.css")
	macros = _read("_macros.html")

	for name, doc_type, html_file in FORMATS:
		if doc_type != "POS Invoice" and doc_type != "Sales Invoice":
			if not frappe.db.exists("DocType", doc_type):
				continue
		body = _read(html_file)
		_upsert_print_format(name, doc_type, f"{macros}\n{body}", css)

	_link_default_settings()
	_set_pos_profile_columns_format()
	frappe.clear_cache()


def _link_default_settings() -> None:
	"""Point layby / AR settings at Columns-style KQS formats."""
	if not frappe.db.exists("DocType", "KQS Retail Settings"):
		return
	doc = frappe.get_single("KQS Retail Settings")
	updated = False
	defaults = {
		"layby_customer_print_format": LAYBY_CUSTOMER,
		"layby_reserve_print_format": LAYBY_RESERVE,
		"layby_complete_print_format": SALE_COLUMNS_SI,
		"ar_payment_print_format": ACCOUNT_PAYMENT,
	}
	for field, value in defaults.items():
		if doc.get(field) != value and frappe.db.exists("Print Format", value):
			doc.set(field, value)
			updated = True
	if updated:
		doc.save(ignore_permissions=True)


def _set_pos_profile_columns_format() -> None:
	"""Point tills at Columns (chosen till layout)."""
	if not frappe.db.exists("Print Format", SALE_COLUMNS):
		return
	for name in frappe.get_all("POS Profile", pluck="name"):
		frappe.db.set_value("POS Profile", name, "print_format", SALE_COLUMNS, update_modified=False)


def _read(filename: str) -> str:
	path = PRINT_DIR / filename
	if not path.is_file():
		frappe.throw(f"Missing receipt template: {path}")
	return path.read_text(encoding="utf-8")


def _upsert_print_format(name: str, doc_type: str, html: str, css: str) -> None:
	values = {
		"doc_type": doc_type,
		"module": MODULE,
		"standard": "No",
		"custom_format": 1,
		"disabled": 0,
		"print_format_type": "Jinja",
		"raw_printing": 0,
		"html": html,
		"css": css,
	}
	meta = frappe.get_meta("Print Format")
	if meta.has_field("print_format_for"):
		values["print_format_for"] = "DocType"

	if frappe.db.exists("Print Format", name):
		doc = frappe.get_doc("Print Format", name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": "Print Format", "name": name, **values})
		doc.insert(ignore_permissions=True)
