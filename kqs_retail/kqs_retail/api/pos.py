# Copyright (c) 2026, KQS

"""Point of Sale extensions — enrich ERPNext POS item payloads."""

import frappe

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
