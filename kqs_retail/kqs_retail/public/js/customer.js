/* Copyright (c) 2026, KQS — Customer dashboard: AR, store credit, laybys */

frappe.ui.form.on("Customer", {
	refresh(frm) {
		if (frm.is_new() || frm.doc.disabled) {
			return;
		}
		load_kqs_customer_dashboard(frm);
	},
});

function load_kqs_customer_dashboard(frm) {
	const company =
		frappe.defaults.get_default("company") ||
		(frappe.boot.sysdefaults && frappe.boot.sysdefaults.company);

	frappe.call({
		method: "kqs_retail.api.customer_account.get_customer_account_summary",
		args: {
			customer: frm.doc.name,
			company: company,
			include_credit_notes: 0,
		},
		callback(r) {
			const data = r.message;
			if (!data || data.walk_in) {
				return;
			}
			render_kqs_customer_indicators(frm, data, company);
			add_kqs_customer_actions(frm, company);
		},
	});
}

function add_kqs_customer_actions(frm, company) {
	frm.add_custom_button(
		__("Account Summary Report"),
		() => {
			frappe.set_route("query-report", "Customer Account Summary", {
				company: company,
				customer: frm.doc.name,
			});
		},
		__("KQS Retail")
	);

	frm.add_custom_button(
		__("POS Invoices"),
		() => {
			frappe.set_route("List", "POS Invoice", {
				customer: frm.doc.name,
				is_return: 0,
				docstatus: 1,
			});
		},
		__("KQS Retail")
	);
}

function render_kqs_customer_indicators(frm, data, company) {
	if (!frm.dashboard) {
		return;
	}

	const currency = frappe.defaults.get_default("currency");
	const owes = format_currency(flt(data.ar_outstanding), currency);
	const credit = format_currency(flt(data.store_credit_balance), currency);
	const layby = format_currency(flt(data.layby_balance_total), currency);

	frm.dashboard.set_headline_alert(
		__(
			"KQS balances — On account (Owes): {0} | Store credit: {1} | Layby: {2}. " +
				"ERPNext Total Unpaid (above) is the accounting ledger and can be negative after returns — it is not the same as On account (Owes).",
			[owes, credit, layby]
		),
		flt(data.ar_outstanding) > 0 ? "orange" : "blue"
	);

	frm.dashboard.add_indicator(__("On account (Owes): {0}", [owes]), flt(data.ar_outstanding) > 0 ? "orange" : "grey");

	if (flt(data.store_credit_balance) > 0) {
		frm.dashboard.add_indicator(__("Store credit: {0}", [credit]), "green");
	}

	if (flt(data.layby_balance_total) > 0) {
		frm.dashboard.add_indicator(
			__("Layby balance ({0}): {1}", [data.layby_count || 0, layby]),
			"blue"
		);
	}

	if (data.allow_account_sales && flt(data.credit_limit) > 0) {
		frm.dashboard.add_indicator(
			__("Credit available: {0} / {1}", [
				format_currency(data.credit_available, currency),
				format_currency(data.credit_limit, currency),
			]),
			data.credit_available > 0 ? "purple" : "red"
		);
	}

	if (frm.dashboard) {
		frm.dashboard.add_transactions(
			[
				{
					label: __("Layby Agreements"),
					items: ["Layby Agreement"],
				},
				{
					label: __("Reports"),
					items: ["Customer Account Summary"],
				},
			],
			__("KQS Retail")
		);
	}
}
