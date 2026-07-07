/* Desk route kept for managers — cashiers use Returns inside Point of Sale. */
frappe.pages["kqs-returns"].on_page_load = function () {
	const roles = frappe.boot.user.roles || [];
	const is_cashier_only =
		roles.includes("KQS Cashier") &&
		!roles.includes("System Manager") &&
		!roles.includes("KQS Store Manager") &&
		!roles.includes("Sales Manager");

	if (is_cashier_only) {
		frappe.set_route("point-of-sale");
		frappe.after_ajax(() => {
			if (window.cur_pos && kqs_retail?.pos_returns) {
				kqs_retail.pos_returns.open(cur_pos);
			} else {
				sessionStorage.setItem("kqs_open_returns", "1");
			}
		});
		return;
	}

	frappe.set_route("point-of-sale");
	frappe.msgprint({
		title: __("Returns moved to POS"),
		indicator: "blue",
		message: __("Use Point of Sale → menu → Returns & Store Credit."),
	});
};
