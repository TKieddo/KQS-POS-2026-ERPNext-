# Copyright (c) 2026, KQS
"""
KQS retail Item Group tree — source of truth for seeding ERPNext categories.

Run:
  bench --site frontend execute kqs_retail.setup.item_group_catalog.seed
"""

from __future__ import annotations

import frappe

KQS_ROOT = "All Item Groups"

# Department → subgroup → leaf category names (exact Item Group labels).
KQS_DEPARTMENT_TREE: dict[str, dict[str, list[str]]] = {
	"Men": {
		"Clothing": [
			"T-shirts & Vests",
			"Shirts (Casual & Formal)",
			"Trousers & Chinos",
			"Jeans & Denim",
			"Shorts",
			"Suits & Blazers",
			"Jackets & Coats",
			"Hoodies & Sweaters",
			"Underwear (Boxers, Briefs, Vests)",
			"Swimwear",
			"Traditional Wear (e.g., Traditional shirts, local prints)",
		],
		"Shoes": [
			"Sneakers & Takkies",
			"Formal Shoes",
			"Boots (Work & Casual)",
			"Sandals & Flip-flops",
			"Slippers",
			"Sports/Athletic Shoes",
		],
		"Accessories": [
			"Ties & Bowties",
			"Belts",
			"Wallets & Purses",
			"Watches",
			"Sunglasses",
			"Hats & Caps",
			"Socks",
			"Backpacks & Bags",
		],
	},
	"Women": {
		"Clothing": [
			"T-shirts & Tops",
			"Blouses & Shirts",
			"Dresses",
			"Skirts",
			"Trousers & Leggings",
			"Jeans & Denim",
			"Shorts",
			"Suits & Formal Wear",
			"Jackets & Coats",
			"Hoodies & Sweaters",
			"Lingerie & Underwear (Panties, Bras, Camisoles)",
			"Swimwear & Beachwear",
			"Traditional Wear (e.g., Shweshwe dresses, traditional wraps)",
		],
		"Shoes": [
			"Heels & Pumps",
			"Flats & Ballerinas",
			"Sneakers & Takkies",
			"Boots (Ankle & Long)",
			"Sandals & Wedges",
			"Slippers",
			"Sports/Athletic Shoes",
		],
		"Accessories": [
			"Shawls, Scarves & Wraps",
			"Handbags & Purses",
			"Belts",
			"Watches",
			"Sunglasses",
			"Jewelry (Necklaces, Earrings, Bracelets)",
			"Hats & Fascinators",
			"Socks & Tights",
			"Hair Accessories",
		],
	},
	"Kids": {
		"Clothing": [
			"T-shirts & Tops",
			"Shirts & Blouses",
			"Pants, Jeans & Leggings",
			"Shorts & Skirts",
			"Dresses (Girls)",
			"Jackets & Coats",
			"Hoodies & Sweaters",
			"Underwear (Panties, Boxers, Vests)",
			"Swimwear",
			"Babywear (Onesies, Rompers, Sleepsuits)",
			"Traditional Kids Wear",
		],
		"Shoes": [
			"Sneakers & Takkies",
			"School Shoes (Formal)",
			"Sandals & Flip-flops",
			"Boots",
			"Slippers",
			"Baby Shoes (Soft soles)",
		],
		"Accessories": [
			"Socks & Tights",
			"Hats & Caps",
			"School Bags & Backpacks",
			"Hair Bows & Accessories (Girls)",
			"Watches (Kids digital/analog)",
			"Lunch Boxes & Drink Bottles",
		],
	},
	"Home & Living": {
		"Bedding & Sleep": [
			"Mattresses (Single, Double, Queen, King)",
			"Blankets (Fleece, Heavy, Traditional Basotho blankets if applicable)",
			"Duvets & Comforters",
			"Pillows",
			"Bedsheets & Duvet Covers",
		],
		"Household & Plastic Products": [
			"Plastic Storage Boxes & Bins",
			"Plastic Buckets & Basins",
			"Brooms, Mops & Brushes",
			"Hangers (Plastic & Wooden)",
			"Food Storage Containers",
			"Washing Pegs & Lines",
		],
		"Home Extras": [
			"Towels (Bath, Hand, Face)",
			"Curtains & Blinds",
			"Rugs & Mats",
		],
	},
	"General Care & Extras": {
		"Shoe Care": [
			"Shoe Polish (Black, Brown, Tan, Clear)",
			"Shoe Brushes & Sponges",
			"Shoe Cleaners & Wipes",
			"Insoles",
			"Shoelaces",
			"Shoe Trees / Shapers",
		],
		"General Store Items": [
			"Umbrellas",
			"Lighters & Matches",
			"Keychains",
			"Batteries",
			"Tape & Glue",
		],
	},
}

