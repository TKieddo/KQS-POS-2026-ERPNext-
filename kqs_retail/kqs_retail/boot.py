# Copyright (c) 2026, KQS

import frappe


def redirect_cashier_to_pos(bootinfo):
	"""Send KQS Cashier users to Point of Sale after login."""
	roles = frappe.get_roles()
	if "KQS Cashier" in roles and "System Manager" not in roles:
		bootinfo["home_page"] = "point-of-sale"


def inject_kqs_retail_settings(bootinfo):
	"""Expose layby/POS policy to Desk and Point of Sale."""
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings_for_boot

	bootinfo["kqs_retail_settings"] = get_kqs_retail_settings_for_boot()
