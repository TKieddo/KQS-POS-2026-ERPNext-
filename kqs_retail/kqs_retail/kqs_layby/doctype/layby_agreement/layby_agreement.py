# Copyright (c) 2026, KQS and contributors

from datetime import timedelta

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, flt, getdate, nowdate, today

from kqs_retail.kqs_layby.settings import get_layby_settings
from kqs_retail.kqs_layby.stock_reservation import create_reservation, release_reservation


class LaybyAgreement(Document):
	def validate(self):
		self._calculate_amounts()
		self._validate_items()
		self._set_due_date()

	def before_submit(self):
		if flt(self.deposit_amount) <= 0:
			frappe.throw(_("Deposit amount must be greater than zero before submitting."))
		if flt(self.paid_amount) < flt(self.deposit_amount):
			frappe.throw(
				_("Paid amount ({0}) must be at least the deposit ({1}).").format(
					self.paid_amount, self.deposit_amount
				)
			)

	def on_submit(self):
		self.db_set("status", "Active")
		if not self.stock_reservation:
			reservation = create_reservation(self)
			if reservation:
				self.db_set("stock_reservation", reservation.name)
		self._try_complete()

	def on_cancel(self):
		release_reservation(self.stock_reservation)
		self.db_set("status", "Cancelled")

	def _calculate_amounts(self):
		settings = get_layby_settings()
		min_deposit_percent = settings["minimum_deposit_percent"]
		if not self.deposit_percent:
			self.deposit_percent = min_deposit_percent
		elif flt(self.deposit_percent) < flt(min_deposit_percent):
			frappe.throw(
				_("Deposit % must be at least {0}% (KQS Retail Settings).").format(min_deposit_percent)
			)

		total = 0
		for row in self.items:
			row.amount = flt(row.qty) * flt(row.rate)
			total += row.amount
		self.total_amount = total
		self.deposit_amount = flt(self.total_amount) * flt(self.deposit_percent) / 100
		self.balance_amount = flt(self.total_amount) - flt(self.paid_amount)

	def _validate_items(self):
		if not self.items:
			frappe.throw(_("Add at least one item."))

	def _set_due_date(self):
		if not self.due_date:
			settings = get_layby_settings()
			self.due_date = add_days(self.posting_date or today(), settings["maximum_term_days"])

	def _try_complete(self):
		if flt(self.balance_amount) <= 0 and self.status == "Active":
			self._complete_layby()

	def _complete_layby(self):
		from kqs_retail.kqs_layby.sales import create_sales_invoice_from_layby

		release_reservation(self.stock_reservation)
		invoice = create_sales_invoice_from_layby(self)
		self.db_set(
			{
				"status": "Completed",
				"sales_invoice": invoice.name,
				"balance_amount": 0,
			}
		)
		frappe.msgprint(_("Layby completed. Sales Invoice {0} created.").format(invoice.name))


def on_submit(doc, method=None):
	# hook entry — logic in class on_submit
	pass


def on_cancel(doc, method=None):
	if doc.stock_reservation:
		release_reservation(doc.stock_reservation)


def update_paid_amount(agreement_name: str, amount: float):
	"""Called when a Layby Payment is submitted."""
	doc = frappe.get_doc("Layby Agreement", agreement_name)
	if doc.docstatus != 1:
		frappe.throw(_("Layby Agreement must be submitted."))
	if doc.status not in ("Active",):
		frappe.throw(_("Cannot record payment on layby with status {0}.").format(doc.status))

	new_paid = flt(doc.paid_amount) + flt(amount)
	new_balance = flt(doc.total_amount) - new_paid
	frappe.db.set_value(
		"Layby Agreement",
		agreement_name,
		{
			"paid_amount": new_paid,
			"balance_amount": new_balance,
		},
		update_modified=True,
	)

	if flt(new_balance) <= 0:
		doc = frappe.get_doc("Layby Agreement", agreement_name)
		doc._complete_layby()
