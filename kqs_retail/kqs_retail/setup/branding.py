# Copyright (c) 2026, KQS

"""Set Website Settings favicon / splash so browser tabs show the KQS logo."""

from __future__ import annotations

import frappe

KQS_LOGO = "/assets/kqs_retail/images/kqs-logo.png"
KQS_FAVICON = "/assets/kqs_retail/images/favicon.png"


def ensure_kqs_branding() -> None:
	"""Point Website Settings at the KQS icon (apps tile + browser tab)."""
	if not frappe.db.exists("DocType", "Website Settings"):
		return

	ws = frappe.get_single("Website Settings")
	changed = False
	if getattr(ws, "favicon", None) != KQS_FAVICON:
		ws.favicon = KQS_FAVICON
		changed = True
	if hasattr(ws, "splash_image") and ws.splash_image != KQS_LOGO:
		ws.splash_image = KQS_LOGO
		changed = True
	if hasattr(ws, "app_logo") and ws.app_logo != KQS_LOGO:
		ws.app_logo = KQS_LOGO
		changed = True
	if changed:
		ws.flags.ignore_permissions = True
		ws.save()
		frappe.clear_cache()
