# Copyright (c) 2026, KQS
"""
Seed KQS demo data: company, warehouses, sample footwear, POS profiles, stock.

Run:
  bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
"""

import frappe
from frappe.utils import flt, today
from frappe.utils.password import update_password


COMPANY = None
WAREHOUSES = ["Central - KQS", "Store-01 - KQS", "Store-02 - KQS"]
DEMO_PASSWORD = "kqs123"

BLOCKED_MODULES_CASHIER = [
	"Accounts",
	"Assets",
	"Automation",
	"Bulk Transaction",
	"Buying",
	"CRM",
	"ERPNext Integrations",
	"ERPNext Settings",
	"HR",
	"Integrations",
	"Maintenance",
	"Manufacturing",
	"Projects",
	"Quality Management",
	"Regional",
	"Setup",
	"Support",
	"Website",
]


def sync_pos_payment_methods():
	"""Add KQS default payment methods to all POS profiles (safe to re-run)."""
	from kqs_retail.setup.pos_payments import sync_all_pos_profiles

	company = _resolve_company()
	_ensure_payment_modes(company)
	updated = sync_all_pos_profiles(company)
	frappe.db.commit()
	print("POS payment methods synced for", company, f"({updated} profile(s) updated)")


def seed():
	frappe.flags.mute_emails = True
	company = _resolve_company()
	_ensure_warehouses(company)
	_ensure_item_groups()
	items = _ensure_sample_items()
	_ensure_stock(items)
	_ensure_pos_profiles(company)
	_ensure_customer()
	_ensure_roles()
	_ensure_users()
	_ensure_desk_pages()
	_ensure_stock_sidebar()
	_ensure_catalog_permissions()
	cleanup_demo_stores()
	frappe.db.commit()
	print("KQS demo seed complete.")
	print("  Company:", company)
	print("  Warehouses:", ", ".join(WAREHOUSES))
	print("  Items:", ", ".join(items))
	print("  POS: Store-01 POS, Store-02 POS")
	print("  Test POS at http://localhost:8080/app/point-of-sale")
	print("  Cashier: cashier@kqs.local /", DEMO_PASSWORD)
	print("  Manager: manager@kqs.local /", DEMO_PASSWORD)


def cleanup_demo_stores():
	"""Disable ERPNext demo warehouses/POS profiles — keep only KQS stores for testing."""
	from kqs_retail.utils.warehouses import KQS_POS_PROFILES, get_kqs_warehouse_names

	company = _resolve_company()
	keep_wh = set(get_kqs_warehouse_names(company))
	keep_pos = set(KQS_POS_PROFILES)

	disabled_wh = 0
	for row in frappe.get_all("Warehouse", fields=["name", "company"]):
		if row.name in keep_wh:
			frappe.db.set_value("Warehouse", row.name, "disabled", 0)
			continue
		if row.company != company:
			continue
		frappe.db.set_value("Warehouse", row.name, "disabled", 1)
		disabled_wh += 1

	disabled_pos = 0
	for row in frappe.get_all("POS Profile", fields=["name", "company"]):
		if row.name in keep_pos:
			frappe.db.set_value("POS Profile", row.name, "disabled", 0)
			continue
		if row.company != company:
			continue
		frappe.db.set_value("POS Profile", row.name, "disabled", 1)
		disabled_pos += 1

	frappe.db.commit()
	print("KQS store cleanup complete.")
	print("  Active warehouses:", ", ".join(sorted(keep_wh)))
	print("  Active POS:", ", ".join(sorted(keep_pos)))
	if disabled_wh or disabled_pos:
		print(f"  Disabled {disabled_wh} other warehouse(s), {disabled_pos} other POS profile(s).")
	return {
		"warehouses": list(keep_wh),
		"pos_profiles": list(keep_pos),
		"disabled_warehouses": disabled_wh,
		"disabled_pos_profiles": disabled_pos,
	}


