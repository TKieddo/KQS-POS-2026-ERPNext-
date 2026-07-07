__version__ = "0.1.0"

# Load whitelisted link-query helpers at import time so all gunicorn/worker
# processes resolve kqs_retail.api.stock_transfer.* (Assign to Branch page).
from kqs_retail.api import stock_transfer as _stock_transfer  # noqa: F401
from kqs_retail.api import pos as _pos  # noqa: F401
from kqs_retail.patches.erpnext_pos_payments import apply as _patch_erpnext_pos_payments
from kqs_retail.patches.pos_manual_payment import apply as _patch_pos_manual_payment

_patch_erpnext_pos_payments()
_patch_pos_manual_payment()
