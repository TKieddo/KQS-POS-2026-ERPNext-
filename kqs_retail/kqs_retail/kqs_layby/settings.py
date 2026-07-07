# Copyright (c) 2026, KQS

from __future__ import annotations

import frappe
from frappe.utils import cint, flt

DEFAULT_KQS_RETAIL_SETTINGS: dict[str, int | float | str] = {
	"layby_enabled_on_pos": 1,
	"minimum_deposit_percent": 20,
	"maximum_term_days": 90,
	"grace_period_days": 7,
	"early_cancel_full_refund_days": 7,
	"late_cancel_refund_percent": 50,
	"return_window_days": 14,
	"receipt_search_window_days": 30,
	"auto_print_layby_receipts": 1,
	"layby_customer_print_format": "",
	"layby_reserve_print_format": "",
	"layby_complete_print_format": "",
	"auto_print_ar_payment_receipts": 1,
	"ar_payment_print_format": "",
}


def get_kqs_retail_settings() -> dict[str, int | float | str]:
	"""Return layby/POS policy from the KQS Retail Settings single, with safe defaults."""
	if not frappe.db.exists("DocType", "KQS Retail Settings"):
		return DEFAULT_KQS_RETAIL_SETTINGS.copy()

	doc = frappe.get_single("KQS Retail Settings")
	return {
		"layby_enabled_on_pos": cint(doc.layby_enabled_on_pos),
		"minimum_deposit_percent": flt(doc.minimum_deposit_percent or DEFAULT_KQS_RETAIL_SETTINGS["minimum_deposit_percent"]),
		"maximum_term_days": cint(doc.maximum_term_days or DEFAULT_KQS_RETAIL_SETTINGS["maximum_term_days"]),
		"grace_period_days": cint(doc.grace_period_days or DEFAULT_KQS_RETAIL_SETTINGS["grace_period_days"]),
		"early_cancel_full_refund_days": cint(
			doc.early_cancel_full_refund_days or DEFAULT_KQS_RETAIL_SETTINGS["early_cancel_full_refund_days"]
		),
		"late_cancel_refund_percent": flt(
			doc.late_cancel_refund_percent or DEFAULT_KQS_RETAIL_SETTINGS["late_cancel_refund_percent"]
		),
		"return_window_days": cint(
			getattr(doc, "return_window_days", None) or DEFAULT_KQS_RETAIL_SETTINGS["return_window_days"]
		),
		"receipt_search_window_days": cint(
			getattr(doc, "receipt_search_window_days", None)
			or DEFAULT_KQS_RETAIL_SETTINGS["receipt_search_window_days"]
		),
		"auto_print_layby_receipts": cint(getattr(doc, "auto_print_layby_receipts", 1)),
		"layby_customer_print_format": getattr(doc, "layby_customer_print_format", None) or "",
		"layby_reserve_print_format": getattr(doc, "layby_reserve_print_format", None) or "",
		"layby_complete_print_format": getattr(doc, "layby_complete_print_format", None) or "",
		"auto_print_ar_payment_receipts": cint(getattr(doc, "auto_print_ar_payment_receipts", 1)),
		"ar_payment_print_format": getattr(doc, "ar_payment_print_format", None) or "",
	}


def get_layby_settings() -> dict[str, int | float | str]:
	"""Alias used by layby modules."""
	return get_kqs_retail_settings()


def get_kqs_retail_settings_for_boot() -> dict[str, int | float | str]:
	"""Subset exposed to POS via frappe.boot."""
	settings = get_kqs_retail_settings()
	return {
		"layby_enabled_on_pos": settings["layby_enabled_on_pos"],
		"minimum_deposit_percent": settings["minimum_deposit_percent"],
		"maximum_term_days": settings["maximum_term_days"],
		"grace_period_days": settings["grace_period_days"],
		"early_cancel_full_refund_days": settings["early_cancel_full_refund_days"],
		"late_cancel_refund_percent": settings["late_cancel_refund_percent"],
		"return_window_days": settings["return_window_days"],
		"receipt_search_window_days": settings["receipt_search_window_days"],
		"auto_print_layby_receipts": settings["auto_print_layby_receipts"],
		"layby_customer_print_format": settings["layby_customer_print_format"],
		"layby_reserve_print_format": settings["layby_reserve_print_format"],
		"layby_complete_print_format": settings["layby_complete_print_format"],
		"auto_print_ar_payment_receipts": settings["auto_print_ar_payment_receipts"],
		"ar_payment_print_format": settings["ar_payment_print_format"],
	}