def _ensure_roles():
	for role_name, desk_access in [
		("KQS Cashier", 1),
		("KQS Store Manager", 1),
	]:
		if frappe.db.exists("Role", role_name):
			continue
		frappe.get_doc(
			{
				"doctype": "Role",
				"role_name": role_name,
				"desk_access": desk_access,
			}
		).insert(ignore_permissions=True)

	_perms = [
		("KQS Cashier", "Layby Agreement", 1, 1, 1, 0),
		("KQS Cashier", "Layby Payment", 1, 1, 1, 0),
		("KQS Store Manager", "Layby Agreement", 1, 1, 1, 1),
		("KQS Store Manager", "Layby Payment", 1, 1, 1, 1),
		("KQS Store Manager", "Item", 1, 1, 1, 0),
		("KQS Store Manager", "Item Group", 1, 1, 1, 0),
		("KQS Store Manager", "Item Attribute", 1, 1, 1, 0),
		("KQS Store Manager", "Stock Entry", 1, 1, 1, 1),
	]
	for role, doctype, read, write, create, submit in _perms:
		if frappe.db.exists(
			"Custom DocPerm",
			{"parent": doctype, "role": role, "permlevel": 0},
		) or frappe.db.exists(
			"DocPerm",
			{"parent": doctype, "role": role, "permlevel": 0},
		):
			continue
		frappe.get_doc(
			{
				"doctype": "Custom DocPerm",
				"parent": doctype,
				"parenttype": "DocType",
				"parentfield": "permissions",
				"role": role,
				"permlevel": 0,
				"read": read,
				"write": write,
				"create": create,
				"submit": submit,
			}
		).insert(ignore_permissions=True)


def _ensure_users():
	_ensure_demo_user(
		"cashier@kqs.local",
		"KQS Cashier",
		roles=["Sales User", "KQS Cashier"],
		home_page="point-of-sale",
		block_modules=BLOCKED_MODULES_CASHIER,
		permissions=[
			("Warehouse", "Store-01 - KQS"),
			("POS Profile", "Store-01 POS"),
		],
	)
	_ensure_demo_user(
		"manager@kqs.local",
		"KQS Store Manager",
		roles=["Sales Manager", "Stock Manager", "Sales User", "KQS Store Manager"],
		home_page="kqs-retail",
		block_modules=[],
		permissions=[],
	)


def _ensure_demo_user(email, full_name, roles, home_page, block_modules, permissions):
	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
	else:
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": full_name,
				"send_welcome_email": 0,
				"home_page": home_page,
			}
		)
		user.insert(ignore_permissions=True)

	user.home_page = home_page
	user.block_modules = []
	for module in block_modules:
		user.append("block_modules", {"module": module})

	user.roles = []
	for role in roles:
		user.append("roles", {"role": role})

	user.save(ignore_permissions=True)
	update_password(email, DEMO_PASSWORD)

	for allow, for_value in permissions:
		existing = frappe.db.exists(
			"User Permission",
			{"user": email, "allow": allow, "for_value": for_value},
		)
		if existing:
			continue
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": email,
				"allow": allow,
				"for_value": for_value,
				"apply_to_all_doctypes": 1,
			}
		).insert(ignore_permissions=True)


def _ensure_desk_pages():
	"""Import KQS Desk pages if migrate did not register them yet."""
	for page_name in ("quick-add-product", "assign-to-branch"):
		if frappe.db.exists("Page", page_name):
			continue
		frappe.reload_doc("KQS Layby", "Page", page_name)


def _ensure_stock_sidebar():
	from kqs_retail.setup.stock_sidebar import ensure_stock_sidebar_links

	ensure_stock_sidebar_links()


def _ensure_catalog_permissions():
	from kqs_retail.setup.catalog_permissions import ensure

	ensure()


def _resolve_company() -> str:
	global COMPANY
	if COMPANY and frappe.db.exists("Company", COMPANY):
		return COMPANY
	by_abbr = frappe.db.get_value("Company", {"abbr": "KQS"}, "name")
	if by_abbr:
		COMPANY = by_abbr
		return COMPANY
	if frappe.db.exists("Company", "KQS"):
		COMPANY = "KQS"
		return COMPANY
	return _ensure_company()


