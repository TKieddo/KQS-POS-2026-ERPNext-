# Copyright (c) 2026, KQS
"""Force manual POS payment entry — server-side guardrails for all ERPNext versions."""

from __future__ import annotations

import frappe


def apply() -> None:
	_patch_pos_invoice_set_missing_values()
	_patch_sales_invoice_set_missing_values()


def _patch_pos_invoice_set_missing_values() -> None:
	import erpnext.accounts.doctype.pos_invoice.pos_invoice as pos_invoice_module

	if getattr(pos_invoice_module, "_kqs_manual_payment_patch", False):
		return

	cls = pos_invoice_module.POSInvoice
	original = cls.set_missing_values

	@frappe.whitelist()
	def set_missing_values(self, for_validate=False):
		result = original(self, for_validate)
		return _force_manual_payment_response(result)

	cls.set_missing_values = set_missing_values
	pos_invoice_module._kqs_manual_payment_patch = True


def _patch_sales_invoice_set_missing_values() -> None:
	import erpnext.accounts.doctype.sales_invoice.sales_invoice as sales_invoice_module

	if getattr(sales_invoice_module, "_kqs_manual_payment_patch", False):
		return

	cls = sales_invoice_module.SalesInvoice
	original = cls.set_missing_values

	@frappe.whitelist()
	def set_missing_values(self, for_validate=False):
		result = original(self, for_validate)
		if not self.is_pos:
			return result
		return _force_manual_payment_response(result)

	cls.set_missing_values = set_missing_values
	sales_invoice_module._kqs_manual_payment_patch = True


def _force_manual_payment_response(result):
	"""POS Invoice set_missing_values may return a dict consumed by the POS UI."""
	if result is None:
		result = {}
	elif not isinstance(result, dict):
		return result
	result["set_default_payment"] = 0
	result["skip_default_payment"] = 1
	return result
