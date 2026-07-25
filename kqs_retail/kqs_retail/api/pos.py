# Copyright (c) 2026, KQS

"""Point of Sale extensions — enrich ERPNext POS item payloads."""

from __future__ import annotations

import frappe
from frappe.utils import get_datetime, getdate

from kqs_retail.utils.items import attach_variant_attributes_to_pos_items


@frappe.whitelist()
def get_items(start, page_length, price_list, item_group, pos_profile, search_term=""):
	"""Wrap ERPNext POS get_items and attach variant attribute badges for each item."""
	from erpnext.selling.page.point_of_sale.point_of_sale import get_items as erpnext_get_items

	result = erpnext_get_items(
		start, page_length, price_list, item_group, pos_profile, search_term
	)
	attach_variant_attributes_to_pos_items(result)
	return result


@frappe.whitelist()
def get_kqs_retail_settings():
	"""Return layby/POS policy for client refresh without full reload."""
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings_for_boot

	return get_kqs_retail_settings_for_boot()


@frappe.whitelist()
def check_opening_entry(user: str | None = None) -> list[dict]:
	"""Open tills for this cashier — match by status=Open (not empty closing link).

	ERPNext's stock filter on empty ``pos_closing_entry`` can miss valid Open
	entries, which wrongly shows the Create Opening dialog after a browser reload
	or when the same cashier signs in on a second phone/tablet.
	"""
	user = user or frappe.session.user
	rows = frappe.db.get_all(
		"POS Opening Entry",
		filters={"user": user, "status": "Open", "docstatus": 1},
		fields=["name", "company", "pos_profile", "period_start_date"],
		order_by="period_start_date desc",
	)
	if rows:
		return rows
	# Fallback: same buggy ERPNext filter some sites still rely on, then keep only Open.
	legacy = frappe.db.get_all(
		"POS Opening Entry",
		filters={"user": user, "pos_closing_entry": ["in", ["", None]], "docstatus": 1},
		fields=["name", "company", "pos_profile", "period_start_date", "status"],
		order_by="period_start_date desc",
	)
	return [r for r in legacy if (r.get("status") or "Open") == "Open"]


def _opening_is_outdated(period_start_date) -> bool:
	if not period_start_date:
		return False
	return get_datetime(period_start_date).date() < getdate()


@frappe.whitelist()
def resolve_pos_opening_entry(user: str | None = None) -> dict:
	"""Decide whether to resume the till, cash up, or create a new opening."""
	from kqs_retail.utils.cashier_security import get_cashier_pos_profiles
	from kqs_retail.utils.manager_access import is_stock_manager

	user = user or frappe.session.user
	rows = check_opening_entry(user)
	if rows:
		opening = rows[0]
		if _opening_is_outdated(opening.period_start_date):
			return {"action": "close", "opening": opening}
		return {"action": "resume", "opening": opening}

	profiles = get_cashier_pos_profiles(user)
	foreign_filters: dict = {"status": "Open", "docstatus": 1, "user": ["!=", user]}
	if profiles:
		foreign_filters["pos_profile"] = ["in", profiles]

	foreign = frappe.get_all(
		"POS Opening Entry",
		filters=foreign_filters,
		fields=["name", "company", "pos_profile", "period_start_date", "user"],
		order_by="period_start_date desc",
		limit_page_length=5,
	)
	if foreign:
		other = foreign[0]
		return {
			"action": "blocked",
			"opening": other,
			"outdated": _opening_is_outdated(other.period_start_date),
			"can_close": bool(is_stock_manager()),
		}

	return {
		"action": "create",
		"opening": None,
		"default_pos_profile": profiles[0] if len(profiles) == 1 else None,
		"other_open_profiles": [
			{"pos_profile": r.pos_profile, "user": r.user, "name": r.name}
			for r in frappe.get_all(
				"POS Opening Entry",
				filters={"status": "Open", "docstatus": 1, "user": ["!=", user]},
				fields=["name", "pos_profile", "user"],
				limit_page_length=10,
			)
		],
	}
