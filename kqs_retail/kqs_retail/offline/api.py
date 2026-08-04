# Copyright (c) 2026, KQS
"""Whitelisted offline pull/push APIs for POS."""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from kqs_retail.offline.lease import (
	acquire_lease,
	assert_lease_allows_push,
	get_active_lease,
	release_lease,
)
from kqs_retail.offline.sale import create_sales_invoice_from_offline


def _parse_json(value):
	if value is None or value == "":
		return {}
	if isinstance(value, (dict, list)):
		return value
	return json.loads(value)


def _warehouse_for_profile(pos_profile: str) -> str:
	warehouse = frappe.db.get_value("POS Profile", pos_profile, "warehouse")
	if not warehouse:
		frappe.throw(_("POS Profile {0} has no warehouse.").format(pos_profile))
	return warehouse


def _catalog_for_warehouse(warehouse: str, price_list: str | None = None) -> list[dict]:
	from kqs_retail.kqs_layby.stock_reservation import get_reserved_qty_map

	bins = frappe.get_all(
		"Bin",
		filters={"warehouse": warehouse},
		fields=["item_code", "actual_qty"],
		limit_page_length=5000,
	)
	if not bins:
		return []

	item_codes = [b.item_code for b in bins]
	items = {
		r.name: r
		for r in frappe.get_all(
			"Item",
			filters={"name": ("in", item_codes), "disabled": 0, "is_sales_item": 1},
			fields=["name", "item_name", "image", "item_group", "stock_uom", "standard_rate"],
		)
	}

	rates: dict[str, float] = {}
	if price_list:
		for row in frappe.get_all(
			"Item Price",
			filters={
				"price_list": price_list,
				"item_code": ("in", item_codes),
				"selling": 1,
			},
			fields=["item_code", "price_list_rate"],
		):
			rates[row.item_code] = flt(row.price_list_rate)

	reserved = get_reserved_qty_map(warehouse)
	out = []
	for b in bins:
		item = items.get(b.item_code)
		if not item:
			continue
		actual = flt(b.actual_qty)
		sellable = actual - flt(reserved.get(b.item_code, 0))
		out.append(
			{
				"item_code": b.item_code,
				"item_name": item.item_name,
				"image": item.image,
				"item_group": item.item_group,
				"stock_uom": item.stock_uom,
				"warehouse": warehouse,
				"qty": sellable,
				"actual_qty": actual,
				"rate": rates.get(b.item_code, flt(item.standard_rate)),
			}
		)
	return out


def _laybys_for_warehouse(warehouse: str) -> list[dict]:
	rows = frappe.get_all(
		"Layby Agreement",
		filters={
			"docstatus": 1,
			"warehouse": warehouse,
			"status": ("in", ["Active", "Draft"]),
		},
		fields=[
			"name",
			"customer",
			"customer_name",
			"warehouse",
			"company",
			"pos_profile",
			"status",
			"total_amount",
			"paid_amount",
			"balance_amount",
			"deposit_amount",
			"due_date",
			"posting_date",
			"modified",
		],
		limit_page_length=500,
		order_by="modified desc",
	)
	if not rows:
		return []
	names = [r.name for r in rows]
	items_by = {}
	for line in frappe.get_all(
		"Layby Item",
		filters={"parent": ("in", names)},
		fields=["parent", "item_code", "item_name", "qty", "rate", "amount", "idx"],
		order_by="idx asc",
	):
		items_by.setdefault(line.parent, []).append(line)
	out = []
	for r in rows:
		d = dict(r)
		d["items"] = items_by.get(r.name, [])
		out.append(d)
	return out


def _receipts_for_profile(pos_profile: str, limit: int = 200) -> list[dict]:
	limit = min(cint(limit) or 200, 500)
	rows = frappe.get_all(
		"Sales Invoice",
		filters={
			"docstatus": 1,
			"is_pos": 1,
			"pos_profile": pos_profile,
			"is_return": 0,
		},
		fields=[
			"name",
			"customer",
			"customer_name",
			"posting_date",
			"grand_total",
			"outstanding_amount",
			"company",
			"pos_profile",
			"currency",
			"modified",
		],
		limit_page_length=limit,
		order_by="posting_date desc, modified desc",
	)
	if not rows:
		return []
	names = [r.name for r in rows]
	items_by: dict[str, list] = {}
	for line in frappe.get_all(
		"Sales Invoice Item",
		filters={"parent": ("in", names)},
		fields=["name", "parent", "item_code", "item_name", "qty", "rate", "amount", "idx"],
		order_by="idx asc",
		limit_page_length=limit * 40,
	):
		items_by.setdefault(line.parent, []).append(
			{
				"item_row_name": line.name,
				"item_code": line.item_code,
				"item_name": line.item_name,
				"qty": line.qty,
				"returnable_qty": line.qty,
				"rate": line.rate,
				"amount": line.amount,
				"selected": 0,
				"return_qty": 0,
			}
		)
	out = []
	for r in rows:
		d = dict(r)
		d["doctype"] = "Sales Invoice"
		d["items"] = items_by.get(r.name, [])
		out.append(d)
	return out



