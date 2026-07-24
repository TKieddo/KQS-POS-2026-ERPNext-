__version__ = "0.1.0"

"""kqs_retail package.

Import must stay side-effect light so Docker/gunicorn can boot even when ERPNext
modules are not ready yet. Runtime patches are applied from boot_session.
"""


def apply_runtime_patches() -> None:
	"""Monkey-patch ERPNext POS payment helpers once per process."""
	try:
		# Ensure whitelisted link-query modules are importable in all workers.
		from kqs_retail.api import stock_transfer as _stock_transfer  # noqa: F401
		from kqs_retail.api import pos as _pos  # noqa: F401
		from kqs_retail.patches.erpnext_pos_payments import apply as _patch_erpnext_pos_payments
		from kqs_retail.patches.pos_manual_payment import apply as _patch_pos_manual_payment

		_patch_erpnext_pos_payments()
		_patch_pos_manual_payment()
	except Exception:
		# Never block app import / container start if a patch cannot apply yet.
		try:
			import frappe

			frappe.logger("kqs_retail").exception("kqs_retail runtime patches failed")
		except Exception:
			pass
