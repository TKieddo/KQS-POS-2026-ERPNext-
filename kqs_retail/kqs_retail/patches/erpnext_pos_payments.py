# Copyright (c) 2026, KQS
"""Work around ERPNext 16.x bug when resetting POS Invoice payment modes.

``update_multi_mode_option`` reads ``is_created_using_pos``, which exists on
Sales Invoice only (POS/SI integration). Editing a draft POS order calls
``reset_mode_of_payments`` and raises AttributeError on POS Invoice.

Upstream fix: https://github.com/frappe/erpnext/pull/53636
"""

from __future__ import annotations


def apply() -> None:
	import erpnext.accounts.doctype.sales_invoice.sales_invoice as sales_invoice_module

	if getattr(sales_invoice_module, "_kqs_pos_payments_patch", False):
		return

	original = sales_invoice_module.update_multi_mode_option

	def update_multi_mode_option(doc, pos_profile):
		# Field is not on POS Invoice meta; set instance attr before ERPNext reads it.
		if doc.doctype == "POS Invoice" and "is_created_using_pos" not in doc.__dict__:
			doc.__dict__["is_created_using_pos"] = 0
		return original(doc, pos_profile)

	sales_invoice_module.update_multi_mode_option = update_multi_mode_option
	sales_invoice_module._kqs_pos_payments_patch = True