def _payment_modes(pos_profile: str) -> list[str]:
	rows = frappe.get_all(
		"POS Payment Method",
		filters={"parent": pos_profile},
		fields=["mode_of_payment"],
		order_by="idx asc",
	)
	return [r.mode_of_payment for r in rows if r.mode_of_payment]


def _settings_snapshot() -> dict:
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings_for_boot

	return get_kqs_retail_settings_for_boot()


@frappe.whitelist(allow_guest=False)
def ping_offline() -> dict:
	"""Lightweight reachability check for the till network banner."""
	return {"ok": 1, "user": frappe.session.user, "time": str(frappe.utils.now_datetime())}


@frappe.whitelist(allow_guest=False)
def pull_offline_bundle(warehouse: str = "", pos_profile: str = "") -> dict:
	"""Snapshot catalog, laybys, receipts, MOPs, and settings for IndexedDB."""
	if not pos_profile:
		frappe.throw(_("POS Profile is required."))
	warehouse = warehouse or _warehouse_for_profile(pos_profile)
	price_list = frappe.db.get_value("POS Profile", pos_profile, "selling_price_list")
	company = frappe.db.get_value("POS Profile", pos_profile, "company")
	lease = get_active_lease(warehouse)
	return {
		"pulled_at": str(frappe.utils.now_datetime()),
		"warehouse": warehouse,
		"pos_profile": pos_profile,
		"company": company,
		"catalog": _catalog_for_warehouse(warehouse, price_list),
		"laybys": _laybys_for_warehouse(warehouse),
		"receipts": _receipts_for_profile(pos_profile),
		"payment_modes": _payment_modes(pos_profile),
		"settings": _settings_snapshot(),
		"lease": lease,
	}


@frappe.whitelist(allow_guest=False)
def acquire_offline_lease(
	warehouse: str = "",
	pos_profile: str = "",
	opening_entry: str = "",
) -> dict:
	if not pos_profile:
		frappe.throw(_("POS Profile is required."))
	warehouse = warehouse or _warehouse_for_profile(pos_profile)
	return acquire_lease(warehouse, pos_profile, opening_entry or None)


@frappe.whitelist(allow_guest=False)
def release_offline_lease(warehouse: str = "", pos_profile: str = "") -> dict:
	warehouse = warehouse or (_warehouse_for_profile(pos_profile) if pos_profile else "")
	if not warehouse:
		frappe.throw(_("Warehouse is required."))
	return release_lease(warehouse)


def _result_from_log(log) -> dict:
	return {
		"client_uuid": log.client_uuid,
		"event_type": log.event_type,
		"status": log.status,
		"linked_doctype": log.linked_doctype,
		"linked_name": log.linked_name,
		"error_message": log.error_message,
		"result": {
			"doctype": log.linked_doctype,
			"name": log.linked_name,
		}
		if log.status == "Success" and log.linked_name
		else None,
	}


def _apply_event(event_type: str, payload: dict) -> dict:
	if event_type == "sale":
		return create_sales_invoice_from_offline(payload)

	if event_type == "layby_create":
		from kqs_retail.api import create_layby_from_cart

		doc = create_layby_from_cart(
			customer=payload["customer"],
			company=payload["company"],
			warehouse=payload["warehouse"],
			items=json.dumps(payload.get("items") or []),
			deposit_paid=flt(payload.get("deposit_paid")),
			pos_profile=payload.get("pos_profile") or "",
			deposit_percent=flt(payload.get("deposit_percent") or 20),
			payments=json.dumps(payload.get("payments") or []),
		)
		return {"doctype": "Layby Agreement", "name": doc.get("name"), "status": doc.get("status")}

	if event_type == "layby_payment":
		from kqs_retail.api import record_layby_payment

		res = record_layby_payment(
			layby_agreement=payload["layby_agreement"],
			payments=json.dumps(payload.get("payments") or []),
			amount=payload.get("amount"),
			mode_of_payment=payload.get("mode_of_payment"),
			reference_no=payload.get("reference_no"),
		)
		return {
			"doctype": "Layby Agreement",
			"name": res.get("layby_agreement"),
			"status": res.get("status"),
			"sales_invoice": res.get("sales_invoice"),
			"payment": (res.get("payment") or {}).get("name"),
		}

	if event_type == "layby_cancel":
		from kqs_retail.api.layby_ops import submit_layby_cancel

		return submit_layby_cancel(
			agreement_name=payload["agreement_name"],
			reason=payload.get("reason") or "Customer Request",
			mode_of_payment=payload.get("mode_of_payment"),
			refund_type=payload.get("refund_type") or "account",
		)

	if event_type == "layby_forfeit":
		from kqs_retail.api.layby_ops import submit_layby_forfeit

		return submit_layby_forfeit(
			agreement_name=payload["agreement_name"],
			note=payload.get("note") or "Offline forfeit",
		)

	if event_type == "layby_amend":
		from kqs_retail.api.layby_ops import submit_layby_amend

		return submit_layby_amend(
			agreement_name=payload["agreement_name"],
			line_idx=cint(payload.get("line_idx")),
			new_item_code=payload["new_item_code"],
			manager_approved=cint(payload.get("manager_approved") or 0),
			overpayment_action=payload.get("overpayment_action") or "keep",
			overpayment_mode_of_payment=payload.get("overpayment_mode_of_payment"),
			note=payload.get("note") or "",
		)

	if event_type == "return":
		from kqs_retail.api.returns import submit_return

		return submit_return(
			doctype=payload.get("doctype") or "Sales Invoice",
			invoice_name=payload["invoice_name"],
			customer=payload["customer"],
			items=json.dumps(payload.get("items") or []),
			pos_profile=payload.get("pos_profile") or "",
			refund_type=payload.get("refund_type") or "account",
			mode_of_payment=payload.get("mode_of_payment"),
		)

	if event_type == "ar_payment":
		from kqs_retail.api.customer_account import record_ar_payment

		return record_ar_payment(
			customer=payload["customer"],
			company=payload.get("company"),
			payments=json.dumps(payload.get("payments") or []),
			reference_no=payload.get("reference_no"),
		)

	frappe.throw(_("Unknown offline event type: {0}").format(event_type))


