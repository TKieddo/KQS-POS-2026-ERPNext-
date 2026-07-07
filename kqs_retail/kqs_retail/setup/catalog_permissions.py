# Copyright (c) 2026, KQS
"""Ensure store manager can read and manage catalog metadata for Add Product."""

import frappe

from kqs_retail.setup.perm_utils import ensure_custom_perm


def ensure():
	ensure_custom_perm("KQS Store Manager", "Item", read=1, write=1, create=1, delete=1)
	ensure_custom_perm("KQS Store Manager", "Item Group", read=1, write=1, create=1, delete=1)
	ensure_custom_perm("KQS Store Manager", "Item Attribute", read=1, write=1, create=1, delete=1)
	frappe.db.commit()
	print("Catalog permissions ensured for KQS Store Manager.")