# Add Product page layout — department Item Group name must match KQS_DEPARTMENT_TREE keys.
ADD_PRODUCT_SECTIONS = [
	{"key": "women", "title": "Women", "column": "left", "order": 1, "parent": "Women"},
	{"key": "men", "title": "Men", "column": "right", "order": 1, "parent": "Men"},
	{"key": "kids", "title": "Kids", "column": "left", "order": 2, "parent": "Kids"},
	{"key": "home", "title": "Home & Living", "column": "right", "order": 2, "parent": "Home & Living"},
	{"key": "unisex", "title": "Unisex", "column": "right", "order": 3, "parent": "Unisex", "leaf": True},
	{
		"key": "care",
		"title": "General Care & Extras",
		"column": "left",
		"order": 4,
		"parent": "General Care & Extras",
	},
]

UNISEX_ITEM_GROUP = "Unisex"

DEFAULT_DEMO_ITEM_GROUP = "Men — Sneakers & Takkies"


def _subgroup_name(department: str, subgroup: str) -> str:
	return f"{department} — {subgroup}"


def _leaf_name(department: str, leaf: str) -> str:
	"""Unique Item Group name; apparel departments share many leaf labels."""
	if department in ("Men", "Women", "Kids"):
		return f"{department} — {leaf}"
	return leaf


def seed():
	"""Create the full KQS Item Group tree in ERPNext."""
	_clear_kqs_item_groups()
	ensure_kqs_item_groups()
	frappe.db.commit()
	count = sum(
		len(leaves)
		for subgroups in KQS_DEPARTMENT_TREE.values()
		for leaves in subgroups.values()
	)
	print(f"KQS item groups seeded ({len(KQS_DEPARTMENT_TREE)} departments, {count} categories).")


def _clear_kqs_item_groups():
	"""Remove prior KQS department trees (safe before rebuild)."""
	for department in list(KQS_DEPARTMENT_TREE.keys()):
		if not frappe.db.exists("Item Group", department):
			continue
		rows = frappe.db.sql(
			"""
			SELECT child.name
			FROM `tabItem Group` AS child
			INNER JOIN `tabItem Group` AS parent ON parent.name = %s
			WHERE child.lft >= parent.lft AND child.rgt <= parent.rgt AND child.name != parent.name
			ORDER BY child.rgt - child.lft ASC
			""",
			department,
			as_dict=True,
		)
		for row in rows:
			if frappe.db.exists("Item Group", row.name):
				frappe.delete_doc("Item Group", row.name, force=1, ignore_permissions=True)
		frappe.delete_doc("Item Group", department, force=1, ignore_permissions=True)

	# Legacy seed used shared subgroup names (Clothing, Shoes, Accessories) — remove if orphaned.
	for legacy in ("Clothing", "Shoes", "Accessories"):
		if frappe.db.exists("Item Group", legacy):
			frappe.delete_doc("Item Group", legacy, force=1, ignore_permissions=True)


def ensure_kqs_item_groups():
	for department, subgroups in KQS_DEPARTMENT_TREE.items():
		_ensure_group(department, KQS_ROOT)
		for subgroup, leaves in subgroups.items():
			subgroup_name = _subgroup_name(department, subgroup)
			_ensure_group(subgroup_name, department)
			for leaf in leaves:
				_ensure_leaf(_leaf_name(department, leaf), subgroup_name)
	_ensure_leaf(UNISEX_ITEM_GROUP, KQS_ROOT)


def _ensure_group(name: str, parent: str):
	if frappe.db.exists("Item Group", name):
		frappe.db.set_value(
			"Item Group",
			name,
			{"parent_item_group": parent, "is_group": 1},
			update_modified=False,
		)
		return
	frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": name,
			"parent_item_group": parent,
			"is_group": 1,
		}
	).insert(ignore_permissions=True)


def _ensure_leaf(name: str, parent: str):
	if frappe.db.exists("Item Group", name):
		frappe.db.set_value(
			"Item Group",
			name,
			{"parent_item_group": parent, "is_group": 0},
			update_modified=False,
		)
		return
	frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": name,
			"parent_item_group": parent,
			"is_group": 0,
		}
	).insert(ignore_permissions=True)
