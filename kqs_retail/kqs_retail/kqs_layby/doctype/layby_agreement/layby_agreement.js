frappe.ui.form.on("Layby Agreement", {
	onload(frm) {
		if (frm.is_new() && !frm.doc.deposit_percent) {
			const settings = frappe.boot.kqs_retail_settings || {};
			frm.set_value("deposit_percent", settings.minimum_deposit_percent || 20);
		}
	},
	refresh(frm) {
		if (frm.doc.docstatus === 1 && frm.doc.status === "Active" && frm.doc.balance_amount > 0) {
			frm.add_custom_button(__("Record Payment"), () => {
				frappe.new_doc("Layby Payment", {
					layby_agreement: frm.doc.name,
					customer: frm.doc.customer,
					company: frm.doc.company,
					amount: frm.doc.balance_amount,
				});
			});
		}
	},
	items_add(frm) {
		frm.trigger("calculate");
	},
	items_remove(frm) {
		frm.trigger("calculate");
	},
	calculate(frm) {
		let total = 0;
		(frm.doc.items || []).forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "amount", flt(row.qty) * flt(row.rate));
			total += flt(row.amount);
		});
		frm.set_value("total_amount", total);
		frm.set_value("deposit_amount", (total * flt(frm.doc.deposit_percent || frappe.boot.kqs_retail_settings?.minimum_deposit_percent || 20)) / 100);
		frm.set_value("balance_amount", total - flt(frm.doc.paid_amount));
	},
	deposit_percent(frm) {
		frm.trigger("calculate");
	},
});