def _ensure_company():
	global COMPANY
	if COMPANY and frappe.db.exists("Company", COMPANY):
		return COMPANY

	# Use first country if KQS not set up
	country = frappe.db.get_single_value("Global Defaults", "country") or "South Africa"
	currency = frappe.defaults.get_global_default("currency") or "ZAR"

	doc = frappe.get_doc(
		{
			"doctype": "Company",
			"company_name": COMPANY,
			"abbr": "KQS",
			"default_currency": currency,
			"country": country,
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.set_single_value("Global Defaults", "default_company", doc.name)
	COMPANY = doc.name
	return COMPANY


def _ensure_warehouses(company):
	parent = None
	for wh_name in WAREHOUSES:
		if frappe.db.exists("Warehouse", wh_name):
			parent = wh_name
			continue
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": wh_name.replace(f" - {COMPANY}", ""),
				"company": company,
				"parent_warehouse": parent,
				"is_group": 0 if "Store" in wh_name else 0,
			}
		)
		doc.insert(ignore_permissions=True)
		if "Central" in wh_name:
			parent = doc.name


def _ensure_item_groups():
	from kqs_retail.setup.item_group_catalog import ensure_kqs_item_groups

	ensure_kqs_item_groups()


def _ensure_sample_items():
	"""Seed at least one sellable variant for POS/smoke tests."""
	codes = []
	template_name = "KQS Runner Sneaker"
	simple_code = "KQS-DEMO-SNEAKER-9-BLK"

	if frappe.db.exists("Item", simple_code):
		return [simple_code]

	if frappe.db.exists("Item", template_name):
		codes = frappe.get_all("Item", filters={"variant_of": template_name}, pluck="name", limit=4)
		if codes:
			return codes[:4]

	_ensure_item_groups()
	_ensure_item_attribute_defs()

	try:
		codes = _create_variant_template_items(template_name)
		if codes:
			return codes
	except Exception as exc:
		frappe.log_error(f"KQS variant seed skipped: {exc}")

	if not frappe.db.exists("Item", simple_code):
		from kqs_retail.setup.item_group_catalog import DEFAULT_DEMO_ITEM_GROUP

		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": simple_code,
				"item_name": "KQS Demo Sneaker 9 Black",
				"item_group": DEFAULT_DEMO_ITEM_GROUP,
				"stock_uom": "Nos",
				"is_stock_item": 1,
				"standard_rate": 899,
			}
		).insert(ignore_permissions=True)
	return [simple_code]


def _ensure_item_attribute_defs():
	from kqs_retail.api.product_setup import _ensure_attribute_values

	_ensure_attribute_values("Size", {"5", "6", "7", "8", "9", "10", "11", "12"})
	_ensure_attribute_values("Color", {"Black", "White", "Brown", "Red", "Blue"})
	frappe.db.commit()


def _create_variant_template_items(template_name: str) -> list[str]:
	from kqs_retail.setup.item_group_catalog import DEFAULT_DEMO_ITEM_GROUP

	codes = []
	if not frappe.db.exists("Item", template_name):
		tpl = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": template_name,
				"item_name": template_name,
				"item_group": DEFAULT_DEMO_ITEM_GROUP,
				"stock_uom": "Nos",
				"is_stock_item": 1,
				"has_variants": 1,
				"attributes": [{"attribute": "Size"}, {"attribute": "Color"}],
			}
		)
		tpl.insert(ignore_permissions=True)
		frappe.db.commit()

	from erpnext.controllers.item_variant import create_variant

	for size in ["9", "10"]:
		for color in ["Black", "White"]:
			code = f"{template_name}-{size}-{color}"
			if frappe.db.exists("Item", code):
				codes.append(code)
				continue
			variant = create_variant(template_name, {"Size": size, "Color": color})
			variant.standard_rate = 899
			variant.barcode = f"KQS{size}{color[:1]}"
			variant.insert(ignore_permissions=True)
			codes.append(code)
	return codes


