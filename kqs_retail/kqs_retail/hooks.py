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
		"logo": "/assets/kqs_retail/images/kqs.svg",
		"title": "Point of Sale",
		"route": "/app/point-of-sale",
		"has_permission": "kqs_retail.api.has_pos_app_permission",
	},
	{
		"name": "kqs_retail",
		"logo": "/assets/kqs_retail/images/kqs.svg",
		"title": "KQS Retail",
		"route": "/app/layby-agreement",
		"has_permission": "kqs_retail.api.has_app_permission",
	},
]

page_js = {"point-of-sale": "public/js/point_of_sale.js"}

override_whitelisted_methods = {
	"erpnext.selling.page.point_of_sale.point_of_sale.get_items": "kqs_retail.api.pos.get_items",
}

doctype_js = {"Item": "public/js/item.js"}

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

after_migrate = [
	"kqs_retail.setup.stock_sidebar.ensure_stock_sidebar_links",
	"kqs_retail.setup.selling_sidebar.ensure_selling_sidebar_link",
	"kqs_retail.setup.kqs_retail_settings.ensure_kqs_retail_settings",
	"kqs_retail.setup.product_fields.ensure_product_custom_fields",
	"kqs_retail.setup.catalog_permissions.ensure",
	"kqs_retail.setup.pos_payments.ensure_default_pos_payment_methods",
	"kqs_retail.setup.customer_defaults.ensure_customer_defaults",
]

doc_events = {
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
		"filters": [["name", "in", ["quick-add-product", "assign-to-branch"]]],
	},
]
