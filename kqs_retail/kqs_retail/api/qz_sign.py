# Copyright (c) 2026, KQS
"""QZ Tray message signing — stops the Allow / Unknown signature prompt when configured."""

from __future__ import annotations

import base64

import frappe
from frappe import _


def _certificate_pem() -> str:
	return (frappe.conf.get("kqs_qz_certificate") or "").strip()


def _private_key_pem() -> str:
	return (frappe.conf.get("kqs_qz_private_key") or "").strip()


@frappe.whitelist()
def get_certificate() -> str:
	"""Public certificate PEM for QZ Tray (safe to expose to the till browser)."""
	return _certificate_pem()


@frappe.whitelist()
def is_signing_configured() -> dict:
	return {
		"configured": bool(_certificate_pem() and _private_key_pem()),
	}


@frappe.whitelist()
def sign_message(request: str | None = None) -> str:
	"""Return base64 SHA512 signature of the QZ request payload."""
	payload = (request or "").strip()
	if not payload:
		frappe.throw(_("Nothing to sign."))

	key_pem = _private_key_pem()
	if not key_pem or not _certificate_pem():
		frappe.throw(_("QZ signing is not configured on this site."))

	try:
		from cryptography.hazmat.primitives import hashes, serialization
		from cryptography.hazmat.primitives.asymmetric import padding
	except Exception as exc:
		frappe.throw(_("cryptography package is required for QZ signing: {0}").format(exc))

	try:
		key = serialization.load_pem_private_key(key_pem.encode("utf-8"), password=None)
		signature = key.sign(
			payload.encode("utf-8"),
			padding.PKCS1v15(),
			hashes.SHA512(),
		)
	except Exception as exc:
		frappe.log_error(title="QZ sign_message failed")
		frappe.throw(_("Could not sign QZ request: {0}").format(exc))

	return base64.b64encode(signature).decode("ascii")
