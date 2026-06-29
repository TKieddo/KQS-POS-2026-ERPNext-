# Copyright (c) 2026, KQS

import frappe

from kqs_retail.utils.defaults import get_default_company

KQS_WAREHOUSE_SUFFIXES = ("Central", "Store-01", "Store-02")
KQS_POS_PROFILES = ("Store-01 POS", "Store-02 POS")


def get_kqs_warehouse_names(company: str = "") -> list[str]:
	company = company or get_default_company()
	abbr = frappe.db.get_value("Company", company, "abbr") if company else "KQS"
	abbr = abbr or "KQS"
	return [f"{suffix} - {abbr}" for suffix in KQS_WAREHOUSE_SUFFIXES]


def get_kqs_central_warehouse(company: str = "") -> str:
	names = get_kqs_warehouse_names(company)
	return names[0] if names else ""


def is_kqs_store_warehouse(name: str, company: str = "") -> bool:
	return name in get_kqs_warehouse_names(company)
