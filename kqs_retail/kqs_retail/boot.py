# Copyright (c) 2026, KQS

import frappe


def ensure_runtime_patches():
	"""Apply POS monkey-patches once per worker (safe if already applied)."""
	from kqs_retail import apply_runtime_patches

	apply_runtime_patches()


def redirect_cashier_to_pos(bootinfo):
	"""Send KQS Cashier users to Point of Sale after login."""
	ensure_runtime_patches()
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
	ensure_runtime_patches()
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings_for_boot

	bootinfo["kqs_retail_settings"] = get_kqs_retail_settings_for_boot()
	# POS checkout always requires cashier-entered tender (see setup/pos_payments.py).
	bootinfo["kqs_pos_manual_payment"] = True


def inject_kqs_branding(bootinfo):
	"""Use KQS logo for Desk app chrome and browser tab favicon."""
	logo = "/assets/kqs_retail/images/kqs-logo.png"
	favicon = "/assets/kqs_retail/images/favicon.png"
	bootinfo["app_logo_url"] = logo
	bootinfo["splash_image"] = logo
	bootinfo["favicon"] = favicon
