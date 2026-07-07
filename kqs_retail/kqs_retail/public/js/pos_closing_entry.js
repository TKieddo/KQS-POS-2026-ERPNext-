/* Copyright (c) 2026, KQS — POS Closing Entry: server submit + clear cashier UX */

frappe.ui.form.on("POS Closing Entry", {
	onload(frm) {
		frm.kqs_prepared_closing =
			frm.doc.docstatus === 0 &&
			!frm.doc.amended_from &&
			Boolean(frm.doc.pos_invoices?.length || frm.doc.sales_invoices?.length);
		if (frm.kqs_prepared_closing) {
			frm.kqs_server_period_end_date = frm.doc.period_end_date;
		}
	},

	refresh(frm) {
		if (frappe.boot?.kqs_cashier_pos_only) {
			document.body.classList.add("kqs-cashier-pos-only", "kqs-cashier-closing-form");
		}
		show_closing_status_headline(frm);
		kqs_setup_cashier_closing_actions(frm);

		if (frm.doc.docstatus !== 0) {
			return;
		}

		frm.disable_save();
		kqs_hide_client_submit_actions(frm);
		kqs_undo_erpnext_period_end_touch(frm);
		kqs_load_closing_blockers(frm);

		frm.page.set_primary_action(__("Submit Closing"), () => kqs_submit_closing_entry(frm));
	},
});

function kqs_go_to_point_of_sale() {
	frappe.set_route("point-of-sale");
}

function kqs_setup_cashier_closing_actions(frm) {
	if (!frappe.boot?.kqs_cashier_pos_only) {
		return;
	}

	const back_label = __("Back to Point of Sale");
	const go_pos = () => kqs_go_to_point_of_sale();

	if (frm.doc.docstatus === 0) {
		frm.page.set_secondary_action(back_label, go_pos, "arrow-left");
		if (frm.page.btn_secondary?.length) {
			frm.page.btn_secondary.show();
		}
		return;
	}

	frm.page.set_primary_action(back_label, go_pos, "arrow-left");
}

function kqs_hide_client_submit_actions(frm) {
	frm.page.menu.find("a").each(function () {
		const label = $(this).text().trim();
		if (label === __("Save") || label === __("Submit")) {
			$(this).parent().hide();
		}
	});
}

function kqs_undo_erpnext_period_end_touch(frm) {
	if (!frm.kqs_prepared_closing || !frm.kqs_server_period_end_date) {
		return;
	}
	// ERPNext onload sets period_end_date to now and marks the form dirty.
	setTimeout(() => {
		if (!frm.doc || frm.doc.docstatus !== 0) {
			return;
		}
		if (frm.doc.period_end_date !== frm.kqs_server_period_end_date) {
			frm.doc.period_end_date = frm.kqs_server_period_end_date;
			frm.refresh_field("period_end_date");
		}
		frm.doc.__unsaved = 0;
		frm.refresh_header();
	}, 0);
}

function kqs_load_closing_blockers(frm) {
	if (!frm.doc.name || frm.doc.docstatus !== 0) {
		return;
	}
	frappe.call({
		method: "kqs_retail.api.pos_closing.get_closing_blockers",
		args: { name: frm.doc.name },
		callback(r) {
			if (r.exc || !r.message) {
				return;
			}
			frm.kqs_closing_blockers = r.message.blockers || [];
			show_closing_status_headline(frm);
		},
	});
}

function kqs_submit_closing_entry(frm) {
	if (!frm.doc.name || frm.doc.docstatus !== 0) {
		return;
	}

	if (frm.kqs_closing_blockers?.length) {
		kqs_show_closing_blockers_dialog(frm.kqs_closing_blockers);
		return;
	}

	const payment_reconciliation = (frm.doc.payment_reconciliation || []).map((row) => ({
		mode_of_payment: row.mode_of_payment,
		closing_amount: row.closing_amount,
	}));

	frappe.call({
		method: "kqs_retail.api.pos_closing.submit_closing_entry",
		args: {
			name: frm.doc.name,
			payment_reconciliation: JSON.stringify(payment_reconciliation),
		},
		freeze: true,
		freeze_message: __("Submitting POS closing..."),
		callback(r) {
			if (r.exc) {
				kqs_load_closing_blockers(frm);
				frm.reload_doc();
				return;
			}
			frappe.show_alert(
				{
					message: __("POS closed successfully."),
					indicator: "green",
				},
				10
			);
			frm.reload_doc().then(() => {
				kqs_setup_cashier_closing_actions(frm);
			});
		},
		error() {
			kqs_load_closing_blockers(frm);
			frm.reload_doc();
		},
	});
}

function kqs_show_closing_blockers_dialog(blockers) {
	const rows = (blockers || [])
		.map(
			(row) =>
				`<tr><td><strong>${frappe.utils.escape_html(row.invoice)}</strong></td>` +
				`<td>${frappe.utils.escape_html(row.customer || "")}</td>` +
				`<td>${frappe.utils.escape_html(row.message)}</td></tr>`
		)
		.join("");
	const table = `
		<table class="table table-bordered table-sm">
			<thead>
				<tr>
					<th>${__("Invoice")}</th>
					<th>${__("Customer")}</th>
					<th>${__("Issue")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>`;
	frappe.msgprint({
		title: __("Cannot Close POS"),
		message: __("Ask a manager to fix these invoices before closing:") + table,
		indicator: "red",
	});
}

function show_closing_status_headline(frm) {
	if (frm.doc.docstatus === 1) {
		if (frm.doc.status === "Submitted") {
			frm.dashboard.set_headline(
				__(
					"POS closed successfully. Use Back to Point of Sale when you are ready to open the till again."
				)
			);
		} else if (frm.doc.status === "Queued") {
			frm.dashboard.set_headline(
				__("POS closing is running in the background. This page will update when finished.")
			);
		} else if (frm.doc.status === "Failed" && frm.doc.error_message) {
			frm.dashboard.set_headline(
				__("POS closing failed. Use Submit Closing again or contact a manager.")
			);
		}
		return;
	}

	if (frm.kqs_closing_blockers?.length) {
		const first = frm.kqs_closing_blockers[0];
		const more =
			frm.kqs_closing_blockers.length > 1
				? __(" (+{0} more — click Submit Closing for full list)", [
						frm.kqs_closing_blockers.length - 1,
				  ])
				: "";
		frm.dashboard.set_headline(
			__(
				"Cannot close yet — {0}: {1}{2}",
				[first.invoice, first.message, more]
			),
			"red"
		);
		return;
	}

	if (frm.doc.docstatus === 0 && frm.doc.status === "Failed" && frm.doc.error_message) {
		frm.dashboard.set_headline(
			__(
				"Previous close attempt failed: {0}. Fix the issue, then click Submit Closing again.",
				[frm.doc.error_message]
			),
			"red"
		);
		return;
	}

	if (
		frm.doc.docstatus === 0 &&
		frm.doc.pos_opening_entry &&
		!frm.doc.pos_invoices?.length &&
		!frm.doc.sales_invoices?.length
	) {
		frm.dashboard.set_headline(
			__(
				"Invoices are still loading. Wait a moment, then use Submit Closing at the top."
			)
		);
	}
}
