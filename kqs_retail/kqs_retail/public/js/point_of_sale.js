/* Copyright (c) 2026, KQS — Layby & checkout flow for ERPNext Point of Sale */
frappe.provide("kqs_retail.point_of_sale");

(function () {
	const LAYBY_BTN_CLASS = "kqs-layby-order-btn";
	const LAYBY_SETTINGS_FALLBACK = {
		layby_enabled_on_pos: 1,
		minimum_deposit_percent: 20,
		maximum_term_days: 90,
		grace_period_days: 7,
		early_cancel_full_refund_days: 7,
		late_cancel_refund_percent: 50,
		auto_print_layby_receipts: 1,
		layby_customer_print_format: "",
		layby_reserve_print_format: "",
		layby_complete_print_format: "",
	};
	const INVOICE_DOCTYPES = ["Sales Invoice", "POS Invoice"];

	function get_layby_settings() {
		return { ...LAYBY_SETTINGS_FALLBACK, ...(frappe.boot?.kqs_retail_settings || {}) };
	}

	function is_layby_enabled_on_pos() {
		return cint(get_layby_settings().layby_enabled_on_pos) === 1;
	}

	function should_auto_print_layby_receipts() {
		return cint(get_layby_settings().auto_print_layby_receipts) === 1;
	}

	function refresh_layby_settings_from_server() {
		return frappe
			.call({ method: "kqs_retail.api.pos.get_kqs_retail_settings" })
			.then((r) => {
				if (r.message) {
					frappe.boot.kqs_retail_settings = {
						...(frappe.boot.kqs_retail_settings || {}),
						...r.message,
					};
				}
			})
			.catch((e) => {
				console.warn("Could not refresh KQS Retail Settings; using cached boot values.", e);
			});
	}

	function open_kqs_print_view(doctype, docname, print_format, letterhead) {
		if (!print_format || !docname) {
			return false;
		}
		frappe.utils.print(
			doctype,
			docname,
			print_format,
			letterhead || "",
			frappe.boot.lang
		);
		return true;
	}

	function email_kqs_receipt(doctype, docname, print_format, default_email) {
		if (!print_format || !docname) {
			frappe.msgprint(__("No print format configured for this receipt."));
			return;
		}

		const email_d = new frappe.ui.Dialog({
			title: __("Email Receipt"),
			fields: [
				{
					fieldname: "email_id",
					fieldtype: "Data",
					label: __("Email"),
					options: "Email",
					reqd: 1,
					default: default_email || "",
				},
				{
					fieldname: "content",
					fieldtype: "Small Text",
					label: __("Message"),
				},
			],
			primary_action_label: __("Send"),
			primary_action(values) {
				frappe.call({
					method: "frappe.core.doctype.communication.email.make",
					args: {
						recipients: values.email_id,
						subject: `${__(doctype)}: ${docname}`,
						content: values.content || `${__(doctype)}: ${docname}`,
						doctype,
						name: docname,
						send_email: 1,
						print_format,
						sender_full_name: frappe.user.full_name(),
					},
					callback(r) {
						if (!r.exc) {
							frappe.show_alert({
								message: __("Email queued"),
								indicator: "green",
							});
							email_d.hide();
						}
					},
				});
			},
		});
		email_d.show();
	}

	function get_layby_customer_email(agreement_name) {
		return frappe.db.get_value("Layby Agreement", agreement_name, "customer").then(({ message }) => {
			if (!message?.customer) return "";
			return frappe.db
				.get_value("Customer", message.customer, "email_id")
				.then(({ message: cust }) => cust?.email_id || "");
		});
	}

	function warn_missing_layby_print_formats(is_new_layby, is_complete) {
		const settings = get_layby_settings();
		const missing = [];
		if (!settings.layby_customer_print_format) {
			missing.push(__("Layby Customer Print Format"));
		}
		if (is_new_layby && !settings.layby_reserve_print_format) {
			missing.push(__("Layby Reserve Print Format"));
		}
		if (is_complete && !settings.layby_complete_print_format) {
			missing.push(__("Layby Complete Print Format"));
		}
		if (!missing.length) return;

		frappe.msgprint({
			title: __("Receipt formats not set"),
			message: __(
				"Open KQS Retail Settings → Layby Receipts and link: {0}. You can still reprint later from Layby Agreement.",
				[missing.join(", ")]
			),
			indicator: "orange",
		});
	}

	function show_layby_receipt_dialog(agreement_name, options = {}) {
		const { is_new_layby = false, is_complete = false, sales_invoice = "" } = options;
		const settings = get_layby_settings();
		const customer_fmt = settings.layby_customer_print_format;
		const reserve_fmt = settings.layby_reserve_print_format;
		const complete_fmt = settings.layby_complete_print_format;

		warn_missing_layby_print_formats(is_new_layby, is_complete);

		const d = new frappe.ui.Dialog({
			title: __("Layby {0}", [agreement_name]),
			fields: [
				{
					fieldname: "receipt_ui",
					fieldtype: "HTML",
				},
			],
			primary_action_label: __("New Order"),
			primary_action() {
				d.hide();
				const pos = window.cur_pos;
				if (pos?.load_new_invoice_on_pos) {
					pos.load_new_invoice_on_pos();
				}
			},
		});

		const buttons = [];
		if (customer_fmt) {
			buttons.push(
				`<button type="button" class="btn btn-primary btn-sm kqs-layby-print-customer">${__(
					"Print Customer Receipt"
				)}</button>`
			);
			buttons.push(
				`<button type="button" class="btn btn-default btn-sm kqs-layby-email-customer">${__(
					"Email Customer Receipt"
				)}</button>`
			);
		}
		if (is_new_layby && reserve_fmt) {
			buttons.push(
				`<button type="button" class="btn btn-default btn-sm kqs-layby-print-reserve">${__(
					"Print Reserve Slip"
				)}</button>`
			);
		}
		if (is_complete && complete_fmt && sales_invoice) {
			buttons.push(
				`<button type="button" class="btn btn-primary btn-sm kqs-layby-print-complete">${__(
					"Print Completion Receipt"
				)}</button>`
			);
		}

		const $ui = d.fields_dict.receipt_ui.$wrapper;
		$ui.html(`
			<p>${__("Layby saved successfully.")}</p>
			<p class="text-muted">${__(
				"Print or email receipts below — same as after a normal POS sale."
			)}</p>
			<div class="kqs-layby-receipt-actions" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem;">
				${buttons.join("") || `<p class="text-muted">${__("No receipt formats linked in KQS Retail Settings.")}</p>`}
			</div>
		`);

		$ui.find(".kqs-layby-print-customer").on("click", () => {
			open_kqs_print_view("Layby Agreement", agreement_name, customer_fmt);
		});
		$ui.find(".kqs-layby-print-reserve").on("click", () => {
			open_kqs_print_view("Layby Agreement", agreement_name, reserve_fmt);
		});
		$ui.find(".kqs-layby-print-complete").on("click", () => {
			open_kqs_print_view("Sales Invoice", sales_invoice, complete_fmt);
		});
		$ui.find(".kqs-layby-email-customer").on("click", async () => {
			const email = await get_layby_customer_email(agreement_name);
			email_kqs_receipt("Layby Agreement", agreement_name, customer_fmt, email);
		});

		d.show();

		if (should_auto_print_layby_receipts()) {
			if (customer_fmt) {
				open_kqs_print_view("Layby Agreement", agreement_name, customer_fmt);
			}
			if (is_new_layby && reserve_fmt) {
				setTimeout(() => open_kqs_print_view("Layby Agreement", agreement_name, reserve_fmt), 700);
			}
			if (is_complete && complete_fmt && sales_invoice) {
				setTimeout(() => open_kqs_print_view("Sales Invoice", sales_invoice, complete_fmt), 1400);
			}
		}
	}

	async function after_layby_created(agreement_name) {
		await refresh_layby_settings_from_server();
		show_layby_receipt_dialog(agreement_name, { is_new_layby: true });
	}

	async function after_layby_payment_recorded(result) {
		if (!result?.layby_agreement) return;
		await refresh_layby_settings_from_server();
		show_layby_receipt_dialog(result.layby_agreement, {
			is_new_layby: false,
			is_complete: result.status === "Completed",
			sales_invoice: result.sales_invoice || "",
		});
	}

	function get_pos_warehouse(frm) {
		return frm.doc.set_warehouse || (frm.doc.items && frm.doc.items[0]?.warehouse) || "";
	}

	function cart_lines_from_frm(frm) {
		return (frm.doc.items || []).map((row) => ({
			item_code: row.item_code,
			qty: row.qty,
			rate: row.rate,
		}));
	}

	function get_grand_total(frm) {
		const doc = frm.doc;
		return flt(
			cint(frappe.sys_defaults.disable_rounded_total) ? doc.grand_total : doc.rounded_total || doc.grand_total
		);
	}

	function is_walk_in_customer(frm) {
		if (!frm.doc.customer) return true;
		const name = (frm.doc.customer_name || frm.doc.customer || "").toLowerCase();
		return name.includes("walk-in") || name.includes("walk in");
	}

	function default_payment_mode(frm) {
		const payments = frm.doc.payments || [];
		const default_row = payments.find((row) => row.default);
		return default_row?.mode_of_payment || payments[0]?.mode_of_payment || "Cash";
	}

	function validate_cart_for_checkout(frm) {
		if (!frm.doc.items || !frm.doc.items.length) {
			frappe.msgprint(__("Add items to the cart before checkout."));
			return false;
		}
		return true;
	}

	async function reset_pos_payments(frm) {
		// Do not call reset_mode_of_payments on POS Invoice — ERPNext 16.x raises
		// AttributeError (is_created_using_pos). Zero tendered amounts client-side instead.
		const zero_ops = (frm.doc.payments || []).map(
			(row) => () => frappe.model.set_value(row.doctype, row.name, "amount", 0)
		);
		if (!zero_ops.length) return;

		await frappe.run_serially([
			...zero_ops,
			() => frm.set_value("paid_amount", 0),
			() => frm.set_value("change_amount", 0),
		]);

		if (!frm.is_dirty()) return;

		let save_error = false;
		await frm.save(null, null, null, () => (save_error = true));
		if (save_error) {
			throw new Error("Could not reset payment amounts");
		}
	}

	function sanitize_payment_mode_key(mode_of_payment) {
		return (mode_of_payment || "")
			.replace(/ +/g, "_")
			.replace(/[^\p{L}\p{N}_-]/gu, "")
			.replace(/^[^_a-zA-Z\p{L}]+/u, "")
			.toLowerCase();
	}

	function is_physical_cash_mode(mode_of_payment) {
		const name = String(mode_of_payment || "")
			.trim()
			.toLowerCase();
		return name === "cash";
	}

	function get_pos_payment_modes(frm) {
		const modes = (frm.doc.payments || []).map((row) => row.mode_of_payment).filter(Boolean);
		return modes.length ? modes : ["Cash"];
	}

	function inject_layby_dialog_styles() {
		if (document.getElementById("kqs-layby-dialog-styles-v5")) return;
		const style = document.createElement("style");
		style.id = "kqs-layby-dialog-styles-v5";
		style.textContent = `
			.modal.kqs-layby-dialog .modal-dialog {
				max-width: min(820px, 96vw);
				width: min(820px, 96vw);
				margin: 1rem auto;
			}
			.modal.kqs-layby-dialog .modal-content {
				max-height: calc(100vh - 2rem);
				display: flex;
				flex-direction: column;
			}
			.modal.kqs-layby-dialog .modal-body {
				padding: 1rem 1.25rem 0.35rem;
				overflow-y: auto;
				flex: 1 1 auto;
			}
			.modal.kqs-layby-dialog .modal-footer {
				padding: 0.75rem 1.25rem;
				flex-shrink: 0;
			}
			.kqs-layby-dialog-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 0.85rem 1rem;
			}
			.kqs-layby-customer-card {
				grid-column: 1 / -1;
				padding: 0.55rem 0.75rem;
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: var(--border-radius-md, 8px);
				background: var(--fg-color, #f9fafb);
			}
			.kqs-layby-customer-card .label {
				font-size: var(--text-xs, 11px);
				color: var(--text-muted, #6b7280);
				margin-bottom: 0.15rem;
			}
			.kqs-layby-customer-card .value {
				font-size: var(--text-md, 13px);
				font-weight: 600;
				color: var(--text-color, #171717);
			}
			.kqs-layby-summary {
				grid-column: 1 / -1;
				display: grid;
				grid-template-columns: repeat(4, minmax(0, 1fr));
				gap: 0.55rem;
			}
			.kqs-layby-summary-card {
				background: var(--fg-color, #f9fafb);
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: var(--border-radius-md, 8px);
				padding: 0.55rem 0.65rem;
			}
			.kqs-layby-summary-card .label {
				font-size: var(--text-xs, 11px);
				color: var(--text-muted, #6b7280);
				margin-bottom: 0.2rem;
			}
			.kqs-layby-summary-card .value {
				font-size: var(--text-md, 13px);
				font-weight: 600;
				color: var(--text-color, #171717);
			}
			.kqs-layby-deposit-hero {
				grid-column: 1 / -1;
				text-align: center;
				padding: 0.75rem 1rem;
				border: 2px solid #000;
				border-radius: var(--border-radius-md, 8px);
				background: var(--card-bg, #fff);
			}
			.kqs-layby-deposit-hero .hero-label {
				font-size: var(--text-sm, 12px);
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--text-muted, #6b7280);
				margin-bottom: 0.3rem;
			}
			.kqs-layby-deposit-hero .hero-amount {
				font-size: 2rem;
				font-weight: 800;
				line-height: 1.1;
				color: var(--text-color, #171717);
			}
			.kqs-layby-deposit-hero .hero-hint {
				margin-top: 0.35rem;
				font-size: var(--text-sm, 12px);
				color: var(--text-muted, #6b7280);
			}
			.kqs-layby-deposit-hero.kqs-layby-deposit-low .hero-amount {
				color: var(--red-600, #dc2626);
			}
			.kqs-layby-checkout-row {
				grid-column: 1 / -1;
				display: grid;
				grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
				gap: 0.85rem 1rem;
				align-items: start;
			}
			.kqs-layby-payment-panel {
				display: flex;
				flex-direction: column;
				min-height: 0;
			}
			.kqs-layby-payment-hint {
				margin: 0 0 0.55rem;
				font-size: var(--text-sm, 12px);
				color: var(--text-muted, #6b7280);
				line-height: 1.35;
			}
			.kqs-layby-payment-modes {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 0.55rem;
			}
			.kqs-layby-mop-wrapper.is-selected .kqs-layby-mop-tile {
				border-color: #000;
				box-shadow: 0 0 0 1px #000;
			}
			.kqs-layby-mop-tile {
				width: 100%;
				min-height: 3.5rem;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 0.2rem;
				padding: 0.5rem 0.4rem;
				border-radius: var(--border-radius-md, 8px);
				border: 2px solid var(--border-color, #d1d5db);
				background: var(--card-bg, #fff);
				font-size: var(--text-base, 13px);
				font-weight: 600;
				cursor: pointer;
				transition: border-color 0.12s ease, box-shadow 0.12s ease;
			}
			.kqs-layby-mop-tile:hover {
				border-color: var(--gray-500, #6b7280);
			}
			.kqs-layby-mop-wrapper.is-selected .kqs-layby-mop-tile .mop-amount {
				display: none;
			}
			.kqs-layby-mop-tile .mop-amount {
				font-size: var(--text-md, 13px);
				font-weight: 700;
			}
			.kqs-layby-mop-control {
				display: none;
				margin-top: 0.35rem;
			}
			.kqs-layby-mop-wrapper.is-selected .kqs-layby-mop-control {
				display: block;
			}
			.kqs-layby-mop-control .frappe-control {
				margin: 0;
			}
			.kqs-layby-mop-control .control-input {
				min-height: 2.25rem;
			}
			.kqs-layby-mop-tendered,
			.kqs-layby-mop-change {
				display: none;
				margin-top: 0.35rem;
			}
			.kqs-layby-mop-wrapper.is-cash-mode.is-selected .kqs-layby-mop-tendered,
			.kqs-layby-mop-wrapper.is-cash-mode.is-selected .kqs-layby-mop-change {
				display: block;
			}
			.kqs-layby-mop-change {
				padding: 0.45rem 0.55rem;
				border-radius: var(--border-radius-md, 8px);
				background: var(--fg-color, #f9fafb);
				border: 1px solid var(--border-color, #e5e7eb);
			}
			.kqs-layby-mop-change .label {
				display: block;
				font-size: var(--text-xs, 11px);
				color: var(--text-muted, #6b7280);
				margin-bottom: 0.15rem;
			}
			.kqs-layby-mop-change .value {
				font-size: 1.15rem;
				font-weight: 800;
				color: var(--text-color, #171717);
			}
			.kqs-layby-summary-card.kqs-layby-change-card {
				display: none;
			}
			.kqs-layby-summary-card.kqs-layby-change-card.is-visible {
				display: block;
				border-color: #000;
			}
			.kqs-layby-numpad-panel {
				display: flex;
				flex-direction: column;
			}
			.kqs-layby-numpad-panel .number-pad {
				position: static;
				flex: 1;
				display: block;
				width: 100%;
			}
			.kqs-layby-numpad-panel .numpad-container {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 0.5rem;
				width: 100%;
				background-color: var(--fg-color, #f9fafb);
				border: 1px solid var(--border-color, #e5e7eb);
				border-radius: var(--border-radius-md, 8px);
				padding: 0.45rem;
			}
			.kqs-layby-numpad-panel .numpad-btn {
				display: flex;
				align-items: center;
				justify-content: center;
				min-height: 2.75rem;
				padding: 0.45rem;
				border-radius: var(--border-radius-md, 8px);
				border: 1px solid var(--border-color, #e5e7eb);
				background: var(--card-bg, #fff);
				box-shadow: var(--shadow-base, 0 1px 2px rgba(0, 0, 0, 0.06));
				font-size: var(--text-md, 13px);
				font-weight: 600;
				cursor: pointer;
				user-select: none;
			}
			.kqs-layby-numpad-panel .numpad-btn:hover {
				background-color: var(--control-bg, #f3f4f6);
			}
			.modal.kqs-layby-dialog .modal-footer .btn-primary {
				min-height: 3rem;
				min-width: 10.5rem;
				padding: 0.65rem 1.75rem;
				font-size: var(--text-md, 13px);
				font-weight: 700;
			}
			@media (max-width: 680px) {
				.kqs-layby-summary {
					grid-template-columns: repeat(2, minmax(0, 1fr));
				}
				.kqs-layby-checkout-row {
					grid-template-columns: 1fr;
				}
			}
			/* Record Layby Payment — compact, no-scroll layout */
			.modal.kqs-layby-pay-dialog .modal-body {
				padding: 0.55rem 0.85rem 0.2rem;
				overflow-y: hidden;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-dialog-grid {
				gap: 0.4rem 0.55rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-customer-card {
				padding: 0.3rem 0.55rem;
				display: flex;
				align-items: baseline;
				gap: 0.45rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-customer-card .label {
				margin: 0;
				flex-shrink: 0;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-customer-card .value {
				font-size: var(--text-sm, 12px);
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-summary {
				gap: 0.35rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-summary-card {
				padding: 0.3rem 0.45rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-summary-card .value {
				font-size: var(--text-sm, 12px);
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-payment-hint {
				margin: 0 0 0.3rem;
				font-size: 11px;
				line-height: 1.3;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-payment-modes {
				grid-template-columns: repeat(4, minmax(0, 1fr));
				gap: 0.35rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-mop-tile {
				min-height: 2.1rem;
				padding: 0.25rem 0.2rem;
				font-size: 11px;
				border-width: 1px;
				gap: 0.05rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-mop-tile .mop-amount {
				font-size: 10px;
				font-weight: 700;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-mop-control,
			.modal.kqs-layby-pay-dialog .kqs-layby-mop-tendered,
			.modal.kqs-layby-pay-dialog .kqs-layby-mop-change {
				display: none !important;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-panel {
				grid-column: 1 / -1;
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 0.45rem;
				padding: 0.45rem 0.55rem;
				border: 2px solid #171717;
				border-radius: var(--border-radius-md, 8px);
				background: var(--card-bg, #fff);
				min-height: 4.5rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-panel.is-cash-active {
				grid-template-columns: 1fr 1fr minmax(5rem, 0.75fr);
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-panel:not(.is-cash-active) {
				grid-template-columns: 1fr;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-placeholder {
				grid-column: 1 / -1;
				align-self: center;
				text-align: center;
				font-size: var(--text-sm, 12px);
				color: var(--text-muted, #6b7280);
				padding: 0.35rem 0;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-field .frappe-control {
				margin: 0;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-field .control-label {
				font-size: 10px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--text-color, #171717);
				margin-bottom: 0.2rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-field .control-input {
				min-height: 2.65rem !important;
				font-size: 1.2rem !important;
				font-weight: 700 !important;
				border: 2px solid var(--border-color, #d1d5db) !important;
				border-radius: var(--border-radius-md, 8px) !important;
				background: var(--fg-color, #f9fafb) !important;
				text-align: center;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-field.is-active .control-input {
				border-color: #171717 !important;
				background: var(--card-bg, #fff) !important;
				box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.06);
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-tendered {
				display: none;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-panel.is-cash-active .kqs-layby-entry-tendered {
				display: block;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-change {
				display: none;
				flex-direction: column;
				justify-content: center;
				padding: 0.2rem 0.35rem;
				border-radius: var(--border-radius-md, 8px);
				background: var(--fg-color, #f9fafb);
				border: 1px solid var(--border-color, #e5e7eb);
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-panel.is-cash-active .kqs-layby-entry-change {
				display: flex;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-change .label {
				font-size: 10px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--text-muted, #6b7280);
				margin-bottom: 0.15rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-entry-change .value {
				font-size: 1.05rem;
				font-weight: 800;
				color: var(--text-color, #171717);
				line-height: 1.1;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-checkout-row {
				gap: 0.45rem 0.55rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-numpad-panel .numpad-container {
				padding: 0.3rem;
				gap: 0.35rem;
			}
			.modal.kqs-layby-pay-dialog .kqs-layby-numpad-panel .numpad-btn {
				min-height: 2.1rem;
				padding: 0.25rem;
				font-size: var(--text-sm, 12px);
			}
			.modal.kqs-layby-pay-dialog .modal-footer .btn-primary {
				min-height: 2.5rem;
				padding: 0.45rem 1.25rem;
			}
			@media (max-width: 680px) {
				.modal.kqs-layby-pay-dialog .kqs-layby-payment-modes {
					grid-template-columns: repeat(2, minmax(0, 1fr));
				}
				.modal.kqs-layby-pay-dialog .kqs-layby-entry-panel.is-cash-active {
					grid-template-columns: 1fr 1fr;
				}
				.modal.kqs-layby-pay-dialog .kqs-layby-entry-change {
					grid-column: 1 / -1;
				}
			}
		`;
		document.head.appendChild(style);
	}

	function show_create_layby_dialog(frm) {
		if (!is_layby_enabled_on_pos()) {
			frappe.msgprint(__("Layby is disabled in KQS Retail Settings."));
			return;
		}
		if (!validate_cart_for_checkout(frm)) return;
		if (!frm.doc.customer || is_walk_in_customer(frm)) {
			frappe.msgprint(__("Select a customer before creating a layby."));
			return;
		}

		const warehouse = get_pos_warehouse(frm);
		if (!warehouse) {
			frappe.msgprint(__("Warehouse is not set on this POS session."));
			return;
		}

		inject_layby_dialog_styles();

		const currency = frm.doc.currency;
		const total = get_grand_total(frm);
		const layby_settings = get_layby_settings();
		const deposit_percent = flt(layby_settings.minimum_deposit_percent);
		const min_deposit = flt((total * deposit_percent) / 100);
		const due_date = frappe.datetime.add_days(
			frappe.datetime.get_today(),
			cint(layby_settings.maximum_term_days)
		);
		const payment_modes = get_pos_payment_modes(frm);
		const amounts = Object.fromEntries(payment_modes.map((mode) => [mode, 0]));
		const mode_controls = {};
		let selected_mode = null;
		let numpad_value = "";

		const d = new frappe.ui.Dialog({
			title: __("Create Layby"),
			fields: [
				{
					fieldname: "layby_ui",
					fieldtype: "HTML",
				},
			],
			primary_action_label: __("Create Layby"),
			primary_action() {
				const deposit = total_deposit();
				if (deposit < min_deposit) {
					frappe.msgprint(
						__("Deposit must be at least {0} ({1}%).", [
							format_currency(min_deposit, currency),
							deposit_percent,
						])
					);
					return;
				}

				const payment_lines = payment_modes
					.filter((mode) => flt(amounts[mode]) > 0)
					.map((mode) => ({ mode_of_payment: mode, amount: flt(amounts[mode]) }));

				frappe.call({
					method: "kqs_retail.api.create_layby_from_cart",
					args: {
						customer: frm.doc.customer,
						company: frm.doc.company,
						warehouse,
						items: JSON.stringify(cart_lines_from_frm(frm)),
						deposit_paid: deposit,
						pos_profile: frm.doc.pos_profile,
						deposit_percent,
						payments: JSON.stringify(payment_lines),
					},
					freeze: true,
					callback(r) {
						if (!r.exc && r.message) {
							frappe.show_alert({
								message: __("Layby {0} created.", [r.message.name]),
								indicator: "green",
							});
							d.hide();
							after_layby_created(r.message.name);
						}
					},
				});
			},
		});

		d.$wrapper.addClass("kqs-layby-dialog");

		const customer_label = frappe.utils.escape_html(
			frm.doc.customer_name || frm.doc.customer || ""
		);

		const $ui = d.fields_dict.layby_ui.$wrapper;
		$ui.html(`
			<div class="kqs-layby-dialog-grid">
				<div class="kqs-layby-customer-card">
					<div class="label">${__("Customer")}</div>
					<div class="value">${customer_label}</div>
				</div>
				<div class="kqs-layby-summary">
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Layby Total")}</div>
						<div class="value kqs-layby-total">${format_currency(total, currency)}</div>
					</div>
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Minimum Deposit ({0}%)", [deposit_percent])}</div>
						<div class="value kqs-layby-min">${format_currency(min_deposit, currency)}</div>
					</div>
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Balance After Deposit")}</div>
						<div class="value kqs-layby-balance">${format_currency(total - min_deposit, currency)}</div>
					</div>
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Due Date")}</div>
						<div class="value">${frappe.datetime.str_to_user(due_date)}</div>
					</div>
				</div>
				<div class="kqs-layby-deposit-hero">
					<div class="hero-label">${__("Deposit Received")}</div>
					<div class="hero-amount kqs-layby-deposit-display">${format_currency(0, currency)}</div>
					<div class="hero-hint kqs-layby-deposit-hint">${__(
						"Enter amounts below — minimum {0}",
						[format_currency(min_deposit, currency)]
					)}</div>
				</div>
				<div class="kqs-layby-checkout-row">
					<div class="kqs-layby-payment-panel">
						<p class="kqs-layby-payment-hint">${__(
							"Tap a payment method, type or use the keypad, then tap another for split payments."
						)}</p>
						<div class="kqs-layby-payment-modes">
							${payment_modes
								.map((mode) => {
									const key = sanitize_payment_mode_key(mode);
									return `<div class="kqs-layby-mop-wrapper" data-mode-key="${key}">
										<button type="button" class="kqs-layby-mop-tile" data-mode-key="${key}">
											<span class="mop-label">${frappe.utils.escape_html(mode)}</span>
											<span class="mop-amount" data-mop-amount="${key}"></span>
										</button>
										<div class="kqs-layby-mop-control" data-mode-key="${key}"></div>
									</div>`;
								})
								.join("")}
						</div>
					</div>
					<div class="kqs-layby-numpad-panel">
						<div class="kqs-layby-numpad number-pad"></div>
					</div>
				</div>
			</div>
		`);

		function total_deposit() {
			return payment_modes.reduce((sum, mode) => sum + flt(amounts[mode]), 0);
		}

		function refresh_layby_amounts_ui() {
			const deposit = total_deposit();
			$ui.find(".kqs-layby-deposit-display").text(format_currency(deposit, currency));
			$ui.find(".kqs-layby-balance").text(format_currency(Math.max(total - deposit, 0), currency));
			$ui.find(".kqs-layby-deposit-hero").toggleClass(
				"kqs-layby-deposit-low",
				deposit > 0 && deposit < min_deposit
			);

			payment_modes.forEach((mode) => {
				const key = sanitize_payment_mode_key(mode);
				const amt = flt(amounts[mode]);
				const $amt = $ui.find(`[data-mop-amount="${key}"]`);
				$amt.text(amt > 0 ? format_currency(amt, currency) : "");
			});
		}

		function get_mode_from_key(key) {
			return payment_modes.find((mode) => sanitize_payment_mode_key(mode) === key) || null;
		}

		function select_payment_mode(mode) {
			const key = sanitize_payment_mode_key(mode);
			if (selected_mode === mode) {
				selected_mode = null;
				numpad_value = "";
				$ui.find(".kqs-layby-mop-wrapper").removeClass("is-selected");
				return;
			}

			selected_mode = mode;
			numpad_value = amounts[mode] ? String(amounts[mode]) : "";
			$ui.find(".kqs-layby-mop-wrapper").removeClass("is-selected");
			$ui.find(`.kqs-layby-mop-wrapper[data-mode-key="${key}"]`).addClass("is-selected");

			const control = mode_controls[mode];
			if (control?.$input?.length) {
				control.$input.get(0).focus();
				control.$input.get(0).select?.();
			}
		}

		function on_numpad_clicked($btn) {
			if (!selected_mode || !mode_controls[selected_mode]) {
				frappe.show_alert({
					message: __("Select a payment method first."),
					indicator: "yellow",
				});
				return;
			}

			const button_value = $btn.attr("data-button-value");
			if (button_value === "delete" || button_value === "Delete") {
				numpad_value = numpad_value.slice(0, -1);
			} else {
				numpad_value = numpad_value + button_value;
			}

			const control = mode_controls[selected_mode];
			control.$input.get(0).focus();
			control.set_value(numpad_value);
			frappe.utils.play_sound("numpad-touch");
		}

		payment_modes.forEach((mode) => {
			const key = sanitize_payment_mode_key(mode);
			mode_controls[mode] = frappe.ui.form.make_control({
				df: {
					label: mode,
					fieldtype: "Currency",
					placeholder: __("Enter {0} amount.", [mode]),
					onchange() {
						amounts[mode] = flt(this.value);
						if (selected_mode === mode) {
							numpad_value = this.value ? String(this.value) : "";
						}
						refresh_layby_amounts_ui();
					},
				},
				parent: $ui.find(`.kqs-layby-mop-control[data-mode-key="${key}"]`),
				render_input: true,
			});
			mode_controls[mode].toggle_label(false);
			mode_controls[mode].$input.on("focus", () => {
				if (selected_mode === mode) return;
				const key = sanitize_payment_mode_key(mode);
				selected_mode = mode;
				numpad_value = amounts[mode] ? String(amounts[mode]) : "";
				$ui.find(".kqs-layby-mop-wrapper").removeClass("is-selected");
				$ui.find(`.kqs-layby-mop-wrapper[data-mode-key="${key}"]`).addClass("is-selected");
			});
		});

		$ui.find(".kqs-layby-mop-tile").on("click", function () {
			const key = $(this).attr("data-mode-key");
			const mode = get_mode_from_key(key);
			if (mode) select_payment_mode(mode);
		});

		if (window.erpnext?.PointOfSale?.NumberPad) {
			new erpnext.PointOfSale.NumberPad({
				wrapper: $ui.find(".kqs-layby-numpad"),
				events: {
					numpad_event($btn) {
						on_numpad_clicked($btn);
					},
				},
				cols: 3,
				keys: [
					[1, 2, 3],
					[4, 5, 6],
					[7, 8, 9],
					[".", 0, "Delete"],
				],
			});
		}

		d.show();
		refresh_layby_amounts_ui();
	}

	function show_layby_lookup_dialog(frm) {
		const warehouse = get_pos_warehouse(frm);
		const d = new frappe.ui.Dialog({
			title: __("Layby Lookup & Pay"),
			size: "large",
			fields: [
				{
					fieldname: "query",
					fieldtype: "Data",
					label: __("Search"),
					description: __("Agreement number or customer name"),
				},
				{
					fieldname: "results_html",
					fieldtype: "HTML",
				},
			],
		});

		function render_results(rows) {
			if (!rows || !rows.length) {
				d.fields_dict.results_html.$wrapper.html(
					`<p class="text-muted">${__("No active laybys found.")}</p>`
				);
				return;
			}
			const html = rows
				.map((row) => {
					const balance = format_currency(
						row.balance_amount,
						frappe.defaults.get_default("currency")
					);
					return `<div class="kqs-layby-row flex justify-between align-center mb-2 p-2 border rounded">
						<div>
							<strong>${frappe.utils.escape_html(row.name)}</strong>
							— ${frappe.utils.escape_html(row.customer_name || "")}
							<br><span class="text-muted">${__("Balance")}: ${balance}</span>
						</div>
						<button class="btn btn-primary btn-sm kqs-layby-pay" data-name="${frappe.utils.escape_html(
							row.name
						)}" data-balance="${row.balance_amount}">
							${__("Pay")}
						</button>
					</div>`;
				})
				.join("");
			d.fields_dict.results_html.$wrapper.html(html);
			d.fields_dict.results_html.$wrapper.find(".kqs-layby-pay").on("click", function () {
				const name = $(this).data("name");
				const balance = $(this).data("balance");
				show_layby_payment_dialog(frm, name, balance, () => search());
			});
		}

		function search() {
			frappe.call({
				method: "kqs_retail.api.search_layby_agreements",
				args: {
					query: d.get_value("query") || "",
					warehouse,
					limit: 30,
				},
				callback(r) {
					if (!r.exc) render_results(r.message);
				},
			});
		}

		d.fields_dict.query.$input.on("keyup", frappe.utils.debounce(search, 300));
		d.show();
		search();
	}

	function show_layby_payment_dialog(frm, agreement, balance, on_success) {
		inject_layby_dialog_styles();

		const currency = frm.doc.currency || frappe.defaults.get_default("currency");
		const balance_due = flt(balance);
		const payment_modes = get_pos_payment_modes(frm);
		const amounts = Object.fromEntries(payment_modes.map((mode) => [mode, 0]));
		const tendered = Object.fromEntries(payment_modes.map((mode) => [mode, 0]));
		let paying_control = null;
		let tendered_control = null;
		let selected_mode = null;
		let numpad_target = "paying";
		let numpad_value = "";

		const pay_d = new frappe.ui.Dialog({
			title: __("Record Layby Payment"),
			fields: [
				{
					fieldname: "layby_ui",
					fieldtype: "HTML",
				},
			],
			primary_action_label: __("Record Payment"),
			primary_action() {
				sync_controls_to_state();
				const payment_total = total_payment();
				if (payment_total <= 0) {
					frappe.msgprint(__("Enter how much is being paid toward the layby."));
					return;
				}
				if (payment_total > balance_due) {
					frappe.msgprint(
						__("Payment ({0}) exceeds balance ({1}).", [
							format_currency(payment_total, currency),
							format_currency(balance_due, currency),
						])
					);
					return;
				}

				const cash_mode = get_physical_cash_mode();
				if (cash_mode && flt(amounts[cash_mode]) > 0) {
					const cash_paying = flt(amounts[cash_mode]);
					const cash_given = flt(tendered[cash_mode]);
					if (cash_given <= 0) {
						frappe.msgprint(__("Enter how much cash the customer gave."));
						return;
					}
					if (cash_given < cash_paying) {
						frappe.msgprint(
							__("Customer gave ({0}) is less than the cash payment ({1}).", [
								format_currency(cash_given, currency),
								format_currency(cash_paying, currency),
							])
						);
						return;
					}
				}

				const payment_lines = payment_modes
					.filter((mode) => flt(amounts[mode]) > 0)
					.map((mode) => ({ mode_of_payment: mode, amount: flt(amounts[mode]) }));

				frappe.call({
					method: "kqs_retail.api.record_layby_payment",
					args: {
						layby_agreement: agreement,
						payments: JSON.stringify(payment_lines),
						amount: payment_total,
					},
					freeze: true,
					callback(r) {
						if (!r.exc) {
							const change = cash_change();
							let message = __("Payment recorded for {0}.", [agreement]);
							if (change > 0) {
								message = __("Payment recorded for {0}. Change: {1}", [
									agreement,
									format_currency(change, currency),
								]);
							}
							frappe.show_alert({
								message,
								indicator: "green",
							});
							pay_d.hide();
							after_layby_payment_recorded(r.message);
							if (on_success) on_success();
						}
					},
				});
			},
		});

		pay_d.$wrapper.addClass("kqs-layby-dialog kqs-layby-pay-dialog");

		const agreement_label = frappe.utils.escape_html(agreement);
		const $ui = pay_d.fields_dict.layby_ui.$wrapper;
		$ui.html(`
			<div class="kqs-layby-dialog-grid">
				<div class="kqs-layby-customer-card">
					<div class="label">${__("Layby Agreement")}</div>
					<div class="value">${agreement_label}</div>
				</div>
				<div class="kqs-layby-summary">
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Balance Due")}</div>
						<div class="value kqs-layby-balance-due">${format_currency(balance_due, currency)}</div>
					</div>
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Paying Today")}</div>
						<div class="value kqs-layby-paying-today">${format_currency(0, currency)}</div>
					</div>
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Remaining")}</div>
						<div class="value kqs-layby-remaining">${format_currency(balance_due, currency)}</div>
					</div>
					<div class="kqs-layby-summary-card kqs-layby-change-card">
						<div class="label">${__("Change")}</div>
						<div class="value kqs-layby-change-summary">${format_currency(0, currency)}</div>
					</div>
				</div>
				<div class="kqs-layby-entry-panel">
					<p class="kqs-layby-entry-placeholder">${__(
						"Select a payment method, then enter amounts below."
					)}</p>
					<div class="kqs-layby-entry-field kqs-layby-entry-paying"></div>
					<div class="kqs-layby-entry-field kqs-layby-entry-tendered"></div>
					<div class="kqs-layby-entry-change">
						<span class="label">${__("Change")}</span>
						<span class="value kqs-layby-entry-change-amount">${format_currency(0, currency)}</span>
					</div>
				</div>
				<div class="kqs-layby-checkout-row">
					<div class="kqs-layby-payment-panel">
						<p class="kqs-layby-payment-hint">${__(
							"Tap a method for split payments. Cash only: enter paying amount and what the customer gave."
						)}</p>
						<div class="kqs-layby-payment-modes">
							${payment_modes
								.map((mode) => {
									const key = sanitize_payment_mode_key(mode);
									return `<div class="kqs-layby-mop-wrapper" data-mode-key="${key}">
										<button type="button" class="kqs-layby-mop-tile" data-mode-key="${key}">
											<span class="mop-label">${frappe.utils.escape_html(mode)}</span>
											<span class="mop-amount" data-mop-amount="${key}"></span>
										</button>
									</div>`;
								})
								.join("")}
						</div>
					</div>
					<div class="kqs-layby-numpad-panel">
						<div class="kqs-layby-numpad number-pad"></div>
					</div>
				</div>
			</div>
		`);

		const $entry_panel = $ui.find(".kqs-layby-entry-panel");
		const $entry_placeholder = $ui.find(".kqs-layby-entry-placeholder");
		const $entry_paying = $ui.find(".kqs-layby-entry-paying");
		const $entry_tendered = $ui.find(".kqs-layby-entry-tendered");

		function get_physical_cash_mode() {
			return payment_modes.find((mode) => is_physical_cash_mode(mode)) || null;
		}

		function total_payment() {
			return payment_modes.reduce((sum, mode) => sum + flt(amounts[mode]), 0);
		}

		function cash_change() {
			const cash_mode = get_physical_cash_mode();
			if (!cash_mode) return 0;
			const paying = flt(amounts[cash_mode]);
			const gave = flt(tendered[cash_mode]);
			if (paying <= 0 || gave <= 0) return 0;
			return Math.max(gave - paying, 0);
		}

		function sync_controls_to_state() {
			if (!selected_mode) return;
			if (paying_control) {
				amounts[selected_mode] = flt(paying_control.get_value());
			}
			if (tendered_control && is_physical_cash_mode(selected_mode)) {
				tendered[selected_mode] = flt(tendered_control.get_value());
			}
		}

		function update_entry_focus_styles() {
			$entry_paying.toggleClass("is-active", !!selected_mode && numpad_target === "paying");
			$entry_tendered.toggleClass("is-active", !!selected_mode && numpad_target === "tendered");
		}

		function refresh_payment_ui() {
			const payment_total = total_payment();
			const change = cash_change();
			$ui.find(".kqs-layby-paying-today").text(format_currency(payment_total, currency));
			$ui.find(".kqs-layby-remaining").text(
				format_currency(Math.max(balance_due - payment_total, 0), currency)
			);
			$ui.find(".kqs-layby-change-summary").text(format_currency(change, currency));
			$ui.find(".kqs-layby-entry-change-amount").text(format_currency(change, currency));
			$ui.find(".kqs-layby-change-card").toggleClass("is-visible", change > 0);

			payment_modes.forEach((mode) => {
				const key = sanitize_payment_mode_key(mode);
				const amt = flt(amounts[mode]);
				$ui.find(`[data-mop-amount="${key}"]`).text(
					amt > 0 ? format_currency(amt, currency) : ""
				);
			});
			update_entry_focus_styles();
		}

		function refresh_entry_panel() {
			const is_cash = selected_mode && is_physical_cash_mode(selected_mode);
			$entry_panel.toggleClass("is-cash-active", !!is_cash);
			$entry_placeholder.toggle(!selected_mode);
			$entry_paying.toggle(!!selected_mode);
			update_entry_focus_styles();
		}

		function get_mode_from_key(key) {
			return payment_modes.find((mode) => sanitize_payment_mode_key(mode) === key) || null;
		}

		function get_active_control() {
			if (!selected_mode) return null;
			if (numpad_target === "tendered" && tendered_control && is_physical_cash_mode(selected_mode)) {
				return tendered_control;
			}
			return paying_control;
		}

		function load_controls_for_mode(mode) {
			paying_control?.set_value(amounts[mode] || "");
			if (is_physical_cash_mode(mode)) {
				tendered_control?.set_value(tendered[mode] || "");
			}
			refresh_entry_panel();
			refresh_payment_ui();
		}

		function select_payment_mode(mode) {
			const key = sanitize_payment_mode_key(mode);
			if (selected_mode === mode) {
				sync_controls_to_state();
				selected_mode = null;
				numpad_target = "paying";
				numpad_value = "";
				$ui.find(".kqs-layby-mop-wrapper").removeClass("is-selected");
				refresh_entry_panel();
				return;
			}

			sync_controls_to_state();
			selected_mode = mode;
			numpad_target = "paying";
			numpad_value = amounts[mode] ? String(amounts[mode]) : "";
			$ui.find(".kqs-layby-mop-wrapper").removeClass("is-selected");
			$ui.find(`.kqs-layby-mop-wrapper[data-mode-key="${key}"]`).addClass("is-selected");
			load_controls_for_mode(mode);

			if (paying_control?.$input?.length) {
				paying_control.$input.get(0).focus();
				paying_control.$input.get(0).select?.();
			}
		}

		function focus_numpad_target(target) {
			if (!selected_mode) return;
			sync_controls_to_state();
			numpad_target = target;
			if (target === "tendered" && is_physical_cash_mode(selected_mode)) {
				numpad_value = tendered[selected_mode] ? String(tendered[selected_mode]) : "";
				if (tendered_control?.$input?.length) {
					tendered_control.$input.get(0).focus();
					tendered_control.$input.get(0).select?.();
				}
			} else {
				numpad_target = "paying";
				numpad_value = amounts[selected_mode] ? String(amounts[selected_mode]) : "";
				if (paying_control?.$input?.length) {
					paying_control.$input.get(0).focus();
					paying_control.$input.get(0).select?.();
				}
			}
			update_entry_focus_styles();
		}

		function on_numpad_clicked($btn) {
			if (!selected_mode) {
				frappe.show_alert({
					message: __("Select a payment method first."),
					indicator: "yellow",
				});
				return;
			}

			const control = get_active_control();
			if (!control) {
				frappe.show_alert({
					message: __("Select a payment method first."),
					indicator: "yellow",
				});
				return;
			}

			const button_value = $btn.attr("data-button-value");
			if (button_value === "delete" || button_value === "Delete") {
				numpad_value = numpad_value.slice(0, -1);
			} else {
				numpad_value = numpad_value + button_value;
			}

			control.$input.get(0).focus();
			control.set_value(numpad_value);
			frappe.utils.play_sound("numpad-touch");
		}

		paying_control = frappe.ui.form.make_control({
			df: {
				label: __("Paying"),
				fieldtype: "Currency",
				placeholder: __("Amount toward layby"),
				onchange() {
					if (!selected_mode) return;
					amounts[selected_mode] = flt(this.value);
					if (numpad_target === "paying") {
						numpad_value = this.value ? String(this.value) : "";
					}
					refresh_payment_ui();
				},
			},
			parent: $entry_paying,
			render_input: true,
		});
		paying_control.toggle_label(true);
		paying_control.$input.on("focus", () => focus_numpad_target("paying"));

		tendered_control = frappe.ui.form.make_control({
			df: {
				label: __("Customer Gave"),
				fieldtype: "Currency",
				placeholder: __("Cash received"),
				onchange() {
					if (!selected_mode || !is_physical_cash_mode(selected_mode)) return;
					tendered[selected_mode] = flt(this.value);
					if (numpad_target === "tendered") {
						numpad_value = this.value ? String(this.value) : "";
					}
					refresh_payment_ui();
				},
			},
			parent: $entry_tendered,
			render_input: true,
		});
		tendered_control.toggle_label(true);
		tendered_control.$input.on("focus", () => focus_numpad_target("tendered"));

		$ui.find(".kqs-layby-mop-tile").on("click", function () {
			const key = $(this).attr("data-mode-key");
			const mode = get_mode_from_key(key);
			if (mode) select_payment_mode(mode);
		});

		if (window.erpnext?.PointOfSale?.NumberPad) {
			new erpnext.PointOfSale.NumberPad({
				wrapper: $ui.find(".kqs-layby-numpad"),
				events: {
					numpad_event($btn) {
						on_numpad_clicked($btn);
					},
				},
				cols: 3,
				keys: [
					[1, 2, 3],
					[4, 5, 6],
					[7, 8, 9],
					[".", 0, "Delete"],
				],
			});
		}

		refresh_entry_panel();
		pay_d.show();
		refresh_payment_ui();
	}

	function inject_cart_layby_styles() {
		if (document.getElementById("kqs-pos-cart-layby-styles")) return;
		const style = document.createElement("style");
		style.id = "kqs-pos-cart-layby-styles";
		style.textContent = `
			/* Wrapper replaces direct-child slot — restore ERPNext primary-action row */
			.point-of-sale-app .cart-totals-section > .kqs-cart-actions {
				display: flex;
				align-items: stretch;
				gap: 0.5rem;
				width: 100%;
				margin-top: var(--margin-sm);
			}
			/* Match ERPNext .primary-action + .cart-totals-section > .checkout-btn */
			.point-of-sale-app .cart-totals-section > .kqs-cart-actions > .checkout-btn {
				flex: 1 1 auto;
				min-width: 0;
				margin-top: 0;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: var(--padding-sm);
				border-radius: var(--border-radius-md);
				font-size: var(--text-lg);
				font-weight: 700;
				line-height: 1.25;
				cursor: pointer;
				user-select: none;
				-webkit-user-select: none;
				background-color: var(--control-bg);
			}
			.point-of-sale-app .cart-totals-section > .kqs-cart-actions > .${LAYBY_BTN_CLASS} {
				flex: 0 0 28%;
				max-width: 30%;
				align-self: stretch;
				display: flex;
				align-items: center;
				justify-content: center;
				margin: 0;
				padding: var(--padding-sm) 0.35rem;
				border-radius: var(--border-radius-md);
				font-size: var(--text-sm, 12px);
				font-weight: 600;
				line-height: 1.25;
				cursor: pointer;
				user-select: none;
				-webkit-user-select: none;
				background: transparent;
				color: var(--text-color, #171717);
				border: 2px solid #000;
				box-shadow: none;
				transition: border-color 0.12s ease, background 0.12s ease;
			}
			.point-of-sale-app .cart-totals-section > .kqs-cart-actions > .${LAYBY_BTN_CLASS}.kqs-layby-enabled:hover {
				border-color: #000;
				background-color: var(--fg-color, #f9fafb);
			}
			.point-of-sale-app .cart-totals-section > .kqs-cart-actions > .${LAYBY_BTN_CLASS}:not(.kqs-layby-enabled) {
				opacity: 0.45;
				cursor: not-allowed;
				pointer-events: none;
			}
		`;
		document.head.appendChild(style);
	}

	async function start_layby_from_cart() {
		const pos = window.cur_pos;
		if (!pos?.frm) return;
		if (!is_layby_enabled_on_pos()) {
			frappe.msgprint(__("Layby is disabled in KQS Retail Settings."));
			return;
		}
		if (!validate_cart_for_checkout(pos.frm)) return;

		if (pos.frm.is_dirty()) {
			let save_error = false;
			await pos.frm.save(null, null, null, () => (save_error = true));
			if (save_error) return;
		}

		show_create_layby_dialog(pos.frm);
	}

	function ensure_cart_layby_button(cart) {
		if (!cart?.$totals_section) return;

		inject_cart_layby_styles();

		const $section = cart.$totals_section;
		if ($section.find(`.${LAYBY_BTN_CLASS}`).length) return;

		const $checkout = $section.children(".checkout-btn").first();
		if (!$checkout.length) return;

		const $actions = $('<div class="kqs-cart-actions"></div>');
		$checkout.detach().appendTo($actions);

		const $layby = $(`<button type="button" class="${LAYBY_BTN_CLASS}">${__("Layby")}</button>`);
		if (!is_layby_enabled_on_pos()) {
			$layby.hide();
		}
		$actions.append($layby);
		$section.append($actions);

		$layby.on("click", (e) => {
			e.stopImmediatePropagation();
			e.preventDefault();
			if (!$layby.hasClass("kqs-layby-enabled")) return;
			start_layby_from_cart();
		});
	}

	function sync_cart_layby_visibility(cart, show_checkout) {
		if (!cart?.$totals_section) return;
		const $actions = cart.$totals_section.find("> .kqs-cart-actions");
		if (!$actions.length) return;
		$actions.css("display", show_checkout ? "flex" : "none");
		if (show_checkout) {
			$actions.find("> .checkout-btn").css("display", "flex");
		}
	}

	function sync_cart_layby_highlight(cart, enabled) {
		if (!cart?.$totals_section) return;
		cart.$totals_section.find(`.${LAYBY_BTN_CLASS}`).toggleClass("kqs-layby-enabled", !!enabled);
	}

	function patch_pos_cart() {
		if (!window.erpnext?.PointOfSale?.ItemCart) return;
		const ItemCart = erpnext.PointOfSale.ItemCart;
		if (ItemCart.prototype._kqs_cart_patched) return;

		const orig_make_totals = ItemCart.prototype.make_cart_totals_section;
		ItemCart.prototype.make_cart_totals_section = function () {
			orig_make_totals.call(this);
			ensure_cart_layby_button(this);
		};

		const orig_update_totals = ItemCart.prototype.update_totals_section;
		ItemCart.prototype.update_totals_section = function (frm) {
			orig_update_totals.call(this, frm);
			ensure_cart_layby_button(this);
		};

		const orig_toggle_checkout = ItemCart.prototype.toggle_checkout_btn;
		ItemCart.prototype.toggle_checkout_btn = function (show_checkout) {
			orig_toggle_checkout.call(this, show_checkout);
			sync_cart_layby_visibility(this, show_checkout);
		};

		const orig_highlight_checkout = ItemCart.prototype.highlight_checkout_btn;
		ItemCart.prototype.highlight_checkout_btn = function (toggle) {
			orig_highlight_checkout.call(this, toggle);
			sync_cart_layby_highlight(this, toggle);
			// highlight_checkout_btn styles every .checkout-btn — keep totals checkout on primary-action sizing
			const $checkout = this.$totals_section.find("> .kqs-cart-actions > .checkout-btn");
			if (!$checkout.length) return;
			if (toggle) {
				$checkout.css({
					"background-color": "var(--btn-primary)",
					color: "var(--neutral)",
				});
			} else {
				$checkout.css({
					"background-color": "var(--control-bg)",
					color: "",
				});
			}
		};

		ItemCart.prototype._kqs_cart_patched = true;

		const pos = window.cur_pos;
		if (pos?.cart) {
			ensure_cart_layby_button(pos.cart);
		}
	}

	function inject_pos_payment_styles() {
		if (document.getElementById("kqs-pos-payment-styles")) return;
		const style = document.createElement("style");
		style.id = "kqs-pos-payment-styles";
		style.textContent = `
			.point-of-sale-app .payment-container .payment-modes {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 0.65rem;
				margin-bottom: 0.5rem;
			}
			.point-of-sale-app .payment-container .payment-mode-wrapper {
				width: 100%;
				margin: 0 !important;
				padding: 0 !important;
			}
			.point-of-sale-app .payment-container .mode-of-payment {
				width: 100%;
				min-height: 4.75rem;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 0.25rem;
				padding: 0.7rem 0.5rem;
				border-radius: var(--border-radius-md, 8px);
				border: 2px solid var(--border-color, #d1d5db);
				background: var(--card-bg, #fff);
				font-size: var(--text-base, 13px);
				font-weight: 600;
				line-height: 1.3;
				text-align: center;
				cursor: pointer;
				transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
			}
			.point-of-sale-app .payment-container .mode-of-payment:hover {
				border-color: var(--gray-500, #6b7280);
			}
			.point-of-sale-app .payment-container .mode-of-payment.border-primary {
				border-color: var(--primary, #171717);
				background: var(--fg-color, #f9fafb);
				box-shadow: 0 0 0 1px var(--primary, #171717);
			}
			.point-of-sale-app .payment-container .mode-of-payment [class$="-amount"] {
				font-size: 1.05rem;
				font-weight: 700;
				color: var(--text-color, #171717);
			}
			.point-of-sale-app .payment-container .mode-of-payment-control {
				display: none !important;
			}
			.point-of-sale-app .payment-container .kqs-payment-hint {
				margin: 0 0 0.65rem;
				font-size: var(--text-sm, 12px);
				color: var(--text-muted, #6b7280);
				line-height: 1.4;
			}
		`;
		document.head.appendChild(style);
	}

	function enhance_payment_method_panel() {
		const $container = $(".payment-container:visible");
		if (!$container.length) return;

		inject_pos_payment_styles();

		const $modes = $container.find(".payment-modes").first();
		if ($modes.length && !$modes.prev(".kqs-payment-hint").length) {
			$(
				`<p class="kqs-payment-hint">${__(
					"Tap a payment method, enter the amount on the keypad, then tap another method for split payments."
				)}</p>`
			).insertBefore($modes);
		}
	}

	function ensure_layby_menu_item() {
		const pos = window.cur_pos;
		if (!pos || !pos.page || pos._kqs_layby_menu_added) return;
		pos.page.add_menu_item(__("Layby Lookup & Pay"), () => {
			if (pos.frm) show_layby_lookup_dialog(pos.frm);
		});
		pos._kqs_layby_menu_added = true;
	}

	function patch_pos_payment() {
		if (!window.erpnext?.PointOfSale?.Payment) return;
		const Payment = erpnext.PointOfSale.Payment;
		if (Payment.prototype._kqs_payment_patched) return;

		// Cashier must enter tendered amounts — never auto-fill payment rows at checkout.
		Payment.prototype.auto_set_remaining_amount = function () {};
		Payment.prototype.focus_on_default_mop = function () {};

		const orig_checkout = Payment.prototype.checkout;
		Payment.prototype.checkout = function () {
			this.set_gt_to_default_mop = false;
			const frm = this.events.get_frm();
			if (frm) {
				frm.set_default_payment = 0;
			}
			const orig_calc = frm?.cscript?.calculate_outstanding_amount;
			if (frm && orig_calc) {
				frm.cscript.calculate_outstanding_amount = function () {
					return orig_calc.call(this, false);
				};
			}
			try {
				orig_checkout.call(this);
			} finally {
				if (frm && orig_calc) {
					frm.cscript.calculate_outstanding_amount = orig_calc;
				}
			}
		};

		const orig_render_payment_mode_dom = Payment.prototype.render_payment_mode_dom;
		Payment.prototype.render_payment_mode_dom = function () {
			orig_render_payment_mode_dom.call(this);
			enhance_payment_method_panel();
		};

		Payment.prototype._kqs_payment_patched = true;
	}

	function patch_pos_controller() {
		if (!window.erpnext?.PointOfSale?.Controller) return;
		const Controller = erpnext.PointOfSale.Controller;
		if (Controller.prototype._kqs_checkout_patched) return;

		const orig_prepare_menu = Controller.prototype.prepare_menu;
		Controller.prototype.prepare_menu = function () {
			orig_prepare_menu.call(this);
			this._kqs_layby_menu_added = false;
			ensure_layby_menu_item();
		};

		Controller.prototype.save_and_checkout = async function () {
			if (!this.frm?.doc) return;

			if (this.frm.is_dirty()) {
				let save_error = false;
				await this.frm.save(null, null, null, () => (save_error = true));
				if (save_error) {
					setTimeout(() => this.cart.toggle_checkout_btn(true), 300);
					return;
				}
			}

			try {
				await reset_pos_payments(this.frm);
			} catch (e) {
				console.error(e);
				frappe.show_alert({
					message: __("Could not prepare payment. Please try again."),
					indicator: "red",
				});
				return;
			}

			this.payment.checkout();
		};

		Controller.prototype._kqs_checkout_patched = true;
	}

	function variant_attribute_badges_html(variant_attributes) {
		if (!variant_attributes || !variant_attributes.length) return "";
		const badges = variant_attributes
			.filter((row) => row && row.value)
			.map((row) => {
				const value = frappe.utils.escape_html(row.value);
				const title = row.attribute
					? frappe.utils.escape_html(`${row.attribute}: ${row.value}`)
					: value;
				return `<span class="kqs-pos-attr-badge" title="${title}">${value}</span>`;
			})
			.join("");
		return badges ? `<div class="kqs-pos-attr-badges">${badges}</div>` : "";
	}

	function inject_pos_attribute_badge_styles() {
		if (document.getElementById("kqs-pos-attr-badge-styles")) return;
		const style = document.createElement("style");
		style.id = "kqs-pos-attr-badge-styles";
		style.textContent = `
			.point-of-sale-app .items-container.show-item-image > .item-wrapper > .item-detail:has(.kqs-pos-attr-badges) {
				height: auto;
				min-height: 3.5rem;
				padding-bottom: 0.35rem;
			}
			.kqs-pos-attr-badges {
				display: flex;
				flex-wrap: wrap;
				gap: 0.25rem;
				margin-top: 0.3rem;
				max-width: 100%;
			}
			.kqs-pos-attr-badge {
				display: inline-block;
				max-width: 100%;
				padding: 0.1rem 0.45rem;
				border-radius: 999px;
				font-size: 10px;
				font-weight: 600;
				line-height: 1.25;
				background: #f3f4f6;
				color: #171717;
				border: 1px solid #d1d5db;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.point-of-sale-app .items-container.hide-item-image > .item-wrapper .kqs-pos-attr-badges {
				margin-top: 0.15rem;
			}
		`;
		document.head.appendChild(style);
	}

	function patch_item_selector() {
		if (!window.erpnext?.PointOfSale?.ItemSelector) return;
		const ItemSelector = erpnext.PointOfSale.ItemSelector;
		if (ItemSelector.prototype._kqs_attr_badges_patched) return;

		const orig_get_item_html = ItemSelector.prototype.get_item_html;
		ItemSelector.prototype.get_item_html = function (item) {
			const html = orig_get_item_html.call(this, item);
			const badges = variant_attribute_badges_html(item.variant_attributes);
			if (!badges) return html;

			const $el = $(html);
			$el.find(".item-detail").append(badges);
			return $el[0].outerHTML;
		};
		ItemSelector.prototype._kqs_attr_badges_patched = true;
		inject_pos_attribute_badge_styles();
	}

	INVOICE_DOCTYPES.forEach((doctype) => {
		frappe.ui.form.on(doctype, {
			after_payment_render(frm) {
				enhance_payment_method_panel();
			},
		});
	});

	patch_pos_payment();
	patch_pos_controller();
	patch_pos_cart();
	patch_item_selector();

	$(window).on("hashchange load", () => {
		frappe.after_ajax(() => {
			if (frappe.get_route()[0] === "point-of-sale") {
				ensure_layby_menu_item();
				patch_pos_payment();
				patch_pos_controller();
				patch_pos_cart();
				patch_item_selector();
			}
		});
	});
})();