@frappe.whitelist(allow_guest=False)
def retry_failed_offline_events(client_uuids: str | list | None = None) -> dict:
	"""Clear Failed Offline Sync Log rows so the till can re-push the same client_uuids."""
	uuids = _parse_json(client_uuids) if client_uuids else []
	if not isinstance(uuids, list):
		frappe.throw(_("client_uuids must be a list."))
	cleared = 0
	for client_uuid in uuids:
		if not client_uuid:
			continue
		name = frappe.db.get_value("Offline Sync Log", {"client_uuid": client_uuid}, "name")
		if not name:
			continue
		log = frappe.get_doc("Offline Sync Log", name)
		if log.status != "Failed":
			continue
		frappe.delete_doc("Offline Sync Log", name, ignore_permissions=True, force=True)
		cleared += 1
	frappe.db.commit()
	return {"cleared": cleared}


@frappe.whitelist(allow_guest=False)
def push_offline_event(
	client_uuid: str,
	event_type: str,
	payload: str | dict = None,
	force_retry: int = 0,
) -> dict:
	"""Idempotent apply of one outbox event. Retries return the prior Success/Failed result.

	Pass force_retry=1 after retry_failed_offline_events cleared a Failed log.
	"""
	if not client_uuid:
		frappe.throw(_("client_uuid is required."))
	if not event_type:
		frappe.throw(_("event_type is required."))

	existing_name = frappe.db.get_value("Offline Sync Log", {"client_uuid": client_uuid}, "name")
	if existing_name:
		log = frappe.get_doc("Offline Sync Log", existing_name)
		if log.status == "Failed" and cint(force_retry):
			frappe.delete_doc("Offline Sync Log", existing_name, ignore_permissions=True, force=True)
		else:
			return _result_from_log(log)

	data = _parse_json(payload)
	warehouse = data.get("warehouse") or ""
	pos_profile = data.get("pos_profile") or ""
	if not warehouse and pos_profile:
		warehouse = _warehouse_for_profile(pos_profile)

	assert_lease_allows_push(warehouse)

	log = frappe.get_doc(
		{
			"doctype": "Offline Sync Log",
			"client_uuid": client_uuid,
			"event_type": event_type,
			"status": "Pending",
			"warehouse": warehouse or None,
			"pos_profile": pos_profile or None,
			"user": frappe.session.user,
			"payload": json.dumps(data, default=str),
		}
	)
	log.insert(ignore_permissions=True)
	frappe.db.commit()

	try:
		result = _apply_event(event_type, data)
		linked_doctype = result.get("doctype") if isinstance(result, dict) else None
		linked_name = result.get("name") if isinstance(result, dict) else None
		if isinstance(result, dict) and not linked_name:
			linked_name = (
				result.get("agreement")
				or result.get("layby_agreement")
				or result.get("return_invoice")
				or result.get("credit_note")
				or result.get("payment_entry")
				or result.get("name")
			)
			if result.get("layby_agreement") and not linked_doctype:
				linked_doctype = "Layby Agreement"
		log.status = "Success"
		log.linked_doctype = linked_doctype
		log.linked_name = linked_name
		log.save(ignore_permissions=True)
		frappe.db.commit()
		out = _result_from_log(log)
		out["server_result"] = result
		return out
	except Exception as e:
		log.status = "Failed"
		log.error_message = str(e)[:1400]
		log.save(ignore_permissions=True)
		frappe.db.commit()
		frappe.log_error(title=f"Offline sync failed: {client_uuid}", message=frappe.get_traceback())
		return _result_from_log(log)
