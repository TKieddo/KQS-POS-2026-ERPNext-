# Copyright (c) 2026, KQS and contributors

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from kqs_retail.kqs_layby.doctype.layby_agreement.layby_agreement import update_paid_amount


class LaybyPayment(Document):
	def validate(self):
		if flt(self.amount) <= 0:
			frappe.throw(_("Payment amount must be positive."))
		if self.flags.get("skip_balance_update"):
			return
		agreement = frappe.get_doc("Layby Agreement", self.layby_agreement)
		if flt(self.amount) > flt(agreement.balance_amount):
			frappe.throw(
				_("Payment ({0}) exceeds balance ({1}).").format(self.amount, agreement.balance_amount)
			)

	def on_submit(self):
		if self.flags.get("skip_balance_update"):
			return
		update_paid_amount(self.layby_agreement, self.amount)


def on_submit(doc, method=None):
	pass
