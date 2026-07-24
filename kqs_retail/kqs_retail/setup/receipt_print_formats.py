# Copyright (c) 2026, KQS
"""Install KQS 80mm thermal receipt Print Formats after migrate."""

from __future__ import annotations

from pathlib import Path

import frappe

MODULE = "KQS Layby"
PRINT_DIR = Path(__file__).resolve().parent.parent / "print_format"

# style_key -> (POS Invoice name, Sales Invoice name, html file)
FORMATS = (
	(
		"classic",
		"KQS Receipt Classic",
		"KQS Receipt Classic (SI)",
		"kqs_receipt_classic.html",
	),
	(
		"columns",
		"KQS Receipt Columns",
		"KQS Receipt Columns (SI)",
		"kqs_receipt_columns.html",
	),
	(
		"hybrid",
		"KQS Receipt Hybrid",
		"KQS Receipt Hybrid (SI)",
		"kqs_receipt_hybrid.html",
	),
)


def ensure_receipt_print_formats() -> None:
	"""Upsert Classic / Columns / Hybrid print formats for POS + Sales Invoice."""
	if not frappe.db.exists("DocType", "Print Format"):
		return

	css = _read("thermal_shared.css")
	macros = _read("_macros.html")

	for _key, pos_name, si_name, html_file in FORMATS:
		body = _read(html_file)
		html = f"{macros}\n{body}"
		_upsert_print_format(pos_name, "POS Invoice", html, css)
		_upsert_print_format(si_name, "Sales Invoice", html, css)

	frappe.clear_cache()


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
	# ERPNext v15+ field; ignore if older schema
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
