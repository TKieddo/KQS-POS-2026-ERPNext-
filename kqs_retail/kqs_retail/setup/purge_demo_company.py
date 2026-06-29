# Copyright (c) 2026, KQS
"""
Remove ERPNext demo company and all linked data. Keeps KQS FOOTWARE.

Run:
  bench --site frontend execute kqs_retail.setup.purge_demo_company.purge
"""

from __future__ import annotations

import time

import frappe
from frappe import _

KEEP_COMPANY = "KQS FOOTWARE"
DEMO_COMPANY_NAMES = ("KQS FOOTWARE (Demo)", "KQS FOOTWARE(demo)")


def purge(demo_company: str | None = None):
	"""Delete demo company transactions, master data, and the Company record."""
	frappe.set_user("Administrator")
	company = demo_company or _find_demo_company()
	if not company:
		print("No demo company found — nothing to purge.")
		return {"deleted": False}

	if company == KEEP_COMPANY:
		frappe.throw(_("Refusing to purge the main company: {0}").format(company))

	print(f"Purging demo company: {company}")
	_purge_transactions(company)
	_delete_company(company)
	_ensure_default_company()
	frappe.db.commit()
	print(f"Done. Active company: {KEEP_COMPANY}")
	return {"deleted": True, "company": company}


def _find_demo_company() -> str | None:
	for name in DEMO_COMPANY_NAMES:
		if frappe.db.exists("Company", name):
			return name

	candidates = frappe.get_all(
		"Company",
		filters={"name": ["like", "%demo%"]},
		pluck="name",
	)
	for candidate in candidates:
		if candidate != KEEP_COMPANY:
			return candidate
	return None


def _purge_transactions(company: str):
	from erpnext.setup.doctype.transaction_deletion_record.transaction_deletion_record import (
		is_deletion_doc_running,
	)

	active = frappe.get_all(
		"Transaction Deletion Record",
		filters={"company": company, "status": ["in", ["Queued", "Running"]]},
		fields=["name"],
		order_by="creation desc",
		limit=1,
	)
	if active:
		tdr_name = active[0]["name"]
		print(f"Waiting for existing deletion job: {tdr_name}")
		_wait_for_tdr(tdr_name)
		return

	completed = frappe.db.exists(
		"Transaction Deletion Record",
		{"company": company, "status": "Completed"},
	)
	if completed:
		print("Transactions already purged for demo company.")
		return

	is_deletion_doc_running(company)

	tdr = frappe.get_doc({"doctype": "Transaction Deletion Record", "company": company})
	tdr.process_in_single_transaction = 1
	tdr.insert(ignore_permissions=True)
	tdr.generate_to_delete_list()
	tdr.reload()
	tdr.submit()
	frappe.db.commit()
	print(f"Transaction deletion completed: {tdr.name} ({tdr.status})")

	if tdr.status != "Completed":
		_wait_for_tdr(tdr.name)


def _wait_for_tdr(tdr_name: str, timeout: int = 600):
	start = time.time()
	while time.time() - start < timeout:
		status = frappe.db.get_value("Transaction Deletion Record", tdr_name, "status")
		print(f"  TDR status: {status}")
		if status == "Completed":
			return
		if status in ("Failed", "Cancelled"):
			error = frappe.db.get_value("Transaction Deletion Record", tdr_name, "error_log")
			frappe.throw(_("Transaction deletion failed ({0}): {1}").format(status, error or ""))
		time.sleep(2)
	frappe.throw(_("Transaction deletion timed out after {0}s").format(timeout))


def _delete_company(company: str):
	if not frappe.db.exists("Company", company):
		return

	frappe.delete_doc("Company", company, force=1, ignore_permissions=True)
	print(f"Deleted company: {company}")


def _ensure_default_company():
	if not frappe.db.exists("Company", KEEP_COMPANY):
		frappe.throw(_("Main company not found: {0}").format(KEEP_COMPANY))

	frappe.db.set_single_value("Global Defaults", "default_company", KEEP_COMPANY)
	frappe.defaults.set_global_default("company", KEEP_COMPANY)