def _ensure_stock(item_codes):
	central = "Central - KQS"
	for code in item_codes:
		_bin = frappe.db.get_value("Bin", {"item_code": code, "warehouse": central}, "name")
		if _bin:
			continue
		se = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Receipt",
				"company": COMPANY,
				"posting_date": today(),
				"items": [
					{
						"item_code": code,
						"qty": 50,
						"t_warehouse": central,
						"basic_rate": 400,
					}
				],
			}
		)
		se.insert(ignore_permissions=True)
		se.submit()

	# Transfer to stores
	for store in ["Store-01 - KQS", "Store-02 - KQS"]:
		for code in item_codes[:2]:
			if frappe.db.get_value("Bin", {"item_code": code, "warehouse": store}, "actual_qty"):
				continue
			st = frappe.get_doc(
				{
					"doctype": "Stock Entry",
					"stock_entry_type": "Material Transfer",
					"company": COMPANY,
					"posting_date": today(),
					"items": [
						{
							"item_code": code,
							"qty": 10,
							"s_warehouse": central,
							"t_warehouse": store,
						}
					],
				}
			)
			st.insert(ignore_permissions=True)
			st.submit()


def _ensure_bank_account(company):
	bank = frappe.db.get_value("Company", company, "default_bank_account")
	if bank and frappe.db.exists("Account", bank):
		return bank
	bank = frappe.db.get_value(
		"Account",
		{"company": company, "account_type": "Bank", "is_group": 0},
		"name",
	)
	if bank:
		return bank
	parent = frappe.db.get_value(
		"Account",
		{"company": company, "account_name": "Bank Accounts", "is_group": 1},
		"name",
	)
	if not parent:
		return None
	doc = frappe.get_doc(
		{
			"doctype": "Account",
			"account_name": "POS Card Clearing",
			"parent_account": parent,
			"company": company,
			"account_type": "Bank",
			"is_group": 0,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_payment_modes(company):
	"""Cash + Card (and any future modes) for POS — linked to company GL accounts."""
	cash_account = frappe.db.get_value("Company", company, "default_cash_account")
	bank_account = _ensure_bank_account(company)
	specs = [
		("Cash", "Cash", cash_account),
		("Card", "Bank", bank_account),
	]
	for mop_name, mop_type, account in specs:
		if not account:
			frappe.log_error(
				title="KQS seed: missing account for Mode of Payment",
				message=f"{mop_name} — company {company}",
			)
			continue
		if frappe.db.exists("Mode of Payment", mop_name):
			doc = frappe.get_doc("Mode of Payment", mop_name)
			if not any(row.company == company for row in doc.accounts):
				doc.append("accounts", {"company": company, "default_account": account})
				doc.save(ignore_permissions=True)
			continue
		frappe.get_doc(
			{
				"doctype": "Mode of Payment",
				"mode_of_payment": mop_name,
				"type": mop_type,
				"accounts": [{"company": company, "default_account": account}],
			}
		).insert(ignore_permissions=True)


def _ensure_pos_profiles(company):
	from kqs_retail.setup.pos_payments import get_default_pos_payment_rows, sync_pos_profile_payments

	payment_rows = get_default_pos_payment_rows()
	_ensure_payment_modes(company)
	write_off_account = frappe.db.get_value(
		"Company", company, "default_expense_account"
	) or frappe.db.get_value(
		"Account",
		{"company": company, "account_type": "Expense Account", "is_group": 0},
		"name",
	)
	cost_center = frappe.db.get_value("Company", company, "cost_center") or frappe.db.get_value(
		"Cost Center", {"company": company, "is_group": 0}, "name"
	)

	for store_wh, profile_name in [
		("Store-01 - KQS", "Store-01 POS"),
		("Store-02 - KQS", "Store-02 POS"),
	]:
		if frappe.db.exists("POS Profile", profile_name):
			sync_pos_profile_payments(profile_name)
			continue
		doc = frappe.get_doc(
			{
				"doctype": "POS Profile",
				"name": profile_name,
				"company": company,
				"warehouse": store_wh,
				"currency": frappe.db.get_value("Company", company, "default_currency"),
				"update_stock": 1,
				"allow_print_before_pay": 1,
				"set_grand_total_to_default_mop": 0,
				"write_off_account": write_off_account,
				"write_off_cost_center": cost_center,
				"payments": payment_rows,
			}
		)
		doc.insert(ignore_permissions=True)


def _ensure_customer():
	if frappe.db.exists("Customer", "Walk-in Customer"):
		return
	frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": "Walk-in Customer",
			"customer_type": "Individual",
			"customer_group": "Individual",
			"territory": "All Territories",
		}
	).insert(ignore_permissions=True)


