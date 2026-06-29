# Copyright (c) 2026, KQS

import frappe
from frappe.utils import add_days, today

from kqs_retail.kqs_layby.settings import get_layby_settings


def check_overdue_laybys():
	"""Daily job: mark laybys past due_date + grace as candidates for forfeit review."""
	settings = get_layby_settings()
	cutoff = add_days(today(), -settings["grace_period_days"])
	overdue = frappe.get_all(
		"Layby Agreement",
		filters={
			"docstatus": 1,
			"status": "Active",
			"due_date": ["<", cutoff],
			"balance_amount": [">", 0],
		},
		fields=["name", "customer_name", "balance_amount", "due_date"],
	)
	for row in overdue:
		frappe.logger("kqs_retail").info(
			"Layby overdue for review: %s customer=%s balance=%s",
			row.name,
			row.customer_name,
			row.balance_amount,
		)
	# v2: auto-forfeit or notify manager
