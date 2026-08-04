/* Copyright (c) 2026, KQS — POS Closing Entry: server submit + clear cashier UX */

const KQS_CASHUP_PRINT_FORMAT = "KQS Cashup";

frappe.ui.form.on("POS Closing Entry", {
	onload(frm) {
		frm.kqs_prepared_closing =
			frm.doc.docstatus === 0 &&
			!frm.is_new() &&
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
		kqs_setup_cashup_print_action(frm);

		if (frm.doc.docstatus !== 0) {
			return;
		}

		// New / unsaved forms have a client-only name (new-pos-closing-entry-…).
		// Our submit API needs a real saved doc — prepare from the opening first.
		if (frm.is_new() || String(frm.doc.name || "").startsWith("new-pos-closing-entry")) {
			kqs_hide_client_submit_actions(frm);
			if (!frm.doc.pos_opening_entry) {
				frm.dashboard.set_headline(
					__("Select a POS Opening Entry, then click Submit Closing."),
					"orange"
				);
				frm.page.set_primary_action(__("Submit Closing"), () => {
					frappe.msgprint(__("Select a POS Opening Entry first."));
				});
				return;
			}
			frm.page.set_primary_action(__("Submit Closing"), () => kqs_prepare_then_submit(frm));
			frm.dashboard.set_headline(
				__(
					"This closing is not saved yet. Submit Closing will create the closing from the opening, then submit it."
				)
			);
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

function kqs_cashup_print_settings() {
	const boot = frappe.boot?.kqs_retail_settings || {};
	return {
		auto_print: cint(boot.auto_print_cashup_receipt ?? 1) === 1,
		print_format: (boot.cashup_print_format || KQS_CASHUP_PRINT_FORMAT).trim(),
	};
}

function kqs_cashup_printed_key(docname) {
	return `kqs_cashup_auto_printed:${docname}`;
}

function kqs_cashup_was_auto_printed(docname) {
	try {
		return sessionStorage.getItem(kqs_cashup_printed_key(docname)) === "1";
	} catch (e) {
		return false;
	}
}

function kqs_cashup_mark_auto_printed(docname) {
	try {
		sessionStorage.setItem(kqs_cashup_printed_key(docname), "1");
	} catch (e) {
		/* private mode / quota */
	}
}

function kqs_get_silent_print_fn() {
	return window.kqs_print || (window.kqs_retail && kqs_retail.silent_print?.print);
}

/**
 * @param {string} docname
 * @param {{ allow_browser_fallback?: boolean }} [opts]
 * allow_browser_fallback: true for manual Print button only.
 * Auto-print must stay QZ/silent — browser printview popups linger and re-prompt on the till.
 */
function kqs_print_cashup_receipt(docname, opts) {
	if (!docname) return Promise.resolve(false);
	opts = opts || {};
	const allow_browser = opts.allow_browser_fallback === true;
	const { print_format } = kqs_cashup_print_settings();
	const fmt = print_format || KQS_CASHUP_PRINT_FORMAT;
	const print_fn = kqs_get_silent_print_fn();

	if (print_fn) {
		return Promise.resolve(print_fn("POS Closing Entry", docname, fmt, "")).then((method) => {
			// If QZ failed and silent_print fell back to browser, note it — auto path avoids this.
			return method;
		});
	}

	if (!allow_browser) {
		frappe.show_alert({
			message: __("Cash up saved. Use Print Cash Up when the printer is ready."),
			indicator: "blue",
		}, 8);
		return Promise.resolve(false);
	}

	frappe.utils.print("POS Closing Entry", docname, fmt, "", frappe.boot.lang);
	return Promise.resolve("browser");
}

function kqs_maybe_auto_print_cashup(docname) {
	const { auto_print } = kqs_cashup_print_settings();
	if (!auto_print || !docname) return;
	// One auto-print per closing per browser session — prevents repeat popups on POS.
	if (kqs_cashup_was_auto_printed(docname)) return;
	kqs_cashup_mark_auto_printed(docname);

	setTimeout(() => {
		const print_fn = kqs_get_silent_print_fn();
		const { print_format } = kqs_cashup_print_settings();
		const fmt = print_format || KQS_CASHUP_PRINT_FORMAT;

		// Auto path: QZ only — never open browser printview (sticky popups on POS).
		if (!print_fn || cint(frappe.boot?.kqs_retail_settings?.enable_qz_silent_print ?? 1) !== 1) {
			frappe.show_alert({
				message: __("Cash up saved. Tap Print Cash Up to print the session slip."),
				indicator: "blue",
			}, 10);
			return;
		}

		Promise.resolve(print_fn("POS Closing Entry", docname, fmt, "", { browser_fallback: false }))
			.then((method) => {
				if (method === "qz") return;
				frappe.show_alert({
					message: __(
						"Cash up saved. Printer was busy — use Print Cash Up if you need a paper copy."
					),
					indicator: "blue",
				}, 10);
			})
			.catch(() => {
				frappe.show_alert({
					message: __("Cash up saved. Use Print Cash Up to print the session slip."),
					indicator: "blue",
				}, 10);
			});
	}, 400);
	// Future: after successful QZ print, queue WhatsApp cash-up report to management.
}

function kqs_setup_cashup_print_action(frm) {
	if (frm.doc.docstatus !== 1 || !frm.doc.name) return;
	frm.add_custom_button(__("Print Cash Up"), () =>
		kqs_print_cashup_receipt(frm.doc.name, { allow_browser_fallback: true })
	);
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

function kqs_payment_reconciliation_payload(frm) {
	return (frm.doc.payment_reconciliation || []).map((row) => ({
		mode_of_payment: row.mode_of_payment,
		closing_amount: row.closing_amount,
	}));
}

function kqs_load_closing_blockers(frm) {
	if (!frm.doc.name || frm.is_new() || frm.doc.docstatus !== 0) {
		return;
	}
	if (String(frm.doc.name).startsWith("new-pos-closing-entry")) {
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

function kqs_prepare_then_submit(frm) {
	const opening = frm.doc.pos_opening_entry;
	if (!opening) {
		frappe.msgprint(__("Select a POS Opening Entry first."));
		return;
	}

	const run_prepare = () => {
		const payment_reconciliation = kqs_payment_reconciliation_payload(frm);

		frappe.call({
			method: "kqs_retail.api.pos_closing.prepare_closing_entry",
			args: { pos_opening_entry: opening },
			freeze: true,
			freeze_message: __("Preparing POS closing..."),
			callback(r) {
				if (r.exc || !r.message?.name) {
					return;
				}
				const name = r.message.name;
				frappe.call({
					method: "kqs_retail.api.pos_closing.submit_closing_entry",
					args: {
						name,
						payment_reconciliation: JSON.stringify(payment_reconciliation),
					},
					freeze: true,
					freeze_message: __("Submitting POS closing..."),
					callback(sr) {
						if (sr.exc) {
							frappe.set_route("Form", "POS Closing Entry", name);
							return;
						}
						frappe.show_alert(
							{
								message: __("POS closed successfully."),
								indicator: "green",
							},
							10
						);
						kqs_maybe_auto_print_cashup(name);
						frappe.set_route("Form", "POS Closing Entry", name);
					},
				});
			},
		});
	};

	if (window.kqs_offline?.assert_can_close) {
		window.kqs_offline
			.assert_can_close()
			.then(run_prepare)
			.catch((e) => {
				frappe.msgprint({
					title: __("Cannot close till"),
					indicator: "red",
					message: __(e.message || e),
				});
			});
		return;
	}
	run_prepare();
}

function kqs_submit_closing_entry(frm) {
	if (!frm.doc.name || frm.doc.docstatus !== 0) {
		return;
	}
	if (frm.is_new() || String(frm.doc.name).startsWith("new-pos-closing-entry")) {
		kqs_prepare_then_submit(frm);
		return;
	}

	if (frm.kqs_closing_blockers?.length) {
		kqs_show_closing_blockers_dialog(frm.kqs_closing_blockers);
		return;
	}

	const do_submit = () => {
		frappe.call({
			method: "kqs_retail.api.pos_closing.submit_closing_entry",
			args: {
				name: frm.doc.name,
				payment_reconciliation: JSON.stringify(kqs_payment_reconciliation_payload(frm)),
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
				kqs_maybe_auto_print_cashup(frm.doc.name);
				frm.reload_doc().then(() => {
					kqs_setup_cashier_closing_actions(frm);
					kqs_setup_cashup_print_action(frm);
				});
			},
			error() {
				kqs_load_closing_blockers(frm);
				frm.reload_doc();
			},
		});
	};

	if (window.kqs_offline?.assert_can_close) {
		window.kqs_offline
			.assert_can_close()
			.then(do_submit)
			.catch((e) => {
				frappe.msgprint({
					title: __("Cannot close till"),
					indicator: "red",
					message: __(e.message || e),
				});
			});
		return;
	}
	do_submit();
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

	if (frm.is_new() || String(frm.doc.name || "").startsWith("new-pos-closing-entry")) {
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
			__("Cannot close yet — {0}: {1}{2}", [first.invoice, first.message, more]),
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
			__("Invoices are still loading. Wait a moment, then use Submit Closing at the top.")
		);
	}
}