def smoke_test_pos():
	"""Verify sale + return flow programmatically."""
	seed()
	warehouse = "Store-01 - KQS"
	item = _smoke_test_item()
	if not item:
		print("No stock items for smoke test")
		return
	customer = "Walk-in Customer"
	company = _resolve_company()

	inv = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": customer,
			"company": company,
			"is_pos": 1,
			"update_stock": 1,
			"items": [{"item_code": item, "qty": 1, "rate": 899, "warehouse": warehouse}],
		}
	)
	inv.append("payments", {"mode_of_payment": "Cash", "amount": 899})
	inv.insert(ignore_permissions=True)
	inv.submit()
	print("Smoke test sale OK:", inv.name)

	before = frappe.db.get_value("Bin", {"item_code": item, "warehouse": warehouse}, "actual_qty")

	cn = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": customer,
			"company": company,
			"is_return": 1,
			"return_against": inv.name,
			"update_stock": 1,
			"items": [{"item_code": item, "qty": -1, "rate": 899, "warehouse": warehouse}],
		}
	)
	cn.insert(ignore_permissions=True)
	cn.submit()
	after = frappe.db.get_value("Bin", {"item_code": item, "warehouse": warehouse}, "actual_qty")
	print("Smoke test return OK:", cn.name, f"stock {before} -> {after}")
	frappe.db.commit()


def smoke_test_layby():
	"""Verify layby create, installment, and completion."""
	seed()
	warehouse = "Store-01 - KQS"
	item = _smoke_test_item()
	if not item:
		print("No stock items for layby smoke test")
		return
	customer = "Walk-in Customer"
	company = _resolve_company()
	rate = flt(frappe.db.get_value("Item", item, "standard_rate") or 899)

	from kqs_retail.api import create_layby_from_cart, get_sellable_stock, record_layby_payment

	cart = [{"item_code": item, "qty": 1, "rate": rate}]
	deposit = flt(rate * 0.2)
	layby = create_layby_from_cart(
		customer=customer,
		company=company,
		warehouse=warehouse,
		items=cart,
		deposit_paid=deposit,
		pos_profile="Store-01 POS",
		deposit_percent=20,
	)
	agreement = layby["name"]
	print("Layby smoke create OK:", agreement)

	sellable_after_reserve = get_sellable_stock(item, warehouse)
	print("Sellable qty after layby:", sellable_after_reserve.get("sellable_qty"))

	balance = flt(layby.get("balance_amount"))
	if balance > 0:
		record_layby_payment(
			layby_agreement=agreement,
			amount=balance,
			mode_of_payment="Cash",
		)
		print("Layby smoke payment OK — balance cleared")

	status = frappe.db.get_value("Layby Agreement", agreement, "status")
	invoice = frappe.db.get_value("Layby Agreement", agreement, "sales_invoice")
	print("Layby smoke complete OK:", agreement, "status=", status, "invoice=", invoice)
	frappe.db.commit()


def _smoke_test_item() -> str | None:
	variant = frappe.get_all(
		"Item",
		filters={"variant_of": ["!=", ""], "disabled": 0, "is_stock_item": 1},
		limit=1,
		pluck="name",
	)
	if variant:
		return variant[0]
	any_item = frappe.get_all(
		"Item",
		filters={"disabled": 0, "is_stock_item": 1, "has_variants": 0},
		limit=1,
		pluck="name",
	)
	return any_item[0] if any_item else None
