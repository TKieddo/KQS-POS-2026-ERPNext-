# Copyright (c) 2026, KQS and contributors

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class KQSRetailSettings(Document):
	def validate(self):
		if flt(self.minimum_deposit_percent) <= 0 or flt(self.minimum_deposit_percent) > 100:
			frappe.throw(_("Minimum Deposit % must be between 1 and 100."))
		if int(self.maximum_term_days or 0) <= 0:
			frappe.throw(_("Maximum Term (Days) must be greater than zero."))
		if int(self.grace_period_days or 0) < 0:
			frappe.throw(_("Grace Period (Days) cannot be negative."))
		if int(self.early_cancel_full_refund_days or 0) < 0:
			frappe.throw(_("Early Cancel Full Refund (Days) cannot be negative."))
		if flt(self.late_cancel_refund_percent) < 0 or flt(self.late_cancel_refund_percent) > 100:
			frappe.throw(_("Late Cancel Refund % must be between 0 and 100."))
