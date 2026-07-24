app_name = "kqs_retail"
app_title = "KQS Retail"
app_publisher = "KQS"
app_description = "Layby, stock APIs, and retail extensions for KQS apparel stores"
app_email = "pos@kqs.local"
app_license = "MIT"
app_version = "0.1.0"

required_apps = ["erpnext"]

add_to_apps_screen = [
	{
		"name": "point_of_sale",
		"logo": "/assets/kqs_retail/images/kqs-logo.png",
		"title": "Point of Sale",
		"route": "/app/point-of-sale",
		"has_permission": "kqs_retail.api.has_pos_app_permission",
	},
	{
		"name": "kqs_retail",
		"logo": "/assets/kqs_retail/images/kqs-logo.png",
		"title": "KQS Retail",
		"route": "/app/layby-agreement",
		"has_permission": "kqs_retail.api.has_app_permission",
	},
]

page_js = {
	"point-of-sale": "public/js/point_of_sale.js",
}

app_include_js = "public/js/cashier_desk_guard.js"

override_whitelisted_methods = {
	"erpnext.selling.page.point_of_sale.point_of_sale.get_items": "kqs_retail.api.pos.get_items",
	"erpnext.selling.page.point_of_sale.point_of_sale.check_opening_entry": (
		"kqs_retail.api.pos.check_opening_entry"
	),
}

doctype_js = {
	"Item": "public/js/item.js",
	"Customer": "public/js/customer.js",
	"POS Closing Entry": "public/js/pos_closing_entry.js",
	"POS Opening Entry": "public/js/pos_opening_entry.js",
}

doctype_list_js = {
	"Item": [
		"public/js/item.js",
		"public/js/item_list.js",
	],
}

boot_session = [
	"kqs_retail.boot.redirect_cashier_to_pos",
	"kqs_retail.boot.inject_kqs_retail_settings",
]

before_request = [
	"kqs_retail.boot.ensure_runtime_patches",
	"kqs_retail.permissions.cashier_desk.block_cashier_desk_browsing",
]

permission_query_conditions = {
	"Sales Invoice": "kqs_retail.permissions.cashier_desk.sales_invoice_query",
	"POS Invoice": "kqs_retail.permissions.cashier_desk.pos_invoice_query",
	"Payment Entry": "kqs_retail.permissions.cashier_desk.payment_entry_query",
	"Layby Agreement": "kqs_retail.permissions.cashier_desk.layby_agreement_query",
	"Item": "kqs_retail.permissions.cashier_desk.item_query",
	"Stock Entry": "kqs_retail.permissions.cashier_desk.stock_entry_query",
}

has_permission = {
	"Report": "kqs_retail.permissions.cashier_desk.has_report_permission",
}

after_migrate = [
	"kqs_retail.setup.stock_sidebar.ensure_stock_sidebar_links",
	"kqs_retail.setup.selling_sidebar.ensure_selling_sidebar_link",
	"kqs_retail.setup.kqs_retail_settings.ensure_kqs_retail_settings",
	"kqs_retail.setup.product_fields.ensure_product_custom_fields",
	"kqs_retail.setup.catalog_permissions.ensure",
	"kqs_retail.setup.cashier_permissions.ensure",
	"kqs_retail.setup.manager_permissions.ensure",
	"kqs_retail.setup.stock_permissions.ensure",
	"kqs_retail.setup.pos_payments.ensure_default_pos_payment_methods",
	"kqs_retail.setup.customer_defaults.ensure_customer_defaults",
	"kqs_retail.setup.customer_fields.ensure_customer_custom_fields",
	"kqs_retail.setup.invoice_fields.ensure_invoice_custom_fields",
	"kqs_retail.setup.store_credit.ensure_store_credit_setup",
	"kqs_retail.setup.pos_profile_fields.ensure_pos_profile_receipt_fields",
	"kqs_retail.setup.receipt_print_formats.ensure_receipt_print_formats",
]

doc_events = {
	"POS Profile": {
		"validate": "kqs_retail.setup.pos_payments.enforce_manual_payment_entry",
	},
	"Sales Invoice": {
		"before_submit": [
			"kqs_retail.utils.store_credit.apply_return_credit_customer",
			"kqs_retail.utils.customer_account.validate_pos_payment_totals_before_submit",
			"kqs_retail.utils.customer_account.validate_account_sale_before_submit",
			"kqs_retail.utils.store_credit.prepare_store_credit_before_submit",
			"kqs_retail.utils.customer_account.prepare_account_sale_before_submit",
		],
		"on_submit": [
			"kqs_retail.utils.store_credit.ensure_return_credit_outstanding",
			"kqs_retail.utils.store_credit.allocate_store_credit_on_invoice_submit",
			"kqs_retail.utils.store_credit.finalize_store_credit_on_submit",
			"kqs_retail.utils.customer_account.finalize_account_sale_on_submit",
			"kqs_retail.utils.customer_account.settle_on_account_original_on_return",
		],
	},
	"POS Invoice": {
		"before_submit": [
			"kqs_retail.utils.store_credit.apply_return_credit_customer",
			"kqs_retail.utils.customer_account.validate_pos_payment_totals_before_submit",
			"kqs_retail.utils.customer_account.validate_account_sale_before_submit",
			"kqs_retail.utils.store_credit.prepare_store_credit_before_submit",
			"kqs_retail.utils.customer_account.prepare_account_sale_before_submit",
		],
		"on_submit": [
			"kqs_retail.utils.store_credit.ensure_return_credit_outstanding",
			"kqs_retail.utils.store_credit.allocate_store_credit_on_invoice_submit",
			"kqs_retail.utils.store_credit.finalize_store_credit_on_submit",
			"kqs_retail.utils.customer_account.finalize_account_sale_on_submit",
			"kqs_retail.utils.customer_account.settle_on_account_original_on_return",
		],
	},
	"Layby Agreement": {
		"on_submit": "kqs_retail.kqs_layby.doctype.layby_agreement.layby_agreement.on_submit",
		"on_cancel": "kqs_retail.kqs_layby.doctype.layby_agreement.layby_agreement.on_cancel",
	},
	"Layby Payment": {
		"on_submit": "kqs_retail.kqs_layby.doctype.layby_payment.layby_payment.on_submit",
	},
}

scheduler_events = {
	"daily": [
		"kqs_retail.kqs_layby.tasks.check_overdue_laybys",
	],
}

fixtures = [
	{
		"dt": "Custom Field",
		"filters": [["module", "=", "KQS Layby"]],
	},
	{
		"dt": "Workspace",
		"filters": [["name", "=", "KQS Retail"]],
	},
	{
		"dt": "Page",
		"filters": [["name", "in", ["quick-add-product", "edit-product", "receive-stock", "assign-to-branch", "kqs-returns", "kqs-customer-account", "kqs-layby-ops"]]],
	},
	{
		"dt": "Report",
		"filters": [
			[
				"name",
				"in",
				[
					"Customer Account Summary",
					"Layby Open Summary",
					"Layby Deposits Held",
					"Layby Overdue",
					"Layby Forfeited Cancelled",
				],
			]
		],
	},
]
