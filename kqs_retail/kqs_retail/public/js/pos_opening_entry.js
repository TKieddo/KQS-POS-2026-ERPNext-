/* Copyright (c) 2026, KQS — Close open POS sessions from Desk (manager override). */

frappe.ui.form.on("POS Opening Entry", {
	refresh(frm) {
		if (frm.doc.docstatus !== 1 || frm.doc.status !== "Open") {
			return;
		}
		frm.add_custom_button(__("Close Session"), () => {
			frappe.call({
				method: "kqs_retail.api.pos_closing.prepare_closing_entry",
				args: { pos_opening_entry: frm.doc.name },
				freeze: true,
				freeze_message: __("Preparing POS closing..."),
				callback(r) {
					if (r.exc || !r.message?.name) {
						return;
					}
					frappe.set_route("Form", "POS Closing Entry", r.message.name);
				},
			});
		}).addClass("btn-primary");
	},
});
