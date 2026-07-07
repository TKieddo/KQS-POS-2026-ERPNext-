# Copyright (c) 2026, KQS
"""Resolve KQS hub + branch warehouses from Desk data (no hardcoded store list)."""

from __future__ import annotations

import frappe

from kqs_retail.utils.defaults import get_default_company

# warehouse_name on the central hub row (parent of store branches).
CENTRAL_WAREHOUSE_NAME = "Central"

# Fallback when Central is missing (older demo sites).
LEGACY_WAREHOUSE_SUFFIXES = ("Central", "Store-01", "Store-02")


def get_kqs_central_warehouse(company: str = "") -> str:
	"""Central hub — receives opening stock in Add Product (is_group=0, warehouse_name=Central)."""
	company = company or get_default_company()
	if not company:
		return ""

	central = frappe.db.get_value(
		"Warehouse",
		{"company": company, "warehouse_name": CENTRAL_WAREHOUSE_NAME, "disabled": 0},
		"name",
	)
	if central:
		return central

	abbr = frappe.db.get_value("Company", company, "abbr") or "KQS"
	legacy = f"{CENTRAL_WAREHOUSE_NAME} - {abbr}"
	if frappe.db.get_value("Warehouse", legacy, "company") == company and not frappe.db.get_value(
		"Warehouse", legacy, "disabled"
	):
		return legacy

	legacy_names = _legacy_warehouse_names(company)
	return legacy_names[0] if legacy_names else ""


def get_kqs_branch_warehouse_names(company: str = "") -> list[str]:
	"""Retail store warehouses — children of Central, plus any warehouse linked to a POS profile."""
	company = company or get_default_company()
	if not company:
		return []

	central = get_kqs_central_warehouse(company)
	names: set[str] = set()

	if central:
		for name in frappe.get_all(
			"Warehouse",
			filters={
				"company": company,
				"parent_warehouse": central,
				"is_group": 0,
				"disabled": 0,
			},
			pluck="name",
		):
			if name != central:
				names.add(name)

	for row in frappe.get_all(
		"POS Profile",
		filters={"company": company, "disabled": 0, "warehouse": ["is", "set"]},
		fields=["warehouse"],
	):
		wh = row.warehouse
		if not wh or wh == central:
			continue
		if frappe.db.get_value("Warehouse", wh, "disabled"):
			continue
		if frappe.db.get_value("Warehouse", wh, "company") != company:
			continue
		names.add(wh)

	if names:
		return sorted(names)

	legacy = _legacy_warehouse_names(company)
	if len(legacy) > 1:
		return legacy[1:]
	return []


def get_kqs_warehouse_names(company: str = "") -> list[str]:
	"""Central hub plus all active branch warehouses."""
	company = company or get_default_company()
	central = get_kqs_central_warehouse(company)
	branches = get_kqs_branch_warehouse_names(company)

	if central:
		return [central] + branches

	legacy = _legacy_warehouse_names(company)
	return legacy


def get_kqs_pos_profile_names(company: str = "") -> list[str]:
	"""POS profiles tied to KQS hub or branch warehouses."""
	company = company or get_default_company()
	allowed = set(get_kqs_warehouse_names(company))
	if not allowed:
		return []

	return frappe.get_all(
		"POS Profile",
		filters={"company": company, "warehouse": ["in", list(allowed)]},
		pluck="name",
		order_by="name",
	)


def is_kqs_store_warehouse(name: str, company: str = "") -> bool:
	if not name:
		return False
	company = company or get_default_company()
	if not company:
		return False
	wh_company = frappe.db.get_value("Warehouse", name, "company")
	if wh_company != company:
		return False
	return name in get_kqs_warehouse_names(company)


def _legacy_warehouse_names(company: str) -> list[str]:
	abbr = frappe.db.get_value("Company", company, "abbr") if company else "KQS"
	abbr = abbr or "KQS"
	names: list[str] = []
	for suffix in LEGACY_WAREHOUSE_SUFFIXES:
		candidate = f"{suffix} - {abbr}"
		if frappe.db.get_value("Warehouse", candidate, "company") == company:
			names.append(candidate)
	return names
