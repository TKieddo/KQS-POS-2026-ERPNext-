# Copyright (c) 2026, KQS

import frappe


def redirect_cashier_to_pos(bootinfo):
	"""Send KQS Cashier users to Point of Sale after login."""
	from kqs_retail.utils.cashier_security import is_kqs_cashier_only

	if is_kqs_cashier_only():
		bootinfo["home_page"] = "point-of-sale"
		bootinfo["kqs_cashier_pos_only"] = True
		bootinfo["kqs_cashier_allowed_routes"] = [
			["point-of-sale"],
			["Form", "POS Closing Entry"],
			["pos-closing-entry"],
		]


def inject_kqs_retail_settings(bootinfo):
	"""Expose layby/POS policy to Desk and Point of Sale."""
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings_for_boot

	bootinfo["kqs_retail_settings"] = get_kqs_retail_settings_for_boot()
	# POS checkout always requires cashier-entered tender (see setup/pos_payments.py).
	bootinfo["kqs_pos_manual_payment"] = True
