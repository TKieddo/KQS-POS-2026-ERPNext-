/* Desk route — cashiers open Layby Lookup & Pay inside Point of Sale. */
frappe.pages["kqs-layby-ops"].on_page_load = function () {
	frappe.set_route("point-of-sale");
	frappe.after_ajax(() => {
		if (window.cur_pos && kqs_retail?.pos_layby_hub) {
			kqs_retail.pos_layby_hub.open(cur_pos);
		} else {
			sessionStorage.setItem("kqs_open_layby_hub", "1");
		}
	});
};
