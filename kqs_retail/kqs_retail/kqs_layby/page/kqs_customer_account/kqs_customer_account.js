/* Desk route — cashiers and managers open Customer Account inside Point of Sale. */
frappe.pages["kqs-customer-account"].on_page_load = function () {
	frappe.set_route("point-of-sale");
	frappe.after_ajax(() => {
		if (window.cur_pos && kqs_retail?.pos_customer_account) {
			kqs_retail.pos_customer_account.open(cur_pos);
		} else {
			sessionStorage.setItem("kqs_open_customer_account", "1");
		}
	});
};
