/* Copyright (c) 2026, KQS â€” Layby, returns & checkout flow for ERPNext Point of Sale */
const KQS_POS_PAGE_SCRIPT_VERSION = 49;

frappe.provide("kqs_retail.pos_returns");

kqs_retail.pos_returns = (function () {
	let active_pos = null;
	let $layer = null;
	let layout = null;
	let customer_control = null;
	let selected_receipt = null;
	let return_lines = [];
	let search_timer = null;
	let store_context = {
		store_label: "",
		return_window_days: 14,
		receipt_search_window_days: 30,
		count: 0,
	};

	function get_return_policy_defaults() {
		const boot = frappe.boot?.kqs_retail_settings || {};
		return {
			return_window_days: cint(boot.return_window_days) || 14,
			receipt_search_window_days: cint(boot.receipt_search_window_days) || 30,
		};
	}
	let loaded_receipts = [];
	let current_step = "search";
	let returns_scroll_root = null;
	let returns_mount = null;
	let refund_options = null;
	let selected_refund_type = "account";
	let selected_refund_mode = null;
	const REFUND_TO_ACCOUNT = "account";
	const STEPS = ["search", "items", "customer", "done"];

	function get_pos_context() {
		const frm = active_pos?.frm?.doc || {};
		return {
			pos_profile: frm.pos_profile || "",
			company: frm.company || "",
			warehouse: frm.set_warehouse || (frm.items && frm.items[0]?.warehouse) || "",
		};
	}

	function relative_sale_label(posting_date) {
		if (!posting_date) return "";
		const days = frappe.datetime.get_day_diff(frappe.datetime.get_today(), posting_date);
		if (days <= 0) return __("Today");
		if (days === 1) return __("Yesterday");
		return __("{0} days ago", [days]);
	}

	function inject_styles() {
		const style_id = `kqs-returns-styles-v${KQS_POS_PAGE_SCRIPT_VERSION}`;
		document.querySelectorAll('[id^="kqs-returns-styles"]').forEach((el) => el.remove());
		if (document.getElementById(style_id)) return;
		const style = document.createElement("style");
		style.id = style_id;
		style.textContent = `
			[data-page-route="point-of-sale"] .layout-main-section.kqs-returns-mount {
				padding-bottom: 0 !important;
				margin-bottom: 0 !important;
				overflow: hidden;
				background: #fff !important;
			}
			.point-of-sale-app.kqs-returns-mount-host {
				width: 100%;
				box-sizing: border-box;
				background: #fff;
			}
			.kqs-pos-returns-layer {
				display: none;
				flex: 1 1 auto;
				width: 100%;
				min-height: 0;
				overflow: hidden;
				background: #fff;
			}
			.kqs-pos-returns-layer:not(.d-none) {
				display: flex;
				flex-direction: column;
			}
			.kqs-returns-app {
				flex: 1 1 auto;
				display: flex;
				flex-direction: row;
				align-items: stretch;
				width: 100%;
				height: 100%;
				min-height: 0;
				max-width: none;
				margin: 0;
				padding: 0;
				box-sizing: border-box;
				background: #fff;
			}
			.kqs-returns-sidebar {
				flex: 0 0 11rem;
				width: 11rem;
				padding: 0.65rem 0.7rem;
				background: #fff;
				border-right: 1px solid #e2e8f0;
				display: flex;
				flex-direction: column;
				gap: 0.35rem;
				overflow-y: auto;
			}
			.kqs-returns-sidebar-title {
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.07em;
				color: #64748b;
				margin: 0 0 0.15rem;
			}
			.kqs-returns-sidebar-hint {
				font-size: 11px;
				line-height: 1.4;
				color: #64748b;
				margin: 0 0 0.35rem;
			}
			.kqs-returns-sidebar-actions {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}
			.kqs-returns-sidebar-btn {
				display: block;
				width: 100%;
				text-align: left;
				border-radius: 8px;
				font-size: 11px;
				font-weight: 600;
				padding: 0.4rem 0.55rem;
				white-space: normal;
				line-height: 1.25;
			}
			.kqs-returns-sidebar-btn.btn-primary {
				background: #0f172a;
				border-color: #0f172a;
				color: #fff;
			}
			.kqs-returns-sidebar-btn.btn-primary:hover,
			.kqs-returns-sidebar-btn.btn-primary:focus {
				background: #1e293b;
				border-color: #1e293b;
				color: #fff;
			}
			.kqs-returns-sidebar-policy {
				margin-top: auto;
				padding-top: 0.75rem;
				border-top: 1px solid #e2e8f0;
				font-size: 10px;
				line-height: 1.4;
				color: #94a3b8;
			}
			.kqs-returns-main {
				flex: 1 1 auto;
				min-width: 0;
				overflow-x: hidden;
				overflow-y: auto;
				padding: 0.65rem 0.9rem 0.5rem;
				max-width: 920px;
				background: #fff;
			}
			.kqs-returns-hero {
				border-radius: 10px;
				padding: 0.7rem 0.9rem 0.75rem;
				background: #fff;
				border: 1px solid #e2e8f0;
				color: #0f172a;
				box-shadow: none;
				margin-bottom: 0.6rem;
			}
			.kqs-returns-hero-title {
				font-size: 1.1rem;
				font-weight: 700;
				margin: 0 0 0.2rem;
				letter-spacing: -0.02em;
				color: #0f172a !important;
			}
			.kqs-returns-hero-sub {
				line-height: 1.35;
				margin: 0;
				font-size: 12px;
				color: #64748b !important;
			}
			.kqs-returns-hero-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 0.35rem;
				margin-top: 0.5rem;
			}
			.kqs-returns-chip {
				display: inline-flex;
				align-items: center;
				gap: 0.3rem;
				padding: 0.18rem 0.5rem;
				border-radius: 999px;
				background: #f8fafc;
				border: 1px solid #e2e8f0;
				font-size: 10px;
				font-weight: 600;
				letter-spacing: 0.02em;
				color: #334155;
			}
			.kqs-returns-steps {
				display: grid;
				grid-template-columns: repeat(4, 1fr);
				gap: 0.3rem;
				margin-bottom: 0.55rem;
			}
			.kqs-returns-step-pill {
				text-align: center;
				padding: 0.32rem 0.25rem;
				border-radius: 8px;
				background: #fff;
				border: 1px solid #e2e8f0;
				font-size: 10px;
				font-weight: 600;
				color: #64748b;
			}
			.kqs-returns-step-pill.is-active {
				background: #eff6ff;
				border-color: #93c5fd;
				color: #1d4ed8;
				box-shadow: 0 0 0 1px #bfdbfe inset;
			}
			.kqs-returns-step-pill.is-done { color: #059669; border-color: #a7f3d0; background: #ecfdf5; }
			.kqs-returns-panel {
				background: #fff;
				border: 1px solid #e2e8f0;
				border-radius: 10px;
				padding: 0.65rem 0.75rem 0.7rem;
				box-shadow: none;
			}
			.kqs-returns-search-row {
				display: flex;
				gap: 0.5rem;
				margin: 0.5rem 0 0.75rem;
			}
			.kqs-returns-search-row input { flex: 1; border-radius: 10px; }
			.kqs-returns-search-row .btn { border-radius: 10px; min-width: 5.5rem; }
			.kqs-returns-filter-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.85rem; }
			.kqs-returns-filter-btn {
				border-radius: 999px;
				font-size: 11px;
				font-weight: 600;
				padding: 0.25rem 0.7rem;
			}
			.kqs-returns-filter-btn.is-active {
				background: #2563eb;
				border-color: #2563eb;
				color: #fff;
			}
			.kqs-returns-list-meta {
				font-size: 12px;
				color: #64748b;
				margin-bottom: 0.55rem;
			}
			.kqs-returns-receipt-list { display: grid; gap: 0.55rem; }
			.kqs-returns-receipt-card {
				display: grid;
				grid-template-columns: auto 1fr auto;
				gap: 0.75rem;
				align-items: center;
				width: 100%;
				text-align: left;
				border: 1px solid #e2e8f0;
				border-radius: 12px;
				background: #fff;
				padding: 0.8rem 0.95rem;
				cursor: pointer;
				transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
			}
			.kqs-returns-receipt-card:hover {
				border-color: #93c5fd;
				box-shadow: 0 6px 16px rgba(37, 99, 235, 0.1);
				transform: translateY(-1px);
			}
			.kqs-returns-receipt-icon {
				width: 2.5rem;
				height: 2.5rem;
				border-radius: 10px;
				display: flex;
				align-items: center;
				justify-content: center;
				background: #eff6ff;
				color: #2563eb;
				font-size: 1.1rem;
			}
			.kqs-returns-receipt-title { font-weight: 700; color: #0f172a; font-size: 14px; }
			.kqs-returns-receipt-meta { font-size: 12px; color: #64748b; margin-top: 0.2rem; line-height: 1.35; }
			.kqs-returns-receipt-amount {
				font-weight: 700;
				font-size: 15px;
				color: #0f172a;
				text-align: right;
				white-space: nowrap;
			}
			.kqs-returns-receipt-card.is-expired {
				opacity: 0.72;
				border-style: dashed;
				border-color: #fca5a5;
				background: #fffbfb;
			}
			.kqs-returns-receipt-expired {
				font-size: 10px;
				font-weight: 700;
				color: #b91c1c;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				margin-top: 0.2rem;
			}
			.kqs-returns-empty {
				text-align: center;
				padding: 2rem 1rem;
				color: #64748b;
				border: 1px dashed #cbd5e1;
				border-radius: 12px;
				background: #f8fafc;
			}
			.kqs-returns-empty-icon { font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.65; }
			.kqs-returns-receipt-banner {
				display: flex;
				flex-wrap: wrap;
				gap: 0.5rem 1rem;
				align-items: center;
				padding: 0.85rem 1rem;
				border-radius: 10px;
				background: #f8fafc;
				border: 1px solid #e2e8f0;
				margin-bottom: 0.85rem;
			}
			.kqs-returns-table { background: #fff; margin-bottom: 0.75rem; }
			.kqs-returns-table thead th { background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
			.kqs-returns-table .kqs-return-item-name { font-weight: 600; color: #0f172a; }
			.kqs-returns-toolbar { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0.65rem; }
			.kqs-returns-credit-box, .kqs-returns-success-card {
				border-radius: 10px;
				padding: 0.65rem 0.8rem;
				margin: 0.45rem 0 0.55rem;
				background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
				border: 1px solid #6ee7b7;
			}
			.kqs-returns-credit-amount { font-size: 1.25rem; font-weight: 800; margin: 0.15rem 0; color: #065f46; }
			.kqs-returns-refund-box {
				border-radius: 10px;
				padding: 0.65rem 0.8rem;
				margin: 0.45rem 0 0.55rem;
				background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
				border: 1px solid #93c5fd;
			}
			.kqs-returns-refund-amount { font-size: 1.25rem; font-weight: 800; margin: 0.15rem 0; color: #1e40af; }
			.kqs-returns-refund-modes {
				margin-bottom: 0.55rem;
			}
			.kqs-returns-refund-modes-label {
				font-size: 10px;
				font-weight: 800;
				text-transform: uppercase;
				letter-spacing: 0.07em;
				color: #64748b;
				margin: 0 0 0.4rem;
			}
			.kqs-returns-refund-modes-grid {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
				gap: 0.4rem;
			}
			.kqs-refund-mode-btn {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 0.2rem;
				min-height: 3.25rem;
				padding: 0.45rem 0.35rem;
				border-radius: 8px;
				border: 2px solid #0f172a;
				background: #fff;
				font-size: 11px;
				font-weight: 700;
				line-height: 1.25;
				text-align: center;
				color: #0f172a;
				cursor: pointer;
				transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
			}
			.kqs-refund-mode-btn:hover {
				border-color: #0f172a;
				background: #f8fafc;
			}
			.kqs-refund-mode-btn.is-active {
				border-color: #0f172a;
				background: #0f172a;
				color: #fff;
				box-shadow: none;
			}
			.kqs-refund-mode-btn .kqs-refund-original {
				font-size: 9px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: #059669;
			}
			.kqs-refund-mode-btn.is-active .kqs-refund-original {
				color: #cbd5e1;
			}
			.kqs-returns-success-title { font-size: 1.05rem; font-weight: 700; margin-bottom: 0.35rem; color: #065f46; }
			.kqs-returns-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.45rem; }
			.kqs-returns-actions .btn { border-radius: 8px; }
			.kqs-returns-step .btn-lg { min-height: 2.35rem; padding: 0.35rem 0.9rem; font-size: 13px; }
			.kqs-returns-customer-top {
				margin-bottom: 0.55rem;
				padding-top: 0;
			}
			.kqs-returns-customer-top .kqs-returns-customer-prompt:empty {
				display: none;
			}
			.kqs-returns-customer-top .kqs-returns-customer-prompt:not(:empty) {
				margin-bottom: 0;
			}
			.kqs-returns-customer-hero {
				margin-bottom: 1rem;
				padding: 0;
			}
			.kqs-returns-customer-hero-title {
				font-size: 1.1rem;
				font-weight: 700;
				margin: 0 0 0.35rem;
				color: #0f172a !important;
			}
			.kqs-returns-customer-hero-sub {
				margin: 0;
				font-size: 14px;
				line-height: 1.5;
				color: #64748b !important;
			}
			.kqs-returns-customer-prompt {
				margin-bottom: 0.55rem;
				padding: 0.55rem 0.7rem;
				border-radius: 8px;
				font-size: 12px;
				line-height: 1.4;
			}
			.kqs-returns-customer-prompt.is-walkin {
				background: #fff7ed;
				border: 1px solid #fdba74;
				color: #9a3412;
			}
			.kqs-returns-customer-prompt.is-named {
				background: #eff6ff;
				border: 1px solid #93c5fd;
				color: #1e40af;
			}
			.kqs-returns-customer-field-block {
				margin-bottom: 0.45rem;
			}
			.kqs-returns-customer-field-label {
				display: block;
				font-size: 0.7rem;
				font-weight: 800;
				text-transform: uppercase;
				letter-spacing: 0.08em;
				color: #0f172a;
				margin: 0 0 0.25rem;
			}
			.kqs-returns-customer-field-hint {
				margin: 0 0 0.4rem;
				font-size: 11px;
				color: #64748b;
				line-height: 1.35;
			}
			.kqs-returns-customer-tools {
				display: flex;
				flex-wrap: wrap;
				gap: 0.4rem;
				margin: 0 0 0.45rem;
			}
			.kqs-returns-customer-tools .btn {
				border-radius: 8px;
				font-weight: 600;
				min-height: 2rem;
				padding: 0.3rem 0.75rem;
				font-size: 12px;
			}
			.kqs-returns-customer-tools .kqs-returns-customer-create {
				background: #0f172a;
				border-color: #0f172a;
				color: #fff;
			}
			.kqs-returns-customer-tools .kqs-returns-customer-create:hover,
			.kqs-returns-customer-tools .kqs-returns-customer-create:focus {
				background: #1e293b;
				border-color: #1e293b;
				color: #fff;
			}
			.kqs-returns-customer-field-wrap {
				padding: 0.4rem 0.5rem;
				border-radius: 10px;
				background: #eff6ff;
				border: 2px solid #2563eb;
				box-shadow: none;
			}
			.kqs-returns-customer-field-wrap:focus-within {
				border-color: #1d4ed8;
				box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
			}
			.kqs-returns-customer-field-wrap .frappe-control {
				margin-bottom: 0 !important;
			}
			.kqs-returns-customer-field-wrap .control-label {
				display: none !important;
			}
			.kqs-returns-customer-field-wrap .form-control,
			.kqs-returns-customer-field-wrap input {
				min-height: 2.4rem;
				font-size: 0.95rem;
				font-weight: 600;
				border-radius: 8px;
				border: 1px solid #cbd5e1;
				padding: 0.45rem 0.65rem;
				color: #0f172a;
			}
			.kqs-returns-customer-field-wrap .form-control::placeholder,
			.kqs-returns-customer-field-wrap input::placeholder {
				font-weight: 500;
				color: #94a3b8;
			}
			.kqs-returns-step[data-step="customer"] .kqs-returns-summary {
				margin-top: 0;
				margin-bottom: 0.45rem;
			}
			.kqs-returns-step[data-step="customer"] .kqs-returns-actions {
				margin-top: 0.45rem;
				padding-top: 0.55rem;
				border-top: 1px solid #e2e8f0;
			}
			.kqs-returns-receipt-when { font-size: 11px; color: #2563eb; font-weight: 600; margin-top: 0.15rem; }
		`;
		document.head.appendChild(style);
	}

	function format_money(amount, currency) {
		return format_currency(flt(amount), currency || frappe.defaults.get_default("currency"));
	}

	function update_step_pills(step) {
		current_step = step;
		const idx = STEPS.indexOf(step);
		layout.find(".kqs-returns-step-pill").each(function () {
			const pill_step = $(this).data("step");
			const pill_idx = STEPS.indexOf(pill_step);
			$(this)
				.toggleClass("is-active", pill_step === step)
				.toggleClass("is-done", pill_idx >= 0 && pill_idx < idx);
		});
	}

	function show_step(name) {
		layout.find(".kqs-returns-step").addClass("d-none");
		layout.find(`.kqs-returns-step[data-step="${name}"]`).removeClass("d-none");
		layout.find("#kqs-returns-customer-top").toggleClass("d-none", name !== "customer");
		update_step_pills(name);
		fit_returns_layer();
		if (name === "customer") {
			setTimeout(() => focus_customer_search(), 200);
		}
	}

	function update_store_chips() {
		const search_days = store_context.receipt_search_window_days || 30;
		const return_days = store_context.return_window_days || 14;
		layout.find(".kqs-returns-chip-store").text(store_context.store_label || __("This store"));
		layout.find(".kqs-returns-chip-search").text(__("Search: {0} days", [search_days]));
		layout.find(".kqs-returns-chip-return").text(__("Returns: {0} days", [return_days]));
		layout.find(".kqs-returns-chip-policy").text(__("Default: account credit"));
		render_sidebar();
	}

	function is_account_refund() {
		return selected_refund_type === REFUND_TO_ACCOUNT;
	}

	function update_submit_button_label() {
		if (!layout) return;
		const $btn = layout.find(".kqs-returns-submit");
		if (is_account_refund()) {
			$btn.text(__("Credit customer account"));
		} else if (selected_refund_mode) {
			$btn.text(__("Refund via {0}", [selected_refund_mode]));
		} else {
			$btn.text(__("Select refund method"));
		}
	}

	function render_refund_mode_buttons() {
		const opts = refund_options || {};
		const pos_modes = opts.pos_payment_modes || [];
		const original = new Set(opts.original_payment_modes || []);
		const account_label = opts.account_label || __("Customer account");

		const account_btn = `<button type="button" class="kqs-refund-mode-btn${
			is_account_refund() ? " is-active" : ""
		}" data-refund-type="${REFUND_TO_ACCOUNT}">
			<span>${frappe.utils.escape_html(account_label)}</span>
			<span class="kqs-refund-original">${__("Default")}</span>
		</button>`;

		const payment_btns = pos_modes
			.map((mode) => {
				const active =
					!is_account_refund() && selected_refund_mode === mode ? " is-active" : "";
				const orig = original.has(mode)
					? `<span class="kqs-refund-original">${__("Original")}</span>`
					: "";
				return `<button type="button" class="kqs-refund-mode-btn${active}"
					data-refund-type="payment" data-mode="${frappe.utils.escape_html(mode)}">
					<span>${frappe.utils.escape_html(mode)}</span>${orig}
				</button>`;
			})
			.join("");

		return `<div class="kqs-returns-refund-modes">
			<div class="kqs-returns-refund-modes-label">${__("Refund method")}</div>
			<div class="kqs-returns-refund-modes-grid">${account_btn}${payment_btns}</div>
			<p class="small text-muted" style="margin:0.4rem 0 0">${__(
				"Account credit is the usual choice. Refund to Cash or mobile money only when required."
			)}</p>
		</div>`;
	}

	function paint_refund_summary() {
		const credit = estimated_credit();
		const currency = selected_receipt?.currency;
		const modes_html = render_refund_mode_buttons();
		let amount_html;

		if (is_account_refund()) {
			amount_html = `<div class="kqs-returns-credit-box">
				<div class="small text-muted">${__("Estimated store credit")}</div>
				<div class="kqs-returns-credit-amount">${format_money(credit, currency)}</div>
				<div class="small text-muted">${__(
					"Credit stays on the customer account for a future sale at this store."
				)}</div>
			</div>`;
		} else {
			const mode = frappe.utils.escape_html(selected_refund_mode || __("payment"));
			amount_html = `<div class="kqs-returns-refund-box">
				<div class="small text-muted">${__("Refund amount")}</div>
				<div class="kqs-returns-refund-amount">${format_money(credit, currency)}</div>
				<div class="small text-muted">${__(
					"Refund via {0} â€” pay the customer from the till and keep the receipt.",
					[mode]
				)}</div>
			</div>`;
		}

		layout.find(".kqs-returns-summary").html(`${modes_html}${amount_html}`);
		sync_customer_prompt_for_refund();
		update_submit_button_label();
	}

	function sync_customer_prompt_for_refund() {
		if (!layout || !selected_receipt || !customer_control) return;
		const receipt = selected_receipt;
		const $prompt = layout.find("#kqs-returns-customer-prompt");

		if (is_account_refund() && is_receipt_walk_in(receipt)) {
			prepare_customer_step();
			return;
		}

		if (!is_account_refund() && is_receipt_walk_in(receipt)) {
			if (receipt.customer) {
				customer_control.set_value(receipt.customer);
			}
			$prompt
				.removeClass("is-walkin")
				.addClass("is-named")
				.html(
					`${__("Walk-in sale")} â€” ${__(
						"refund will be paid from the till via the payment mode you selected."
					)}`
				);
		}
	}

	function render_sidebar() {
		if (!layout) return;
		const return_days = store_context.return_window_days || 14;
		const search_days = store_context.receipt_search_window_days || 30;
		const store = frappe.utils.escape_html(store_context.store_label || __("This store"));
		layout.find(".kqs-returns-sidebar-hint").text(
			__("{0} Â· search {1}d Â· returns {2}d", [store, search_days, return_days])
		);
		layout.find(".kqs-returns-sidebar-policy").text(
			__(
				"Default refund is customer account credit. Cash or mobile refunds are available when needed."
			)
		);
	}

	function is_receipt_walk_in(receipt) {
		if (!receipt) return true;
		if (receipt.is_walk_in) return true;
		const name = (receipt.customer_name || receipt.customer || "").toLowerCase();
		return name.includes("walk-in") || name.includes("walk in");
	}

	function focus_customer_search() {
		if (!customer_control) return;
		const $wrap = layout.find("#kqs-returns-customer-field");
		const $input = $wrap.find("input").filter(":visible").first();
		if ($input.length) {
			$input.trigger("focus").trigger("click");
			return;
		}
		customer_control.set_focus?.();
	}

	function update_customer_prompt_for_selection(customer) {
		if (!customer || !layout) return;
		const $prompt = layout.find("#kqs-returns-customer-prompt");
		frappe.db.get_value("Customer", customer, ["customer_name", "name"]).then(({ message }) => {
			const display = message?.customer_name || customer;
			$prompt
				.removeClass("is-walkin")
				.addClass("is-named")
				.html(
					`${__("Credit will go to")} <strong>${frappe.utils.escape_html(display)}</strong>.`
				);
		});
	}

	function open_create_customer() {
		if (!customer_control) return;
		// Same ERPNext Customer quick-entry used by POS link fields (+ button / "Create new").
		customer_control.new_doc();
	}

	function prepare_customer_step() {
		const receipt = selected_receipt;
		const $prompt = layout.find("#kqs-returns-customer-prompt");
		customer_control.set_value("");

		if (is_receipt_walk_in(receipt)) {
			$prompt
				.removeClass("is-named")
				.addClass("is-walkin")
				.html(
					`<strong>${__("Walk-in sale")}</strong> ${__(
						"â€” search for the customer by name or mobile, or create a new account. Store credit cannot go to Walk-in Customer."
					)}`
				);
			setTimeout(() => focus_customer_search(), 200);
			return;
		}

		if (receipt?.customer) {
			customer_control.set_value(receipt.customer);
			$prompt
				.removeClass("is-walkin")
				.addClass("is-named")
				.html(
					`${__(
						"Credit will go to the same customer who bought this item:"
					)} <strong>${frappe.utils.escape_html(
						receipt.customer_name || receipt.customer
					)}</strong>. ${__("Change only if crediting someone else.")}`
				);
			return;
		}

		$prompt
			.removeClass("is-named")
			.addClass("is-walkin")
			.html(
				`${__(
					"Search for the customer to credit, or create a new customer account."
				)}`
			);
		setTimeout(() => focus_customer_search(), 200);
	}

	function filter_receipts(rows, filter_key) {
		if (!filter_key || filter_key === "all") return rows;
		return rows.filter((row) => {
			const days = frappe.datetime.get_day_diff(frappe.datetime.get_today(), row.posting_date);
			if (filter_key === "today") return days <= 0;
			if (filter_key === "week") return days <= 7;
			return true;
		});
	}

	function render_receipt_list(rows) {
		const $receipt_list = layout.find("#kqs-returns-receipt-list");
		const $meta = layout.find(".kqs-returns-list-meta");
		const filter_key = layout.find(".kqs-returns-filter-btn.is-active").data("filter") || "all";
		const filtered = filter_receipts(rows, filter_key);
		const search_days = store_context.receipt_search_window_days || 30;
		const return_days = store_context.return_window_days || 14;

		$meta.text(
			filtered.length
				? __(
						"{0} receipt(s) at {1} Â· search {2} days Â· returns within {3} days",
						[filtered.length, store_context.store_label || __("this store"), search_days, return_days]
				  )
				: __("No receipts match your search at {0}.", [store_context.store_label || __("this store")])
		);

		if (!filtered.length) {
			$receipt_list.html(`
				<div class="kqs-returns-empty">
					<div class="kqs-returns-empty-icon">ðŸ§¾</div>
					<div>${__("No paid receipts found for this store in the last {0} days.", [search_days])}</div>
					<div class="small text-muted" style="margin-top:0.35rem">${__(
						"Try another search or check the receipt was rung up on this store's till."
					)}</div>
				</div>
			`);
			return;
		}

		const html = filtered
			.map((row) => {
				const label = frappe.utils.escape_html(row.name);
				const customer = frappe.utils.escape_html(row.customer_name || row.customer || "");
				const date = frappe.datetime.str_to_user(row.posting_date);
				const when = relative_sale_label(row.posting_date);
				const total = format_money(row.grand_total, row.currency);
				const cashier = frappe.utils.escape_html(row.cashier || "");
				const cashier_line = cashier ? `${__("Sold by")} ${cashier} Â· ` : "";
				const eligible = row.return_eligible !== 0 && row.return_eligible !== false;
				const expired_class = eligible ? "" : " is-expired";
				const expired_badge = eligible
					? ""
					: `<div class="kqs-returns-receipt-expired">${__(
							"Past return window ({0} days)",
							[return_days]
					  )}</div>`;
				return `<button type="button" class="kqs-returns-receipt-card${expired_class}" data-eligible="${
					eligible ? 1 : 0
				}" data-doctype="${frappe.utils.escape_html(row.doctype)}" data-name="${label}">
					<div class="kqs-returns-receipt-icon">ðŸ§¾</div>
					<div>
						<div class="kqs-returns-receipt-title">${label}</div>
						<div class="kqs-returns-receipt-meta">${customer}</div>
						<div class="kqs-returns-receipt-meta">${cashier_line}${date}</div>
					</div>
					<div>
						<div class="kqs-returns-receipt-amount">${total}</div>
						<div class="kqs-returns-receipt-when">${when}</div>
						${expired_badge}
					</div>
				</button>`;
			})
			.join("");
		$receipt_list.html(html);
	}

	function load_receipts(term) {
		const ctx = get_pos_context();
		if (!ctx.pos_profile) {
			layout.find("#kqs-returns-receipt-list").html(`
				<div class="kqs-returns-empty">
					<div>${__("POS profile is not loaded yet. Go back to the till and open Returns again.")}</div>
				</div>
			`);
			return;
		}

		const $receipt_list = layout.find("#kqs-returns-receipt-list");
		$receipt_list.html(`<p class="text-muted small">${__("Loading store receiptsâ€¦")}</p>`);
		frappe.call({
			method: "kqs_retail.api.returns.search_receipts",
			args: { search_term: term || "", limit: 50, pos_profile: ctx.pos_profile },
			callback(r) {
				if (r.exc) {
					$receipt_list.html("");
					return;
				}
				const payload = r.message || {};
				const defaults = get_return_policy_defaults();
				store_context = {
					store_label: payload.store_label || ctx.pos_profile,
					return_window_days: payload.return_window_days || defaults.return_window_days,
					receipt_search_window_days:
						payload.receipt_search_window_days || defaults.receipt_search_window_days,
					count: payload.count || 0,
				};
				loaded_receipts = payload.receipts || [];
				update_store_chips();
				render_receipt_list(loaded_receipts);
				fit_returns_layer();
			},
		});
	}

	function draw_items_table() {
		const $items = layout.find("#kqs-returns-items");
		const currency = selected_receipt?.currency;
		const rows = return_lines
			.map((row, idx) => {
				const checked = row.selected ? "checked" : "";
				const max = flt(row.returnable_qty);
				return `<tr data-idx="${idx}">
					<td><input type="checkbox" class="kqs-return-check" ${checked} /></td>
					<td>
						<div class="kqs-return-item-name">${frappe.utils.escape_html(row.item_name || row.item_code)}</div>
						<div class="small text-muted">${frappe.utils.escape_html(row.item_code)}</div>
					</td>
					<td class="text-right">${format_money(row.rate, currency)}</td>
					<td class="text-right">${max}</td>
					<td class="text-right" style="width:5rem">
						<input type="number" class="form-control input-sm text-right kqs-return-qty"
							min="0" max="${max}" step="1" value="${flt(row.return_qty)}" />
					</td>
				</tr>`;
			})
			.join("");

		$items.html(`
			<div class="kqs-returns-toolbar">
				<button type="button" class="btn btn-default btn-xs kqs-returns-select-all">${__("Select all")}</button>
				<button type="button" class="btn btn-default btn-xs kqs-returns-select-none">${__("Clear all")}</button>
			</div>
			<table class="table table-bordered kqs-returns-table">
				<thead>
					<tr>
						<th style="width:2rem"><input type="checkbox" class="kqs-return-check-all" checked /></th>
						<th>${__("Item")}</th>
						<th class="text-right">${__("Rate")}</th>
						<th class="text-right">${__("Can return")}</th>
						<th class="text-right">${__("Qty")}</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
			<div class="kqs-returns-actions">
				<button type="button" class="btn btn-primary kqs-returns-continue">${__("Continue")}</button>
				<button type="button" class="btn btn-default kqs-returns-back-search">${__("Back to receipts")}</button>
			</div>
		`);
	}

	function set_all_items(selected) {
		return_lines.forEach((row, idx) => {
			row.selected = selected;
			if (selected && flt(row.return_qty) <= 0) {
				row.return_qty = row.returnable_qty;
			}
			if (!selected) {
				row.return_qty = 0;
			}
			const $row = layout.find(`tr[data-idx="${idx}"]`);
			$row.find(".kqs-return-check").prop("checked", selected);
			$row.find(".kqs-return-qty").val(flt(row.return_qty));
		});
		layout.find(".kqs-return-check-all").prop("checked", selected);
	}

	function render_items(receipt) {
		selected_receipt = receipt;
		return_lines = (receipt.items || []).map((row) => ({
			...row,
			selected: true,
			return_qty: row.returnable_qty,
		}));

		layout.find(".kqs-returns-receipt-header").html(`
			<div class="kqs-returns-receipt-banner">
				<strong>${frappe.utils.escape_html(receipt.name)}</strong>
				<span>${frappe.utils.escape_html(receipt.customer_name || "")}</span>
				<span>${frappe.datetime.str_to_user(receipt.posting_date)}</span>
				<span class="text-muted small">${relative_sale_label(receipt.posting_date)}</span>
			</div>
			<p class="small text-muted" style="margin:0">${__("Tick items and adjust quantities to return.")}</p>
		`);

		draw_items_table();
		show_step("items");
	}

	function selected_return_payload() {
		return return_lines
			.filter((row) => row.selected && flt(row.return_qty) > 0)
			.map((row) => ({
				item_row_name: row.item_row_name,
				qty: flt(row.return_qty),
			}));
	}

	function estimated_credit() {
		return return_lines.reduce((sum, row) => {
			if (!row.selected) return sum;
			return sum + flt(row.rate) * flt(row.return_qty);
		}, 0);
	}

	function render_summary() {
		const payload = selected_return_payload();
		if (!payload.length) {
			frappe.msgprint(__("Select at least one item to return."));
			return false;
		}
		const ctx = get_pos_context();
		layout.find(".kqs-returns-summary").html(
			`<p class="text-muted small">${__("Loading refund optionsâ€¦")}</p>`
		);
		show_step("customer");
		prepare_customer_step();

		frappe.call({
			method: "kqs_retail.api.returns.get_refund_options",
			args: {
				doctype: selected_receipt.doctype,
				name: selected_receipt.name,
				pos_profile: ctx.pos_profile,
			},
			callback(r) {
				if (r.exc) {
					layout.find(".kqs-returns-summary").empty();
					return;
				}
				refund_options = r.message || {};
				selected_refund_type = refund_options.default_refund_type || REFUND_TO_ACCOUNT;
				selected_refund_mode =
					refund_options.suggested_payment_mode ||
					refund_options.pos_payment_modes?.[0] ||
					null;
				paint_refund_summary();
			},
		});
		return true;
	}

	function submit_return() {
		const customer = customer_control.get_value();
		if (!customer) {
			frappe.msgprint(__("Select the customer to credit."));
			focus_customer_search();
			return;
		}
		if (is_account_refund() && is_receipt_walk_in({ customer, customer_name: customer })) {
			frappe.msgprint(__("Store credit cannot be assigned to Walk-in Customer."));
			return;
		}
		if (!is_account_refund() && !selected_refund_mode) {
			frappe.msgprint(__("Select a payment mode for the refund."));
			return;
		}
		const items = selected_return_payload();
		if (!items.length) {
			frappe.msgprint(__("Select at least one item to return."));
			return;
		}
		const ctx = get_pos_context();

		frappe.call({
			method: "kqs_retail.api.returns.submit_return",
			args: {
				doctype: selected_receipt.doctype,
				invoice_name: selected_receipt.name,
				customer,
				items: JSON.stringify(items),
				pos_profile: ctx.pos_profile,
				refund_type: selected_refund_type,
				mode_of_payment: is_account_refund() ? null : selected_refund_mode,
			},
			freeze: true,
			freeze_message: __("Processing returnâ€¦"),
			callback(r) {
				if (r.exc) return;
				const msg = r.message || {};
				let success_html;
				if (msg.refund_type === "payment") {
					success_html = `
					<div class="kqs-returns-success-card" style="background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);border-color:#93c5fd">
						<div class="kqs-returns-success-title" style="color:#1e40af">${__("Refund processed")}</div>
						<p>${__(
							"Credit note <strong>{0}</strong> submitted. Refund <strong>{1}</strong> via <strong>{2}</strong>.",
							[
								msg.credit_note,
								format_money(msg.refund_amount, msg.currency),
								frappe.utils.escape_html(msg.refund_mode || ""),
							]
						)}</p>
						<p class="small text-muted">${__(
							"Hand the refund to the customer and keep the credit note receipt."
						)}</p>
					</div>`;
				} else {
					success_html = `
					<div class="kqs-returns-success-card">
						<div class="kqs-returns-success-title">${__("Store credit added")}</div>
						<p>${__(
							"Credit note <strong>{0}</strong> created for <strong>{1}</strong>.",
							[msg.credit_note, customer]
						)}</p>
						<p>${__(
							"Credit this return: <strong>{0}</strong><br>Total available on account: <strong>{1}</strong>",
							[
								format_money(msg.credit_amount, msg.currency),
								format_money(msg.store_credit_balance, msg.currency),
							]
						)}</p>
						<p class="small text-muted">${__(
							"Customer can spend this credit on a normal POS sale at any till in this store."
						)}</p>
					</div>`;
				}
				layout.find(".kqs-returns-success").html(success_html);
				show_step("done");
			},
		});
	}

	function reset_flow() {
		selected_receipt = null;
		return_lines = [];
		loaded_receipts = [];
		refund_options = null;
		selected_refund_type = REFUND_TO_ACCOUNT;
		selected_refund_mode = null;
		if (customer_control) {
			customer_control.set_value("");
		}
		layout.find("#kqs-returns-customer-prompt").empty();
		layout.find(".kqs-returns-summary").empty();
		layout.find(".kqs-returns-filter-btn").removeClass("is-active");
		layout.find('.kqs-returns-filter-btn[data-filter="all"]').addClass("is-active");
		show_step("search");
		load_receipts(layout.find("#kqs-returns-search").val());
	}

	function ensure_dom() {
		if (layout) return;
		inject_styles();
		layout = $(`
			<div class="kqs-returns-app">
				<aside class="kqs-returns-sidebar">
					<p class="kqs-returns-sidebar-title">${__("Actions")}</p>
					<p class="kqs-returns-sidebar-hint"></p>
					<nav class="kqs-returns-sidebar-actions">
						<button type="button" class="btn btn-primary btn-sm kqs-returns-sidebar-btn kqs-returns-sidebar-back-sale">
							${__("Back to till")}
						</button>
						<button type="button" class="btn btn-default btn-sm kqs-returns-sidebar-btn kqs-returns-sidebar-refresh">
							${__("Refresh receipts")}
						</button>
						<button type="button" class="btn btn-default btn-sm kqs-returns-sidebar-btn kqs-returns-sidebar-another">
							${__("Another return")}
						</button>
						<button type="button" class="btn btn-default btn-sm kqs-returns-sidebar-btn kqs-returns-sidebar-go-search">
							${__("Find receipt")}
						</button>
					</nav>
					<div class="kqs-returns-sidebar-policy"></div>
				</aside>
				<div class="kqs-returns-main">
				<div class="kqs-returns-hero">
					<h2 class="kqs-returns-hero-title">${__("Returns & Store Credit")}</h2>
					<p class="kqs-returns-hero-sub">${__(
						"Find a receipt, return items, and credit the customer account at this store."
					)}</p>
					<div class="kqs-returns-hero-chips">
						<span class="kqs-returns-chip kqs-returns-chip-store">${__("This store")}</span>
						<span class="kqs-returns-chip kqs-returns-chip-search">${__("Search: 30 days")}</span>
						<span class="kqs-returns-chip kqs-returns-chip-return">${__("Returns: 14 days")}</span>
						<span class="kqs-returns-chip kqs-returns-chip-policy">${__("Default: account credit")}</span>
					</div>
				</div>
				<div class="kqs-returns-steps">
					<div class="kqs-returns-step-pill is-active" data-step="search">${__("1. Find receipt")}</div>
					<div class="kqs-returns-step-pill" data-step="items">${__("2. Pick items")}</div>
					<div class="kqs-returns-step-pill" data-step="customer">${__("3. Credit customer")}</div>
					<div class="kqs-returns-step-pill" data-step="done">${__("4. Done")}</div>
				</div>
				<div id="kqs-returns-customer-top" class="kqs-returns-customer-top d-none">
					<div class="kqs-returns-customer-field-block">
						<label class="kqs-returns-customer-field-label" for="kqs-returns-customer-input">
							${__("Customer name")}
						</label>
						<p class="kqs-returns-customer-field-hint">${__(
							"Search by name or mobile, or use + / New customer."
						)}</p>
						<div class="kqs-returns-customer-field-wrap">
							<div id="kqs-returns-customer-field"></div>
						</div>
					</div>
					<div class="kqs-returns-customer-tools">
						<button type="button" class="btn btn-default kqs-returns-customer-create">
							${__("New customer")}
						</button>
					</div>
					<div id="kqs-returns-customer-prompt" class="kqs-returns-customer-prompt"></div>
				</div>
				<div class="kqs-returns-step" data-step="search">
					<div class="kqs-returns-panel">
						<label class="small text-muted text-uppercase" style="letter-spacing:0.05em;font-weight:700">${__(
							"Search this store"
						)}</label>
						<div class="kqs-returns-search-row">
							<input type="search" class="form-control" id="kqs-returns-search"
								placeholder="${__("Receipt #, customer name, or mobile")}" />
							<button type="button" class="btn btn-primary btn-sm" id="kqs-returns-search-btn">${__(
								"Search"
							)}</button>
						</div>
						<div class="kqs-returns-filter-row">
							<button type="button" class="btn btn-default btn-xs kqs-returns-filter-btn is-active" data-filter="all">${__(
								"All"
							)}</button>
							<button type="button" class="btn btn-default btn-xs kqs-returns-filter-btn" data-filter="today">${__(
								"Today"
							)}</button>
							<button type="button" class="btn btn-default btn-xs kqs-returns-filter-btn" data-filter="week">${__(
								"This week"
							)}</button>
						</div>
						<div class="kqs-returns-list-meta"></div>
						<div id="kqs-returns-receipt-list" class="kqs-returns-receipt-list"></div>
					</div>
				</div>
				<div class="kqs-returns-step d-none" data-step="items">
					<div class="kqs-returns-panel">
						<div class="kqs-returns-receipt-header"></div>
						<div id="kqs-returns-items" class="kqs-returns-items"></div>
					</div>
				</div>
				<div class="kqs-returns-step d-none" data-step="customer">
					<div class="kqs-returns-panel">
						<div class="kqs-returns-summary"></div>
						<div class="kqs-returns-actions">
							<button type="button" class="btn btn-primary btn-lg kqs-returns-submit">
								${__("Credit customer account")}
							</button>
							<button type="button" class="btn btn-default btn-lg kqs-returns-back-items">${__("Back")}</button>
						</div>
					</div>
				</div>
				<div class="kqs-returns-step d-none" data-step="done">
					<div class="kqs-returns-panel">
						<div class="kqs-returns-success"></div>
						<div class="kqs-returns-actions">
							<button type="button" class="btn btn-primary btn-lg kqs-returns-new">${__("Another return")}</button>
							<button type="button" class="btn btn-default btn-lg kqs-returns-back-sale">${__(
								"Back to sale"
							)}</button>
						</div>
					</div>
				</div>
				</div>
			</div>
		`);

		layout.find("#kqs-returns-search").on("input", function () {
			clearTimeout(search_timer);
			const term = $(this).val();
			search_timer = setTimeout(() => load_receipts(term), 350);
		});
		layout.find("#kqs-returns-search-btn").on("click", () => load_receipts(layout.find("#kqs-returns-search").val()));

		layout.on("click", ".kqs-returns-filter-btn", function () {
			layout.find(".kqs-returns-filter-btn").removeClass("is-active");
			$(this).addClass("is-active");
			render_receipt_list(loaded_receipts);
		});

		layout.on("click", ".kqs-returns-receipt-card", function () {
			if (cint($(this).data("eligible")) !== 1) {
				frappe.msgprint({
					title: __("Outside return window"),
					indicator: "orange",
					message: __(
						"This receipt is past the return acceptance period ({0} days). Ask a manager or check KQS Retail Settings.",
						[store_context.return_window_days || 14]
					),
				});
				return;
			}
			const doctype = $(this).data("doctype");
			const name = $(this).data("name");
			const ctx = get_pos_context();
			frappe.call({
				method: "kqs_retail.api.returns.get_receipt_for_return",
				args: { doctype, name, pos_profile: ctx.pos_profile },
				freeze: true,
				callback(r) {
					if (r.exc) return;
					render_items(r.message);
				},
			});
		});

		layout.on("click", ".kqs-returns-customer-create", () => open_create_customer());
		layout.on("click", ".kqs-returns-sidebar-back-sale", () => kqs_retail.pos_returns.close());
		layout.on("click", ".kqs-returns-sidebar-refresh", () =>
			load_receipts(layout.find("#kqs-returns-search").val())
		);
		layout.on("click", ".kqs-returns-sidebar-another", () => reset_flow());
		layout.on("click", ".kqs-returns-sidebar-go-search", () => show_step("search"));

		layout.on("change", ".kqs-return-check", function () {
			const idx = $(this).closest("tr").data("idx");
			return_lines[idx].selected = $(this).is(":checked");
			if (!return_lines[idx].selected) {
				return_lines[idx].return_qty = 0;
				$(this).closest("tr").find(".kqs-return-qty").val(0);
			}
		});
		layout.on("change", ".kqs-return-check-all", function () {
			set_all_items($(this).is(":checked"));
		});
		layout.on("click", ".kqs-returns-select-all", () => set_all_items(true));
		layout.on("click", ".kqs-returns-select-none", () => set_all_items(false));
		layout.on("input", ".kqs-return-qty", function () {
			const idx = $(this).closest("tr").data("idx");
			const max = flt(return_lines[idx].returnable_qty);
			let val = flt($(this).val());
			if (val > max) val = max;
			if (val < 0) val = 0;
			$(this).val(val);
			return_lines[idx].return_qty = val;
			return_lines[idx].selected = val > 0;
			$(this).closest("tr").find(".kqs-return-check").prop("checked", val > 0);
		});
		layout.on("click", ".kqs-returns-continue", () => render_summary());
		layout.on("click", ".kqs-refund-mode-btn", function () {
			const type = $(this).data("refund-type");
			if (type === REFUND_TO_ACCOUNT) {
				selected_refund_type = REFUND_TO_ACCOUNT;
			} else {
				selected_refund_type = "payment";
				selected_refund_mode = $(this).data("mode") || null;
			}
			paint_refund_summary();
		});
		layout.on("click", ".kqs-returns-back-search", () => show_step("search"));
		layout.on("click", ".kqs-returns-back-items", () => show_step("items"));
		layout.on("click", ".kqs-returns-submit", submit_return);
		layout.on("click", ".kqs-returns-new", reset_flow);
		layout.on("click", ".kqs-returns-back-sale", () => kqs_retail.pos_returns.close());
		render_sidebar();
	}

	function clear_returns_layout_styles() {
		returns_scroll_root?.css({ minHeight: "", height: "" });
		returns_mount?.css({ minHeight: "", height: "", display: "", flexDirection: "" });
		$layer?.css({ minHeight: "", height: "", flex: "" });
	}

	function fit_returns_layer() {
		if (!active_pos || !$layer || $layer.hasClass("d-none")) return;
		const section = returns_scroll_root;
		const mount = returns_mount;
		if (!section?.length || !mount?.length) return;

		const top = section[0].getBoundingClientRect().top;
		const height = Math.max(400, window.innerHeight - top);

		section.css({ minHeight: height, height: height });
		mount.css({
			minHeight: height,
			height: height,
			display: "flex",
			flexDirection: "column",
		});
		$layer.css({ flex: "1 1 auto", minHeight: 0, height: "100%" });
	}

	function get_pos_mount(pos) {
		const mount = pos?.wrapper;
		return mount?.length ? mount : null;
	}

	function get_returns_scroll_root(pos) {
		const mount = get_pos_mount(pos);
		if (!mount) return null;
		const section = mount.closest(".layout-main-section");
		return section.length ? section : mount;
	}

	function open(pos) {
		const mount = get_pos_mount(pos);
		if (!mount) {
			frappe.msgprint(__("POS layout is not ready. Wait for the till to finish loading."));
			return;
		}
		if (!pos.$components_wrapper?.length) {
			frappe.msgprint(__("POS is still starting up. Try again in a moment."));
			return;
		}
		if (typeof kqs_retail?.pos_tools_menu?.close_other_overlays === "function") {
			kqs_retail.pos_tools_menu.close_other_overlays({ except: "returns" });
		}
		ensure_dom();
		active_pos = pos;

		if (!$layer) {
			$layer = $('<div class="kqs-pos-returns-layer d-none">').appendTo(mount);
			$layer.append(layout);
			customer_control = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					options: "Customer",
					label: __("Customer to credit"),
					placeholder: __("Search by customer name or mobile"),
					reqd: 1,
					get_query() {
						return { query: "kqs_retail.api.store_credit.customer_query_for_return_credit" };
					},
					onchange() {
						if (this.value) {
							update_customer_prompt_for_selection(this.value);
						}
					},
				},
				parent: layout.find("#kqs-returns-customer-field"),
				render_input: true,
			});
			customer_control.toggle_label(false);
			customer_control.$input?.attr("id", "kqs-returns-customer-input");
		}

		if (pos.recent_order_list?.$component?.is(":visible")) {
			pos.toggle_recent_order_list(false);
		}
		pos.$components_wrapper.hide();
		$layer.removeClass("d-none");
		returns_mount = mount;
		returns_mount.addClass("kqs-returns-mount-host");
		returns_scroll_root = get_returns_scroll_root(pos);
		returns_scroll_root?.addClass("kqs-returns-mount");
		fit_returns_layer();
		$(window).on("resize.kqsReturns", fit_returns_layer);
		pos.page.set_title(__("Returns & Store Credit"));
		pos.page.set_primary_action(__("Back to sale"), () => kqs_retail.pos_returns.close(), "arrow-left");
		if (pos.page.btn_secondary?.length) {
			pos.page.btn_secondary.hide();
		}
		reset_flow();
	}

	function close(opts = {}) {
		if (!active_pos) return;
		const pos = active_pos;
		const restore_pos = opts.restore_pos !== false;
		$layer?.addClass("d-none");
		$(window).off("resize.kqsReturns");
		returns_mount?.removeClass("kqs-returns-mount-host");
		returns_mount = null;
		returns_scroll_root?.removeClass("kqs-returns-mount");
		clear_returns_layout_styles();
		returns_scroll_root = null;
		if (restore_pos) {
			pos.$components_wrapper.show();
			pos.page.set_title(__("Point of Sale"));
			pos.page.set_primary_action(__("New Invoice"), () => pos.new_invoice_event());
			pos.page.set_secondary_action(__("Recent Orders"), () => pos.toggle_recent_order());
			if (pos.page.btn_secondary?.length) {
				pos.page.btn_secondary.show();
			}
		}
		active_pos = null;
	}

	function is_open() {
		return Boolean(active_pos && $layer && !$layer.hasClass("d-none"));
	}

	return { open, close, is_open };
})();

/* Copyright (c) 2026, KQS â€” Customer Account hub for ERPNext Point of Sale */
const KQS_CUSTOMER_ACCOUNT_HUB_VERSION = 3;
const CA_META_SEP = " | ";

frappe.provide("kqs_retail.pos_customer_account");

kqs_retail.pos_customer_account = (function () {
	let active_pos = null;
	let $layer = null;
	let layout = null;
	let search_timer = null;
	let hub_mount = null;
	let hub_scroll_root = null;
	let loaded_customers = [];
	let selected_customer = null;
	let customer_summary = null;
	let customer_ar_details = null;
	let customer_history = [];
	let current_view = "browse";
	let current_tab = "overview";
	let list_filter = "all";
	let payment_state = null;

	const TABS = ["overview", "history", "invoices", "laybys", "pay"];
	const STORE_CREDIT_MODES = ["Store Credit", "Account Balance"];
	const ACCOUNT_MODES = ["On Account", "Account"];

	function esc(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	function money(amount, currency) {
		return format_currency(flt(amount), currency || get_currency());
	}

	function get_currency() {
		return active_pos?.frm?.doc?.currency || frappe.defaults.get_default("currency");
	}

	function get_company() {
		return active_pos?.frm?.doc?.company || frappe.defaults.get_default("company");
	}

	function is_walk_in(name) {
		if (!name) return true;
		const lower = String(name).toLowerCase();
		return lower.includes("walk-in") || lower.includes("walk in");
	}

	function is_store_credit_mode(mode) {
		if (!mode) return false;
		return STORE_CREDIT_MODES.includes(mode);
	}

	function is_account_sale_mode(mode) {
		if (!mode) return false;
		return ACCOUNT_MODES.includes(mode);
	}

	function is_physical_cash_mode(mode) {
		return String(mode || "")
			.trim()
			.toLowerCase() === "cash";
	}

	function sanitize_mode_key(mode) {
		return (mode || "")
			.replace(/ +/g, "_")
			.replace(/[^\p{L}\p{N}_-]/gu, "")
			.replace(/^[^_a-zA-Z\p{L}]+/u, "")
			.toLowerCase();
	}

	function get_ar_payment_modes() {
		const frm = active_pos?.frm;
		const modes = (frm?.doc?.payments || []).map((row) => row.mode_of_payment).filter(Boolean);
		const list = modes.length ? modes : ["Cash"];
		return list.filter((mode) => !is_store_credit_mode(mode) && !is_account_sale_mode(mode));
	}

	function inject_styles() {
		const style_id = `kqs-customer-account-styles-v${KQS_CUSTOMER_ACCOUNT_HUB_VERSION}`;
		document.querySelectorAll('[id^="kqs-customer-account-styles"]').forEach((el) => el.remove());
		if (document.getElementById(style_id)) return;
		const style = document.createElement("style");
		style.id = style_id;
		style.textContent = `
			[data-page-route="point-of-sale"] .layout-main-section.kqs-customer-account-mount {
				padding-bottom: 0 !important;
				margin-bottom: 0 !important;
				overflow: hidden;
				background: #f8fafc !important;
			}
			.point-of-sale-app.kqs-customer-account-mount-host {
				width: 100%;
				box-sizing: border-box;
				background: #f8fafc;
			}
			.kqs-pos-customer-account-layer {
				display: none;
				flex: 1 1 auto;
				width: 100%;
				min-height: 0;
				overflow: hidden;
				background: #f8fafc;
			}
			.kqs-pos-customer-account-layer:not(.d-none) {
				display: flex;
				flex-direction: column;
			}
			.kqs-ca-app {
				flex: 1 1 auto;
				display: flex;
				flex-direction: row;
				align-items: stretch;
				width: 100%;
				height: 100%;
				min-height: 0;
				box-sizing: border-box;
			}
			.kqs-ca-list-panel {
				flex: 0 0 17rem;
				width: 17rem;
				background: #fff;
				border-right: 1px solid #e2e8f0;
				display: flex;
				flex-direction: column;
				min-height: 0;
			}
			.kqs-ca-list-head {
				padding: 0.75rem 0.8rem 0.55rem;
				border-bottom: 1px solid #e2e8f0;
			}
			.kqs-ca-list-title {
				font-size: 11px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.07em;
				color: #64748b;
				margin: 0 0 0.45rem;
			}
			.kqs-ca-search-row {
				display: flex;
				gap: 0.35rem;
			}
			.kqs-ca-search-row input {
				flex: 1;
				border-radius: 8px;
				font-size: 12px;
			}
			.kqs-ca-filter-row {
				display: flex;
				flex-wrap: wrap;
				gap: 0.3rem;
				margin-top: 0.5rem;
			}
			.kqs-ca-filter-btn {
				border-radius: 999px;
				font-size: 10px;
				font-weight: 600;
				padding: 0.15rem 0.45rem;
				border: 1px solid #e2e8f0;
				background: #fff;
				color: #64748b;
			}
			.kqs-ca-filter-btn.is-active {
				background: #0f172a;
				border-color: #0f172a;
				color: #fff;
			}
			.kqs-ca-customer-list {
				flex: 1 1 auto;
				overflow-y: auto;
				padding: 0.45rem 0.55rem 0.65rem;
			}
			.kqs-ca-customer-card {
				display: block;
				width: 100%;
				text-align: left;
				border: 1px solid #e2e8f0;
				border-radius: 10px;
				padding: 0.55rem 0.6rem;
				margin-bottom: 0.4rem;
				background: #fff;
				cursor: pointer;
				transition: border-color 0.15s, box-shadow 0.15s;
			}
			.kqs-ca-customer-card:hover {
				border-color: #cbd5e1;
				box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
			}
			.kqs-ca-customer-card.is-selected {
				border-color: #2563eb;
				background: #eff6ff;
				box-shadow: 0 0 0 1px #2563eb;
			}
			.kqs-ca-customer-name {
				font-size: 13px;
				font-weight: 700;
				color: #0f172a;
				line-height: 1.25;
			}
			.kqs-ca-customer-phone {
				font-size: 11px;
				color: #64748b;
				margin-top: 0.1rem;
			}
			.kqs-ca-customer-badges {
				display: flex;
				flex-wrap: wrap;
				gap: 0.25rem;
				margin-top: 0.35rem;
			}
			.kqs-ca-badge {
				font-size: 10px;
				font-weight: 600;
				padding: 0.1rem 0.35rem;
				border-radius: 999px;
			}
			.kqs-ca-badge-owes { background: #fef2f2; color: #b91c1c; }
			.kqs-ca-badge-credit { background: #ecfdf5; color: #047857; }
			.kqs-ca-badge-layby { background: #eff6ff; color: #1d4ed8; }
			.kqs-ca-list-meta {
				font-size: 10px;
				color: #94a3b8;
				padding: 0 0.15rem 0.35rem;
			}
			.kqs-ca-sidebar-foot {
				padding: 0.55rem 0.8rem;
				border-top: 1px solid #e2e8f0;
			}
			.kqs-ca-sidebar-foot .btn {
				width: 100%;
				border-radius: 8px;
				font-size: 11px;
				font-weight: 600;
			}
			.kqs-ca-main {
				flex: 1 1 auto;
				min-width: 0;
				overflow-x: hidden;
				overflow-y: auto;
				padding: 0.75rem 1rem 1rem;
			}
			.kqs-ca-empty {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				min-height: 320px;
				text-align: center;
				color: #64748b;
				padding: 2rem 1rem;
			}
			.kqs-ca-empty-icon {
				font-size: 2.5rem;
				margin-bottom: 0.65rem;
				opacity: 0.5;
			}
			.kqs-ca-empty-title {
				font-size: 1.15rem;
				font-weight: 700;
				color: #0f172a;
				margin-bottom: 0.35rem;
			}
			.kqs-ca-hero {
				border-radius: 12px;
				padding: 1rem 1.1rem;
				background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
				color: #fff;
				margin-bottom: 0.75rem;
			}
			.kqs-ca-hero-top {
				display: flex;
				flex-wrap: wrap;
				align-items: flex-start;
				justify-content: space-between;
				gap: 0.65rem;
			}
			.kqs-ca-hero-name {
				font-size: 1.35rem;
				font-weight: 800;
				margin: 0;
				letter-spacing: -0.02em;
				color: #fff !important;
			}
			.kqs-ca-hero-meta {
				font-size: 12px;
				color: rgba(255, 255, 255, 0.88) !important;
				margin-top: 0.2rem;
			}
			.kqs-ca-hero .kqs-ca-stat-label,
			.kqs-ca-hero .kqs-ca-stat-value {
				color: #fff;
			}
			.kqs-ca-hero-actions .btn {
				border-radius: 8px;
				font-size: 11px;
				font-weight: 600;
			}
			.kqs-ca-stat-grid {
				display: grid;
				grid-template-columns: repeat(4, minmax(0, 1fr));
				gap: 0.55rem;
				margin-top: 0.85rem;
			}
			.kqs-ca-stat-card {
				background: rgba(255,255,255,0.12);
				border: 1px solid rgba(255,255,255,0.18);
				border-radius: 10px;
				padding: 0.55rem 0.65rem;
			}
			.kqs-ca-stat-label {
				font-size: 10px;
				text-transform: uppercase;
				letter-spacing: 0.05em;
				opacity: 0.8;
			}
			.kqs-ca-stat-value {
				font-size: 1.05rem;
				font-weight: 800;
				margin-top: 0.15rem;
			}
			.kqs-ca-stat-value.is-danger { color: #fecaca; }
			.kqs-ca-stat-value.is-success { color: #a7f3d0; }
			.kqs-ca-tabs {
				display: flex;
				flex-wrap: wrap;
				gap: 0.35rem;
				margin-bottom: 0.65rem;
			}
			.kqs-ca-tab {
				border: 1px solid #e2e8f0;
				background: #fff;
				border-radius: 999px;
				padding: 0.3rem 0.75rem;
				font-size: 11px;
				font-weight: 600;
				color: #64748b;
				cursor: pointer;
			}
			.kqs-ca-tab.is-active {
				background: #0f172a;
				border-color: #0f172a;
				color: #fff;
			}
			.kqs-ca-panel {
				background: #fff;
				border: 1px solid #e2e8f0;
				border-radius: 12px;
				padding: 0.85rem 0.95rem;
			}
			.kqs-ca-panel-title {
				font-size: 12px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0.05em;
				color: #64748b;
				margin: 0 0 0.65rem;
			}
			.kqs-ca-table {
				width: 100%;
				margin-bottom: 0;
				font-size: 12px;
			}
			.kqs-ca-table thead th {
				background: #f8fafc;
				font-size: 10px;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: #64748b;
				border-bottom: 1px solid #e2e8f0;
			}
			.kqs-ca-table tbody td {
				vertical-align: middle;
				border-color: #f1f5f9;
			}
			.kqs-ca-history-row {
				display: grid;
				grid-template-columns: auto 1fr auto;
				gap: 0.65rem;
				align-items: start;
				padding: 0.55rem 0;
				border-bottom: 1px solid #f1f5f9;
			}
			.kqs-ca-history-row:last-child { border-bottom: none; }
			.kqs-ca-history-icon {
				width: 2rem;
				height: 2rem;
				border-radius: 999px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 11px;
				font-weight: 700;
			}
			.kqs-ca-history-icon.debit { background: #fef2f2; color: #b91c1c; }
			.kqs-ca-history-icon.credit { background: #ecfdf5; color: #047857; }
			.kqs-ca-history-icon.credit_customer { background: #eff6ff; color: #1d4ed8; }
			.kqs-ca-history-label { font-weight: 700; color: #0f172a; font-size: 13px; }
			.kqs-ca-history-meta { font-size: 11px; color: #64748b; margin-top: 0.1rem; }
			.kqs-ca-history-amount { font-weight: 800; font-size: 13px; text-align: right; }
			.kqs-ca-history-amount.debit { color: #b91c1c; }
			.kqs-ca-history-amount.credit { color: #047857; }
			.kqs-ca-history-amount.credit_customer { color: #1d4ed8; }
			.kqs-ca-pay-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 0.75rem;
			}
			.kqs-ca-pay-summary {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 0.45rem;
				margin-bottom: 0.65rem;
			}
			.kqs-ca-pay-card {
				border: 1px solid #e2e8f0;
				border-radius: 10px;
				padding: 0.5rem 0.65rem;
				background: #f8fafc;
			}
			.kqs-ca-pay-card .label { font-size: 10px; color: #64748b; text-transform: uppercase; }
			.kqs-ca-pay-card .value { font-size: 1rem; font-weight: 800; color: #0f172a; }
			.kqs-ca-mop-grid {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 0.4rem;
				margin-bottom: 0.55rem;
			}
			.kqs-ca-mop-tile {
				border: 1px solid #e2e8f0;
				border-radius: 10px;
				padding: 0.45rem 0.55rem;
				background: #fff;
				cursor: pointer;
				text-align: left;
			}
			.kqs-ca-mop-tile.is-selected {
				border-color: #2563eb;
				background: #eff6ff;
			}
			.kqs-ca-mop-label { font-size: 11px; font-weight: 700; color: #0f172a; }
			.kqs-ca-mop-amount { font-size: 12px; font-weight: 700; color: #2563eb; margin-top: 0.15rem; min-height: 1rem; }
			.kqs-ca-numpad-panel {
				display: flex;
				flex-direction: column;
				min-width: 0;
			}
			.kqs-ca-numpad-panel .number-pad,
			.kqs-ca-numpad-panel .kqs-ca-numpad {
				position: static;
				flex: 1 1 auto;
				display: block;
				width: 100%;
				min-height: 220px;
			}
			.kqs-ca-numpad-panel .numpad-container {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 0.5rem;
				width: 100%;
				background-color: #f8fafc;
				border: 1px solid #e2e8f0;
				border-radius: 10px;
				padding: 0.5rem;
				box-sizing: border-box;
			}
			.kqs-ca-numpad-panel .numpad-btn {
				display: flex;
				align-items: center;
				justify-content: center;
				min-height: 2.75rem;
				padding: 0.45rem;
				border-radius: 8px;
				border: 1px solid #e2e8f0;
				background: #fff;
				box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
				font-size: 15px;
				font-weight: 700;
				color: #0f172a;
				cursor: pointer;
				user-select: none;
				width: 100%;
			}
			.kqs-ca-numpad-panel .numpad-btn:hover {
				background-color: #f1f5f9;
			}
			.kqs-ca-pay-actions { margin-top: 0.65rem; }
			.kqs-ca-pay-actions .btn { border-radius: 8px; font-weight: 700; }
			.kqs-ca-quick-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 0.4rem;
				margin-top: 0.65rem;
			}
			.kqs-ca-quick-actions .btn { border-radius: 8px; font-size: 11px; font-weight: 600; }
			@media (max-width: 900px) {
				.kqs-ca-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
				.kqs-ca-pay-grid { grid-template-columns: 1fr; }
			}
		`;
		document.head.appendChild(style);
	}

	function ensure_dom() {
		if (layout) return;
		inject_styles();
		layout = $(`
			<div class="kqs-ca-app">
				<aside class="kqs-ca-list-panel">
					<div class="kqs-ca-list-head">
						<p class="kqs-ca-list-title">${__("Customers")}</p>
						<div class="kqs-ca-search-row">
							<input type="search" class="form-control input-sm" id="kqs-ca-search"
								placeholder="${__("Name or mobile")}" />
						</div>
						<div class="kqs-ca-filter-row">
							<button type="button" class="kqs-ca-filter-btn is-active" data-filter="all">${__("All")}</button>
							<button type="button" class="kqs-ca-filter-btn" data-filter="owes">${__("Owes")}</button>
							<button type="button" class="kqs-ca-filter-btn" data-filter="credit">${__("Credit")}</button>
							<button type="button" class="kqs-ca-filter-btn" data-filter="layby">${__("Layby")}</button>
							<button type="button" class="kqs-ca-filter-btn" data-filter="active">${__("Active")}</button>
						</div>
					</div>
					<div class="kqs-ca-list-meta"></div>
					<div class="kqs-ca-customer-list" id="kqs-ca-customer-list"></div>
					<div class="kqs-ca-sidebar-foot">
						<button type="button" class="btn btn-primary btn-sm kqs-ca-back-sale">${__("Back to till")}</button>
					</div>
				</aside>
				<div class="kqs-ca-main" id="kqs-ca-main"></div>
			</div>
		`);

		layout.find("#kqs-ca-search").on("input", function () {
			clearTimeout(search_timer);
			const term = $(this).val();
			search_timer = setTimeout(() => load_customers(term), 300);
		});

		layout.on("click", ".kqs-ca-filter-btn", function () {
			layout.find(".kqs-ca-filter-btn").removeClass("is-active");
			$(this).addClass("is-active");
			list_filter = $(this).data("filter") || "all";
			load_customers(layout.find("#kqs-ca-search").val());
		});

		layout.on("click", ".kqs-ca-customer-card", function () {
			const customer = $(this).data("customer");
			if (customer) select_customer(customer);
		});

		layout.on("click", ".kqs-ca-back-sale", () => kqs_retail.pos_customer_account.close());
		layout.on("click", ".kqs-ca-tab", function () {
			const tab = $(this).data("tab");
			if (tab) show_tab(tab);
		});
		layout.on("click", ".kqs-ca-go-pay", () => show_tab("pay"));
		layout.on("click", ".kqs-ca-refresh-customer", () => {
			if (selected_customer) select_customer(selected_customer, true);
		});
		layout.on("click", ".kqs-ca-use-on-sale", () => {
			if (!selected_customer || !active_pos) return;
			active_pos.frm.set_value("customer", selected_customer);
			kqs_retail.pos_customer_account.close();
			frappe.show_alert({
				message: __("Customer selected on current sale."),
				indicator: "green",
			});
		});
		layout.on("click", ".kqs-ca-mop-tile", function () {
			const key = $(this).data("mode-key");
			if (key) select_payment_mode(key);
		});
		layout.on("click", ".kqs-ca-record-payment", submit_payment);
	}

	function render_empty_main() {
		layout.find("#kqs-ca-main").html(`
			<div class="kqs-ca-empty">
				<div class="kqs-ca-empty-icon">ðŸ‘¤</div>
				<div class="kqs-ca-empty-title">${__("Customer Account")}</div>
				<p>${__(
					"Search and select a customer to view balances, transaction history, open invoices, laybys, and collect payments."
				)}</p>
			</div>
		`);
	}

	function render_customer_list(rows) {
		const $list = layout.find("#kqs-ca-customer-list");
		const $meta = layout.find(".kqs-ca-list-meta");
		if (!rows?.length) {
			$meta.text(__("No customers match this search."));
			$list.html(
				`<p class="text-muted small text-center" style="padding:1rem 0">${__(
					"Try a different name, phone number, or filter."
				)}</p>`
			);
			return;
		}
		$meta.text(__("{0} customers", [rows.length]));
		const currency = get_currency();
		$list.html(
			rows
				.map((row) => {
					const selected = row.customer === selected_customer ? " is-selected" : "";
					const badges = [];
					if (flt(row.ar_outstanding) > 0) {
						badges.push(
							`<span class="kqs-ca-badge kqs-ca-badge-owes">${__("Owes")} ${money(
								row.ar_outstanding,
								currency
							)}</span>`
						);
					}
					if (flt(row.store_credit_balance) > 0) {
						badges.push(
							`<span class="kqs-ca-badge kqs-ca-badge-credit">${__("Credit")} ${money(
								row.store_credit_balance,
								currency
							)}</span>`
						);
					}
					if (flt(row.layby_balance_total) > 0) {
						badges.push(
							`<span class="kqs-ca-badge kqs-ca-badge-layby">${__("Layby")} ${money(
								row.layby_balance_total,
								currency
							)}</span>`
						);
					}
					return `<button type="button" class="kqs-ca-customer-card${selected}" data-customer="${esc(
						row.customer
					)}">
						<div class="kqs-ca-customer-name">${esc(row.customer_name || row.customer)}</div>
						${row.mobile_no ? `<div class="kqs-ca-customer-phone">${esc(row.mobile_no)}</div>` : ""}
						<div class="kqs-ca-customer-badges">${badges.join("") || `<span class="kqs-ca-badge">${__("No balance")}</span>`}</div>
					</button>`;
				})
				.join("")
		);
	}

	function load_customers(query) {
		frappe.call({
			method: "kqs_retail.api.customer_account.search_customers_for_account_hub",
			args: {
				query: query || "",
				company: get_company(),
				filter_type: list_filter,
				limit: 40,
			},
			callback(r) {
				if (r.exc) return;
				loaded_customers = r.message || [];
				render_customer_list(loaded_customers);
			},
		});
	}

	function select_customer(customer, force_reload) {
		if (!customer || is_walk_in(customer)) return;
		if (selected_customer === customer && !force_reload && customer_summary) {
			render_customer_detail();
			return;
		}
		selected_customer = customer;
		render_customer_list(loaded_customers);

		const company = get_company();
		const warehouse = active_pos?.frm?.doc?.set_warehouse || "";

		frappe.call({
			method: "kqs_retail.api.customer_account.get_customer_account_summary",
			args: { customer, company, warehouse, include_credit_notes: 1 },
			freeze: true,
			callback(r1) {
				if (r1.exc) return;
				customer_summary = r1.message || {};
				frappe.call({
					method: "kqs_retail.api.customer_account.get_customer_ar_details_api",
					args: { customer, company },
					callback(r2) {
						if (!r2.exc) customer_ar_details = r2.message || {};
						frappe.call({
							method: "kqs_retail.api.customer_account.get_customer_account_history_api",
							args: { customer, company, limit: 60 },
							callback(r3) {
								if (!r3.exc) customer_history = r3.message || [];
								current_view = "detail";
								show_tab(current_tab || "overview");
							},
						});
					},
				});
			},
		});
	}

	function show_tab(tab) {
		if (!TABS.includes(tab)) tab = "overview";
		current_tab = tab;
		render_customer_detail();
		if (tab === "pay") init_payment_panel();
	}

	function render_customer_detail() {
		if (!selected_customer || !customer_summary) {
			render_empty_main();
			return;
		}

		const currency = get_currency();
		const name =
			customer_summary.customer_name ||
			(loaded_customers.find((c) => c.customer === selected_customer) || {}).customer_name ||
			selected_customer;
		const phone =
			(loaded_customers.find((c) => c.customer === selected_customer) || {}).mobile_no || "";
		const ar = flt(customer_summary.ar_outstanding);
		const credit = flt(customer_summary.store_credit_balance);
		const layby = flt(customer_summary.layby_balance_total);
		const limit = flt(customer_summary.credit_limit);
		const available = flt(customer_summary.credit_available);
		const allow = customer_summary.allow_account_sales ? __("Yes") : __("No");

		const tabs_html = TABS.map((tab) => {
			const labels = {
				overview: __("Overview"),
				history: __("History"),
				invoices: __("Invoices"),
				laybys: __("Laybys"),
				pay: __("Collect Payment"),
			};
			const active = tab === current_tab ? " is-active" : "";
			return `<button type="button" class="kqs-ca-tab${active}" data-tab="${tab}">${labels[tab]}</button>`;
		}).join("");

		let panel_html = "";
		if (current_tab === "overview") panel_html = render_overview_panel(currency);
		else if (current_tab === "history") panel_html = render_history_panel(currency);
		else if (current_tab === "invoices") panel_html = render_invoices_panel(currency);
		else if (current_tab === "laybys") panel_html = render_laybys_panel(currency);
		else if (current_tab === "pay") panel_html = render_pay_panel(currency);

		layout.find("#kqs-ca-main").html(`
			<div class="kqs-ca-hero">
				<div class="kqs-ca-hero-top">
					<div>
						<h2 class="kqs-ca-hero-name">${esc(name)}</h2>
						<div class="kqs-ca-hero-meta">
							${phone ? esc(phone) + CA_META_SEP : ""}${esc(selected_customer)}
							${customer_summary.allow_account_sales ? CA_META_SEP + __("Account sales enabled") : ""}
						</div>
					</div>
					<div class="kqs-ca-hero-actions">
						<button type="button" class="btn btn-default btn-xs kqs-ca-refresh-customer">${__("Refresh")}</button>
						<button type="button" class="btn btn-default btn-xs kqs-ca-use-on-sale">${__("Use on sale")}</button>
						${ar > 0 ? `<button type="button" class="btn btn-primary btn-xs kqs-ca-go-pay">${__("Collect payment")}</button>` : ""}
					</div>
				</div>
				<div class="kqs-ca-stat-grid">
					<div class="kqs-ca-stat-card">
						<div class="kqs-ca-stat-label">${__("Amount Owed")}</div>
						<div class="kqs-ca-stat-value ${ar > 0 ? "is-danger" : ""}">${money(ar, currency)}</div>
					</div>
					<div class="kqs-ca-stat-card">
						<div class="kqs-ca-stat-label">${__("Store Credit")}</div>
						<div class="kqs-ca-stat-value ${credit > 0 ? "is-success" : ""}">${money(credit, currency)}</div>
					</div>
					<div class="kqs-ca-stat-card">
						<div class="kqs-ca-stat-label">${__("Layby Balance")}</div>
						<div class="kqs-ca-stat-value">${money(layby, currency)}</div>
					</div>
					<div class="kqs-ca-stat-card">
						<div class="kqs-ca-stat-label">${__("Credit Available")}</div>
						<div class="kqs-ca-stat-value">${limit > 0 ? money(available, currency) : __("Not set")}</div>
					</div>
				</div>
			</div>
			<div class="kqs-ca-tabs">${tabs_html}</div>
			<div class="kqs-ca-panel">${panel_html}</div>
		`);
	}

	function render_overview_panel(currency) {
		const recent = (customer_history || []).slice(0, 5);
		const invoices = customer_ar_details?.invoices || [];
		const laybys = customer_summary?.active_laybys || [];
		const notes = customer_summary?.store_credit_notes || [];

		let recent_html = "";
		if (!recent.length) {
			recent_html = `<p class="text-muted small">${__("No account activity yet.")}</p>`;
		} else {
			recent_html = recent.map((row) => history_row_html(row, currency)).join("");
		}

		return `
			<p class="kqs-ca-panel-title">${__("Account snapshot")}</p>
			<div class="row">
				<div class="col-sm-6">
					<p class="small text-muted">${__("Open invoices")}: <strong>${invoices.length}</strong></p>
					<p class="small text-muted">${__("Active laybys")}: <strong>${laybys.length}</strong></p>
					<p class="small text-muted">${__("Store credit notes")}: <strong>${notes.length}</strong></p>
					<p class="small text-muted">${__("Account sales")}: <strong>${customer_summary.allow_account_sales ? __("Allowed") : __("Not allowed")}</strong></p>
				</div>
				<div class="col-sm-6">
					<div class="kqs-ca-quick-actions">
						<button type="button" class="btn btn-default btn-sm kqs-ca-tab" data-tab="history">${__("Full history")}</button>
						<button type="button" class="btn btn-default btn-sm kqs-ca-tab" data-tab="invoices">${__("Open invoices")}</button>
						${flt(customer_summary.ar_outstanding) > 0 ? `<button type="button" class="btn btn-primary btn-sm kqs-ca-go-pay">${__("Collect payment")}</button>` : ""}
					</div>
				</div>
			</div>
			<hr>
			<p class="kqs-ca-panel-title">${__("Recent activity")}</p>
			${recent_html}
		`;
	}

	function history_row_html(row, currency) {
		const dir = row.direction || "debit";
		const icon_map = {
			account_sale: "+",
			ar_payment: "-",
			store_credit: "C",
			layby_payment: "L",
		};
		const sign = dir === "debit" ? "+" : dir === "credit_customer" ? "" : "-";
		const amount_class = dir;
		return `<div class="kqs-ca-history-row">
			<div class="kqs-ca-history-icon ${dir}">${icon_map[row.type] || "-"}</div>
			<div>
				<div class="kqs-ca-history-label">${esc(row.label || row.type)}</div>
				<div class="kqs-ca-history-meta">
					${frappe.datetime.str_to_user(row.date)}${CA_META_SEP}${esc(row.reference_name || "")}
					${row.detail ? CA_META_SEP + esc(String(row.detail)) : ""}
				</div>
			</div>
			<div class="kqs-ca-history-amount ${amount_class}">${sign}${money(row.amount, currency)}</div>
		</div>`;
	}

	function render_history_panel(currency) {
		if (!customer_history?.length) {
			return `<p class="text-muted">${__("No transactions recorded for this customer yet.")}</p>`;
		}
		return `<p class="kqs-ca-panel-title">${__("Account history")}</p>${customer_history
			.map((row) => history_row_html(row, currency))
			.join("")}`;
	}

	function render_invoices_panel(currency) {
		const invoices = customer_ar_details?.invoices || [];
		if (!invoices.length) {
			return `<p class="text-muted">${__("No open on-account invoices.")}</p>`;
		}
		const rows = invoices
			.map(
				(inv) => `<tr>
				<td>${frappe.datetime.str_to_user(inv.posting_date)}</td>
				<td>${esc(inv.name)}</td>
				<td class="text-right">${money(inv.grand_total, currency)}</td>
				<td class="text-right"><strong>${money(inv.outstanding_amount, currency)}</strong></td>
			</tr>`
			)
			.join("");
		return `
			<p class="kqs-ca-panel-title">${__("Open invoices")}</p>
			<table class="table table-sm kqs-ca-table">
				<thead><tr>
					<th>${__("Date")}</th><th>${__("Invoice")}</th>
					<th class="text-right">${__("Total")}</th><th class="text-right">${__("Outstanding")}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		`;
	}

	function render_laybys_panel(currency) {
		const laybys = customer_summary?.active_laybys || [];
		if (!laybys.length) {
			return `<p class="text-muted">${__("No active layby agreements.")}</p>`;
		}
		const rows = laybys
			.map(
				(lb) => `<tr>
				<td>${esc(lb.name)}</td>
				<td>${lb.due_date ? frappe.datetime.str_to_user(lb.due_date) : "-"}</td>
				<td class="text-right">${money(lb.total_amount, currency)}</td>
				<td class="text-right">${money(lb.paid_amount, currency)}</td>
				<td class="text-right"><strong>${money(lb.balance_amount, currency)}</strong></td>
			</tr>`
			)
			.join("");
		return `
			<p class="kqs-ca-panel-title">${__("Active laybys")}</p>
			<table class="table table-sm kqs-ca-table">
				<thead><tr>
					<th>${__("Agreement")}</th><th>${__("Due")}</th>
					<th class="text-right">${__("Total")}</th><th class="text-right">${__("Paid")}</th><th class="text-right">${__("Balance")}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
			<p class="small text-muted">${__("Open Point of Sale → Menu → Layby Lookup & Pay for payments, changes, or cancel.")}</p>
		`;
	}

	function render_pay_panel(currency) {
		const balance = flt(customer_ar_details?.ar_outstanding || customer_summary?.ar_outstanding);
		if (balance <= 0) {
			return `<p class="text-muted">${__("This customer has no outstanding account balance to collect.")}</p>`;
		}
		const modes = get_ar_payment_modes();
		if (!modes.length) {
			return `<p class="text-muted">${__("No cash or mobile payment modes are configured on this POS profile.")}</p>`;
		}
		return `
			<p class="kqs-ca-panel-title">${__("Collect account payment")}</p>
			<div class="kqs-ca-pay-summary">
				<div class="kqs-ca-pay-card">
					<div class="label">${__("Amount owed")}</div>
					<div class="value kqs-ca-balance-due">${money(balance, currency)}</div>
				</div>
				<div class="kqs-ca-pay-card">
					<div class="label">${__("Paying today")}</div>
					<div class="value kqs-ca-paying-today">${money(0, currency)}</div>
				</div>
				<div class="kqs-ca-pay-card">
					<div class="label">${__("Remaining")}</div>
					<div class="value kqs-ca-remaining">${money(balance, currency)}</div>
				</div>
				<div class="kqs-ca-pay-card kqs-ca-change-card d-none">
					<div class="label">${__("Change")}</div>
					<div class="value kqs-ca-change">${money(0, currency)}</div>
				</div>
			</div>
			<div class="kqs-ca-pay-grid">
				<div>
					<p class="small text-muted">${__("Tap a method, enter amount on keypad.")}</p>
					<div class="kqs-ca-mop-grid" id="kqs-ca-mop-grid">
						${modes
							.map(
								(mode) => `<button type="button" class="kqs-ca-mop-tile" data-mode-key="${sanitize_mode_key(mode)}">
								<div class="kqs-ca-mop-label">${esc(mode)}</div>
								<div class="kqs-ca-mop-amount" data-mop="${sanitize_mode_key(mode)}"></div>
							</button>`
							)
							.join("")}
					</div>
					<div id="kqs-ca-entry-fields"></div>
					<div class="kqs-ca-entry-change" style="display:none;margin-top:0.45rem;padding:0.45rem 0.55rem;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0">
						<span class="small text-muted">${__("Change")}</span>
						<span class="kqs-ca-entry-change-amount" style="display:block;font-size:1.15rem;font-weight:800;color:#0f172a"></span>
					</div>
					<div class="kqs-ca-pay-actions">
						<button type="button" class="btn btn-primary btn-lg kqs-ca-record-payment">${__("Record Payment")}</button>
					</div>
				</div>
				<div class="kqs-ca-numpad-panel">
					<div class="kqs-ca-numpad number-pad" id="kqs-ca-numpad"></div>
				</div>
			</div>
		`;
	}

	function init_payment_panel() {
		if (current_tab !== "pay") return;
		const modes = get_ar_payment_modes();
		if (!modes.length) return;

		payment_state = {
			modes,
			amounts: Object.fromEntries(modes.map((m) => [m, 0])),
			tendered: Object.fromEntries(modes.map((m) => [m, 0])),
			selected_mode: null,
			numpad_target: "paying",
			numpad_value: "",
			paying_control: null,
			tendered_control: null,
			numpad: null,
		};

		const $fields = layout.find("#kqs-ca-entry-fields");
		$fields.html(`
			<div class="kqs-ca-entry-paying" style="margin-top:0.5rem"></div>
			<div class="kqs-ca-entry-tendered" style="margin-top:0.35rem"></div>
		`);

		payment_state.paying_control = frappe.ui.form.make_control({
			df: {
				label: __("Paying"),
				fieldtype: "Currency",
				onchange() {
					if (!payment_state?.selected_mode) return;
					payment_state.amounts[payment_state.selected_mode] = flt(this.value);
					refresh_payment_ui();
				},
			},
			parent: $fields.find(".kqs-ca-entry-paying"),
			render_input: true,
		});
		payment_state.paying_control.$input.on("input", function () {
			if (!payment_state?.selected_mode) return;
			payment_state.amounts[payment_state.selected_mode] = flt($(this).val());
			refresh_payment_ui();
		});

		payment_state.tendered_control = frappe.ui.form.make_control({
			df: {
				label: __("Customer Gave"),
				fieldtype: "Currency",
				onchange() {
					if (!payment_state?.selected_mode) return;
					payment_state.tendered[payment_state.selected_mode] = flt(this.value);
					refresh_payment_ui();
				},
			},
			parent: $fields.find(".kqs-ca-entry-tendered"),
			render_input: true,
		});
		payment_state.tendered_control.$input.on("input", function () {
			if (!payment_state?.selected_mode) return;
			payment_state.tendered[payment_state.selected_mode] = flt($(this).val());
			refresh_payment_ui();
		});

		$fields.find(".kqs-ca-entry-paying").hide();
		$fields.find(".kqs-ca-entry-tendered").hide();

		if (window.erpnext?.PointOfSale?.NumberPad) {
			payment_state.numpad = new erpnext.PointOfSale.NumberPad({
				wrapper: layout.find("#kqs-ca-numpad"),
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
		refresh_payment_ui();
	}

	function get_mode_from_key(key) {
		return payment_state?.modes?.find((mode) => sanitize_mode_key(mode) === key) || null;
	}

	function select_payment_mode(key) {
		const mode = get_mode_from_key(key);
		if (!mode || !payment_state) return;
		sync_payment_controls();
		if (payment_state.selected_mode === mode) {
			payment_state.selected_mode = null;
			layout.find(".kqs-ca-mop-tile").removeClass("is-selected");
			layout.find(".kqs-ca-entry-paying, .kqs-ca-entry-tendered").hide();
			refresh_payment_ui();
			return;
		}
		payment_state.selected_mode = mode;
		payment_state.numpad_target = "paying";
		layout.find(".kqs-ca-mop-tile").removeClass("is-selected");
		layout.find(`.kqs-ca-mop-tile[data-mode-key="${key}"]`).addClass("is-selected");
		layout.find(".kqs-ca-entry-paying").show();
		payment_state.paying_control?.set_value(payment_state.amounts[mode] || "");
		if (is_physical_cash_mode(mode)) {
			layout.find(".kqs-ca-entry-tendered").show();
			payment_state.tendered_control?.set_value(payment_state.tendered[mode] || "");
		} else {
			layout.find(".kqs-ca-entry-tendered").hide();
		}
		refresh_payment_ui();
	}

	function sync_payment_controls() {
		if (!payment_state?.selected_mode) return;
		payment_state.amounts[payment_state.selected_mode] = flt(
			payment_state.paying_control?.get_value()
		);
		if (is_physical_cash_mode(payment_state.selected_mode)) {
			payment_state.tendered[payment_state.selected_mode] = flt(
				payment_state.tendered_control?.get_value()
			);
		}
	}

	function total_payment() {
		if (!payment_state) return 0;
		return payment_state.modes.reduce((sum, mode) => sum + flt(payment_state.amounts[mode]), 0);
	}

	function cash_change() {
		if (!payment_state) return 0;
		const cash_mode = payment_state.modes.find((m) => is_physical_cash_mode(m));
		if (!cash_mode) return 0;
		const paying = flt(payment_state.amounts[cash_mode]);
		const gave = flt(payment_state.tendered[cash_mode]);
		if (paying <= 0 || gave <= 0) return 0;
		return Math.max(gave - paying, 0);
	}

	function refresh_payment_ui() {
		if (!payment_state) return;
		const currency = get_currency();
		const balance = flt(customer_ar_details?.ar_outstanding || customer_summary?.ar_outstanding);
		const total = total_payment();
		const change = cash_change();
		layout.find(".kqs-ca-paying-today").text(money(total, currency));
		layout.find(".kqs-ca-remaining").text(money(Math.max(balance - total, 0), currency));
		layout.find(".kqs-ca-change").text(money(change, currency));
		const show_change =
			!!payment_state.selected_mode && is_physical_cash_mode(payment_state.selected_mode);
		layout.find(".kqs-ca-change-card").toggleClass("d-none", !show_change);
		layout.find(".kqs-ca-entry-change").toggle(show_change);
		layout.find(".kqs-ca-entry-change-amount").text(money(change, currency));
		payment_state.modes.forEach((mode) => {
			const key = sanitize_mode_key(mode);
			const amt = flt(payment_state.amounts[mode]);
			layout.find(`[data-mop="${key}"]`).text(amt > 0 ? money(amt, currency) : "");
		});
	}

	function on_numpad_clicked($btn) {
		if (!payment_state?.selected_mode) {
			frappe.show_alert({ message: __("Select a payment method first."), indicator: "yellow" });
			return;
		}
		const control =
			payment_state.numpad_target === "tendered" &&
			is_physical_cash_mode(payment_state.selected_mode)
				? payment_state.tendered_control
				: payment_state.paying_control;
		if (!control) return;
		const button_value = $btn.attr("data-button-value");
		let val = String(control.get_value() || "");
		if (button_value === "delete" || button_value === "Delete") {
			val = val.slice(0, -1);
		} else {
			val = val + button_value;
		}
		control.set_value(val);
		const mode = payment_state.selected_mode;
		const is_tendered =
			control === payment_state.tendered_control &&
			is_physical_cash_mode(mode);
		if (is_tendered) {
			payment_state.tendered[mode] = flt(val);
		} else {
			payment_state.amounts[mode] = flt(val);
		}
		refresh_payment_ui();
		frappe.utils.play_sound("numpad-touch");
	}

	function submit_payment() {
		if (!selected_customer || !payment_state) return;
		sync_payment_controls();
		const currency = get_currency();
		const balance = flt(customer_ar_details?.ar_outstanding || customer_summary?.ar_outstanding);
		const total = total_payment();
		if (total <= 0) {
			frappe.msgprint(__("Enter how much is being paid toward the account balance."));
			return;
		}
		if (total > balance) {
			frappe.msgprint(
				__("Payment ({0}) exceeds amount owed ({1}).", [money(total, currency), money(balance, currency)])
			);
			return;
		}
		const cash_mode = payment_state.modes.find((m) => is_physical_cash_mode(m));
		if (cash_mode && flt(payment_state.amounts[cash_mode]) > 0) {
			const cash_paying = flt(payment_state.amounts[cash_mode]);
			const cash_given = flt(payment_state.tendered[cash_mode]);
			if (cash_given <= 0) {
				frappe.msgprint(__("Enter how much cash the customer gave."));
				return;
			}
			if (cash_given < cash_paying) {
				frappe.msgprint(
					__("Customer gave ({0}) is less than the cash payment ({1}).", [
						money(cash_given, currency),
						money(cash_paying, currency),
					])
				);
				return;
			}
		}

		const payment_lines = payment_state.modes
			.filter((mode) => flt(payment_state.amounts[mode]) > 0)
			.map((mode) => ({ mode_of_payment: mode, amount: flt(payment_state.amounts[mode]) }));

		frappe.call({
			method: "kqs_retail.api.customer_account.record_ar_payment",
			args: {
				customer: selected_customer,
				company: get_company(),
				payments: JSON.stringify(payment_lines),
			},
			freeze: true,
			callback(r) {
				if (r.exc) return;
				const change = cash_change();
				let message = __("Account payment recorded.");
				if (change > 0) {
					message = __("Payment recorded. Change: {0}", [money(change, currency)]);
				}
				frappe.show_alert({ message, indicator: "green" });
				if (typeof kqs_retail?.point_of_sale?.after_ar_payment === "function") {
					kqs_retail.point_of_sale.after_ar_payment(active_pos?.frm, r.message, {
						change,
						currency,
						customer_name:
							customer_summary?.customer_name ||
							customer_ar_details?.customer_name ||
							selected_customer,
					});
				}
				select_customer(selected_customer, true);
				show_tab("history");
			},
		});
	}

	function reset_state() {
		selected_customer = null;
		customer_summary = null;
		customer_ar_details = null;
		customer_history = [];
		current_view = "browse";
		current_tab = "overview";
		payment_state = null;
		loaded_customers = [];
		list_filter = "all";
		layout?.find(".kqs-ca-filter-btn").removeClass("is-active");
		layout?.find('.kqs-ca-filter-btn[data-filter="all"]').addClass("is-active");
		layout?.find("#kqs-ca-search").val("");
	}

	function clear_layout_styles() {
		hub_scroll_root?.css({ minHeight: "", height: "" });
		hub_mount?.css({ minHeight: "", height: "", display: "", flexDirection: "" });
		$layer?.css({ minHeight: "", height: "", flex: "" });
	}

	function fit_layer() {
		if (!active_pos || !$layer || $layer.hasClass("d-none")) return;
		const section = hub_scroll_root;
		const mount = hub_mount;
		if (!section?.length || !mount?.length) return;
		const top = section[0].getBoundingClientRect().top;
		const height = Math.max(400, window.innerHeight - top);
		section.css({ minHeight: height, height: height });
		mount.css({ minHeight: height, height: height, display: "flex", flexDirection: "column" });
		$layer.css({ flex: "1 1 auto", minHeight: 0, height: "100%" });
	}

	function get_pos_mount(pos) {
		const mount = pos?.wrapper;
		return mount?.length ? mount : null;
	}

	function get_scroll_root(pos) {
		const mount = get_pos_mount(pos);
		if (!mount) return null;
		const section = mount.closest(".layout-main-section");
		return section.length ? section : mount;
	}

	function open(pos, opts) {
		opts = opts || {};
		const mount = get_pos_mount(pos);
		if (!mount || !pos.$components_wrapper?.length) {
			frappe.msgprint(__("POS is still loading. Try again in a moment."));
			return;
		}
		if (typeof kqs_retail?.pos_tools_menu?.close_other_overlays === "function") {
			kqs_retail.pos_tools_menu.close_other_overlays({ except: "customer-account" });
		}
		ensure_dom();
		active_pos = pos;

		if (!$layer) {
			$layer = $('<div class="kqs-pos-customer-account-layer d-none">').appendTo(mount);
			$layer.append(layout);
		}

		if (pos.recent_order_list?.$component?.is(":visible")) {
			pos.toggle_recent_order_list(false);
		}
		pos.$components_wrapper.hide();
		$layer.removeClass("d-none");
		hub_mount = mount;
		hub_mount.addClass("kqs-customer-account-mount-host");
		hub_scroll_root = get_scroll_root(pos);
		hub_scroll_root?.addClass("kqs-customer-account-mount");
		fit_layer();
		$(window).on("resize.kqsCustomerAccount", fit_layer);

		pos.page.set_title(__("Customer Account"));
		pos.page.set_primary_action(__("Back to sale"), () => kqs_retail.pos_customer_account.close(), "arrow-left");
		if (pos.page.btn_secondary?.length) pos.page.btn_secondary.hide();

		reset_state();
		render_empty_main();
		load_customers("");

		if (opts.customer && !is_walk_in(opts.customer)) {
			select_customer(opts.customer);
		} else if (
			pos.frm?.doc?.customer &&
			!is_walk_in(pos.frm.doc.customer) &&
			opts.prefill_pos_customer !== false
		) {
			layout.find("#kqs-ca-search").val(pos.frm.doc.customer_name || pos.frm.doc.customer);
			load_customers(pos.frm.doc.customer_name || pos.frm.doc.customer);
		}
	}

	function close(opts = {}) {
		if (!active_pos) return;
		const pos = active_pos;
		const restore_pos = opts.restore_pos !== false;
		$layer?.addClass("d-none");
		$(window).off("resize.kqsCustomerAccount");
		hub_mount?.removeClass("kqs-customer-account-mount-host");
		hub_mount = null;
		hub_scroll_root?.removeClass("kqs-customer-account-mount");
		clear_layout_styles();
		hub_scroll_root = null;
		if (restore_pos) {
			pos.$components_wrapper.show();
			pos.page.set_title(__("Point of Sale"));
			pos.page.set_primary_action(__("New Invoice"), () => pos.new_invoice_event());
			pos.page.set_secondary_action(__("Recent Orders"), () => pos.toggle_recent_order());
			if (pos.page.btn_secondary?.length) pos.page.btn_secondary.show();
		}
		active_pos = null;
		reset_state();
	}

	function is_open() {
		return Boolean(active_pos && $layer && !$layer.hasClass("d-none"));
	}

	return { open, close, is_open };
})();


/* Copyright (c) 2026, KQS — Full-screen Layby Lookup & Ops inside Point of Sale
 * Bundled into point_of_sale.js (Frappe page_js accepts one file per page).
 * After editing this file, run: python scripts/_merge_layby_hub.py
 */
const KQS_LAYBY_HUB_VERSION = KQS_POS_PAGE_SCRIPT_VERSION;

frappe.provide("kqs_retail.pos_layby_hub");

kqs_retail.pos_layby_hub = (function () {
	let active_pos = null;
	let $layer = null;
	let layout = null;
	let hub_mount = null;
	let hub_scroll_root = null;
	let search_timer = null;

	let loaded_agreements = [];
	let selected_agreement = null;
	let agreement_detail = null;
	let current_step = "search";
	let open_opts = {};

	let payment_state = null;
	let cancel_state = null;
	let amend_state = null;
	let forfeit_note = "";

	const STEPS = ["search", "detail", "pay", "cancel", "amend", "forfeit", "done"];
	const REFUND_TO_ACCOUNT = "account";

	function esc(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	function format_item_attributes(attributes) {
		if (!attributes) return "";
		if (Array.isArray(attributes)) {
			return attributes.map((a) => `${a.attribute}: ${a.value}`).join(", ");
		}
		if (typeof attributes === "object") {
			return Object.entries(attributes)
				.map(([key, value]) => `${key}: ${value}`)
				.join(", ");
		}
		return "";
	}

	function money(amount, currency) {
		return format_currency(flt(amount), currency || get_currency());
	}

	function get_currency() {
		return active_pos?.frm?.doc?.currency || frappe.defaults.get_default("currency");
	}

	function get_company() {
		return active_pos?.frm?.doc?.company || frappe.defaults.get_default("company");
	}

	function get_warehouse() {
		const frm = active_pos?.frm;
		if (!frm) return "";
		return (
			frm.doc.set_warehouse ||
			(frm.doc.items && frm.doc.items[0]?.warehouse) ||
			""
		);
	}

	function get_pos_profile() {
		return active_pos?.frm?.doc?.pos_profile || "";
	}

	function is_kqs_manager() {
		const roles = frappe.boot.user.roles || [];
		return (
			roles.includes("KQS Store Manager") ||
			roles.includes("System Manager") ||
			roles.includes("Sales Manager")
		);
	}

	function is_physical_cash_mode(mode) {
		return String(mode || "")
			.trim()
			.toLowerCase() === "cash";
	}

	function sanitize_mode_key(mode) {
		return (mode || "")
			.replace(/ +/g, "_")
			.replace(/[^\p{L}\p{N}_-]/gu, "")
			.replace(/^[^_a-zA-Z\p{L}]+/u, "")
			.toLowerCase();
	}

	function get_payment_modes() {
		const frm = active_pos?.frm;
		const modes = (frm?.doc?.payments || []).map((row) => row.mode_of_payment).filter(Boolean);
		const list = modes.length ? modes : ["Cash"];
		const blocked = ["Store Credit", "Account Balance", "On Account", "Account"];
		return list.filter((mode) => !blocked.includes(mode));
	}

	function inject_styles() {
		const style_id = `kqs-layby-hub-styles-v${KQS_LAYBY_HUB_VERSION}`;
		if (document.getElementById(style_id)) return;
		const style = document.createElement("style");
		style.id = style_id;
		style.textContent = `
			[data-page-route="point-of-sale"] .layout-main-section.kqs-layby-hub-mount {
				padding-bottom: 0 !important; margin-bottom: 0 !important;
				overflow: hidden; background: #f8fafc !important;
			}
			.point-of-sale-app.kqs-layby-hub-mount-host {
				width: 100%; box-sizing: border-box; background: #f8fafc;
			}
			.kqs-pos-layby-hub-layer {
				display: none; flex: 1 1 auto; width: 100%; min-height: 0;
				overflow: hidden; background: #f8fafc;
			}
			.kqs-pos-layby-hub-layer:not(.d-none) {
				display: flex; flex-direction: column;
			}
			.kqs-layby-hub-app {
				flex: 1 1 auto; display: flex; width: 100%; height: 100%;
				min-height: 0; box-sizing: border-box;
			}
			.kqs-layby-list-panel {
				flex: 0 0 18rem; width: 18rem; background: #fff;
				border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; min-height: 0;
			}
			.kqs-layby-list-head { padding: 0.75rem 0.8rem; border-bottom: 1px solid #e2e8f0; }
			.kqs-layby-list-title {
				font-size: 11px; font-weight: 700; text-transform: uppercase;
				letter-spacing: 0.07em; color: #64748b; margin: 0 0 0.45rem;
			}
			.kqs-layby-search-row { display: flex; gap: 0.35rem; }
			.kqs-layby-search-row input { flex: 1; border-radius: 8px; font-size: 12px; }
			.kqs-layby-agreement-list { flex: 1 1 auto; overflow-y: auto; padding: 0.5rem; }
			.kqs-layby-agreement-card {
				display: block; width: 100%; text-align: left; border: 1px solid #e2e8f0;
				border-radius: 10px; padding: 0.6rem 0.65rem; margin-bottom: 0.45rem;
				background: #fff; cursor: pointer;
			}
			.kqs-layby-agreement-card:hover { border-color: #cbd5e1; }
			.kqs-layby-agreement-card.is-selected {
				border-color: #2563eb; background: #eff6ff; box-shadow: 0 0 0 1px #2563eb;
			}
			.kqs-layby-main-panel {
				flex: 1 1 auto; min-width: 0; overflow-y: auto; padding: 0.85rem 1rem 1.25rem;
			}
			.kqs-layby-hero {
				border-radius: 12px; padding: 0.85rem 1rem; background: #fff;
				border: 1px solid #e2e8f0; margin-bottom: 0.85rem;
			}
			.kqs-layby-hero h2 { font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem; color: #0f172a; }
			.kqs-layby-hero p { margin: 0; font-size: 12px; color: #64748b; line-height: 1.45; }
			.kqs-layby-stat-row {
				display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
				gap: 0.5rem; margin: 0.75rem 0;
			}
			.kqs-layby-stat {
				border-radius: 10px; padding: 0.55rem 0.65rem; background: #f8fafc; border: 1px solid #e2e8f0;
			}
			.kqs-layby-stat .label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; }
			.kqs-layby-stat .value { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 0.15rem; }
			.kqs-layby-action-row {
				display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.75rem;
			}
			.kqs-layby-action-row-danger {
				display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
				margin-top: 1.35rem; padding-top: 1rem; border-top: 1px solid #e2e8f0;
			}
			.kqs-layby-action-row-danger .kqs-layby-danger-label {
				flex: 1 1 100%; font-size: 11px; font-weight: 600; color: #94a3b8;
				text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.15rem;
			}
			.kqs-layby-step-panel {
				border-radius: 12px; padding: 1rem; background: #fff; border: 1px solid #e2e8f0;
			}
			.kqs-layby-step-actions {
				display: flex; flex-wrap: wrap; gap: 0.65rem; margin-top: 1.25rem;
				padding-top: 1rem; border-top: 1px solid #e2e8f0;
			}
			.kqs-layby-step-actions .btn-lg { min-width: 8rem; }
			.kqs-layby-back-link {
				display: inline-flex; align-items: center; gap: 0.35rem;
				font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 0.75rem;
				cursor: pointer; border: none; background: none; padding: 0;
			}
			.kqs-layby-back-link:hover { color: #0f172a; }
			.kqs-layby-item-row {
				display: flex; justify-content: space-between; align-items: center;
				padding: 0.65rem 0; border-bottom: 1px solid #f1f5f9;
			}
			.kqs-layby-amend-line-pick {
				border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.65rem;
				margin-bottom: 0.5rem; cursor: pointer;
			}
			.kqs-layby-amend-line-pick:hover { border-color: #2563eb; }
			.kqs-layby-amend-line-pick.is-selected { border-color: #2563eb; background: #eff6ff; }
			.kqs-layby-replacement-card {
				border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.7rem;
				margin-bottom: 0.5rem; display: flex; justify-content: space-between; gap: 0.75rem;
				align-items: center; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
				cursor: pointer;
			}
			.kqs-layby-replacement-card:hover { border-color: #94a3b8; }
			.kqs-layby-replacement-card.is-selected {
				border: 2px solid #2563eb; background: #eff6ff;
				box-shadow: 0 0 0 1px #2563eb;
			}
			.kqs-layby-pick-btn {
				flex-shrink: 0; border: 2px solid #2563eb; background: #fff; color: #2563eb;
				font-weight: 700; font-size: 12px; padding: 0.4rem 0.85rem; border-radius: 8px;
				cursor: pointer; min-width: 5.5rem;
			}
			.kqs-layby-pick-btn:hover { background: #f8fbff; }
			.kqs-layby-pick-btn.is-selected {
				background: #2563eb; color: #fff; border-color: #1d4ed8;
			}
			.kqs-layby-amend-toolbar {
				display: none; margin-bottom: 0.85rem; padding: 0.75rem 0.85rem;
				border-radius: 10px; border: 2px solid #2563eb; background: #eff6ff;
			}
			.kqs-layby-amend-toolbar.is-visible { display: block; }
			.kqs-layby-amend-toolbar .kqs-layby-amend-selected-name {
				font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 0.15rem;
			}
			.kqs-layby-amend-toolbar .kqs-layby-amend-selected-meta {
				font-size: 11px; color: #475569; margin-top: 0.15rem;
			}
			.kqs-layby-amend-toolbar-actions {
				display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.65rem;
			}
			.kqs-layby-amend-toolbar .kqs-layby-submit-amend {
				background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 700;
			}
			.kqs-layby-amend-toolbar .kqs-layby-submit-amend:hover {
				background: #1d4ed8; border-color: #1d4ed8; color: #fff;
			}
			.kqs-layby-pay-grid {
				display: grid; grid-template-columns: minmax(0, 1fr) minmax(11rem, 15rem);
				gap: 1rem; align-items: start;
			}
			@media (max-width: 768px) { .kqs-layby-pay-grid { grid-template-columns: 1fr; } }
			.kqs-layby-entry-panel { min-width: 0; }
			.kqs-layby-mop-stack { display: flex; flex-direction: column; gap: 0.4rem; }
			.kqs-layby-numpad-panel {
				display: flex; flex-direction: column; min-width: 0;
			}
			.kqs-layby-numpad-panel .number-pad,
			.kqs-layby-numpad-panel .kqs-layby-numpad {
				position: static; flex: 1 1 auto; display: block;
				width: 100%; min-height: 220px;
			}
			.kqs-layby-numpad-panel .numpad-container {
				display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 0.5rem; width: 100%; box-sizing: border-box;
				background-color: #f8fafc; border: 1px solid #e2e8f0;
				border-radius: 10px; padding: 0.5rem;
			}
			.kqs-layby-numpad-panel .numpad-btn {
				display: flex; align-items: center; justify-content: center;
				min-height: 2.75rem; padding: 0.45rem; border-radius: 8px;
				border: 1px solid #e2e8f0; background: #fff;
				box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
				font-size: 15px; font-weight: 700; color: #0f172a;
				cursor: pointer; user-select: none; width: 100%;
			}
			.kqs-layby-numpad-panel .numpad-btn:hover { background-color: #f1f5f9; }
			.kqs-layby-numpad-hint {
				font-size: 11px; color: #64748b; margin-top: 0.35rem; min-height: 1rem;
			}
			.kqs-layby-mop-tile {
				border: 2px solid #e2e8f0; border-radius: 10px; padding: 0.55rem 0.65rem;
				background: #fff; cursor: pointer; text-align: left; width: 100%;
			}
			.kqs-layby-mop-tile.is-active { border-color: #2563eb; background: #eff6ff; }
			.kqs-layby-refund-modes-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
			.kqs-layby-refund-mode-btn {
				border: 2px solid #e2e8f0; border-radius: 10px; padding: 0.5rem 0.85rem;
				background: #fff; font-weight: 600; font-size: 12px; cursor: pointer;
			}
			.kqs-layby-refund-mode-btn.is-active { border-color: #2563eb; background: #eff6ff; }
			.kqs-layby-refund-mode-btn .kqs-refund-default-badge {
				display: block; font-size: 10px; font-weight: 600; color: #2563eb; margin-top: 0.1rem;
			}
			.kqs-layby-cancel-credit-box {
				margin-top: 0.65rem; padding: 0.75rem; border-radius: 10px;
				border: 2px solid #bfdbfe; background: #f8fbff;
			}
			.kqs-layby-cancel-credit-amount {
				font-size: 1.25rem; font-weight: 800; color: #0f172a; margin-top: 0.15rem;
			}
			.kqs-layby-forfeit-warning {
				border-radius: 10px; padding: 0.75rem; background: #fef2f2;
				border: 1px solid #fecaca; color: #991b1b; font-size: 12px; margin-bottom: 0.85rem;
			}
		`;
		document.head.appendChild(style);
	}

	function ensure_dom() {
		if (layout) return;
		inject_styles();
		layout = $(`
			<div class="kqs-layby-hub-app">
				<div class="kqs-layby-list-panel">
					<div class="kqs-layby-list-head">
						<p class="kqs-layby-list-title">${__("Active laybys")}</p>
						<div class="kqs-layby-search-row">
							<input type="search" class="form-control" id="kqs-layby-hub-search"
								placeholder="${__("Agreement or customer")}" />
						</div>
					</div>
					<div class="kqs-layby-agreement-list" id="kqs-layby-hub-list"></div>
				</div>
				<div class="kqs-layby-main-panel" id="kqs-layby-hub-main"></div>
			</div>
		`);

		layout.find("#kqs-layby-hub-search").on("input", function () {
			clearTimeout(search_timer);
			const term = $(this).val();
			search_timer = setTimeout(() => load_agreements(term), 300);
		});

		layout.on("click", ".kqs-layby-agreement-card", function () {
			select_agreement($(this).data("name"));
		});
	}

	function show_step(step) {
		current_step = step;
		render_main();
	}

	function reset_flow() {
		selected_agreement = null;
		agreement_detail = null;
		payment_state = null;
		cancel_state = null;
		amend_state = null;
		forfeit_note = "";
		current_step = "search";
		layout?.find(".kqs-layby-agreement-card").removeClass("is-selected");
		render_main();
	}

	function load_agreements(query) {
		const customer = open_opts.customer || "";
		frappe.call({
			method: "kqs_retail.api.search_layby_agreements",
			args: {
				query: query || "",
				warehouse: get_warehouse(),
				customer,
				limit: 40,
			},
			callback(r) {
				if (r.exc) return;
				loaded_agreements = r.message || [];
				render_agreement_list();
			},
		});
	}

	function render_agreement_list() {
		const $list = layout.find("#kqs-layby-hub-list");
		if (!loaded_agreements.length) {
			$list.html(`<p class="text-muted small px-2">${__("No active laybys found.")}</p>`);
			return;
		}
		const currency = get_currency();
		$list.html(
			loaded_agreements
				.map((row) => {
					const selected = row.name === selected_agreement ? " is-selected" : "";
					return `<button type="button" class="kqs-layby-agreement-card${selected}" data-name="${esc(row.name)}">
						<div style="font-weight:700;font-size:13px;color:#0f172a">${esc(row.name)}</div>
						<div style="font-size:11px;color:#64748b;margin-top:0.15rem">${esc(row.customer_name || "")}</div>
						<div style="font-size:11px;color:#2563eb;margin-top:0.25rem;font-weight:600">${__("Balance")}: ${money(row.balance_amount, currency)}</div>
					</button>`;
				})
				.join("")
		);
	}

	function select_agreement(name, go_detail = true) {
		selected_agreement = name;
		layout.find(".kqs-layby-agreement-card").removeClass("is-selected");
		layout.find(`.kqs-layby-agreement-card[data-name="${CSS.escape(name)}"]`).addClass("is-selected");
		frappe.call({
			method: "kqs_retail.api.layby_ops.get_layby_detail",
			args: { agreement_name: name },
			callback(r) {
				if (r.exc) return;
				agreement_detail = r.message;
				if (!agreement_detail?.can_operate) {
					frappe.msgprint(__("This layby is {0} and cannot be changed.", [agreement_detail?.status || ""]));
					return;
				}
				if (go_detail) show_step("detail");
				else render_main();
			},
		});
	}

	function render_main() {
		const $main = layout.find("#kqs-layby-hub-main");
		if (current_step === "search" || !agreement_detail) {
			$main.html(`
				<div class="kqs-layby-hero">
					<h2>${__("Layby Lookup & Pay")}</h2>
					<p>${__("Select a layby agreement on the left to record payments, change items, or cancel.")}</p>
				</div>
			`);
			return;
		}

		if (current_step === "detail") render_detail($main);
		else if (current_step === "pay") render_pay_step($main);
		else if (current_step === "cancel") render_cancel_step($main);
		else if (current_step === "amend") render_amend_step($main);
		else if (current_step === "forfeit") render_forfeit_step($main);
		else if (current_step === "done") render_done_step($main);
	}

	function render_detail($main) {
		const d = agreement_detail;
		const currency = get_currency();
		const mgr = d.is_manager || is_kqs_manager();
		const items_html = (d.items || [])
			.map(
				(line) => `<div class="kqs-layby-item-row">
					<div>
						<strong>${esc(line.item_name || line.item_code)}</strong>
						<div class="small text-muted">${esc(line.item_code)} × ${line.qty} — ${money(line.amount, currency)}</div>
					</div>
				</div>`
			)
			.join("");

		const forfeit_btn = mgr
			? `<button type="button" class="btn btn-outline-danger btn-sm kqs-layby-action-btn" data-action="forfeit">${__("Forfeit layby")}</button>`
			: "";

		$main.html(`
			<div class="kqs-layby-hero">
				<h2>${esc(d.name)}</h2>
				<p><strong>${esc(d.customer_name || "")}</strong> · ${__("Due")} ${frappe.datetime.str_to_user(d.due_date) || "—"}</p>
				<div class="kqs-layby-stat-row">
					<div class="kqs-layby-stat"><div class="label">${__("Paid")}</div><div class="value">${money(d.paid_amount, currency)}</div></div>
					<div class="kqs-layby-stat"><div class="label">${__("Balance")}</div><div class="value">${money(d.balance_amount, currency)}</div></div>
					<div class="kqs-layby-stat"><div class="label">${__("Total")}</div><div class="value">${money(d.total_amount, currency)}</div></div>
				</div>
				${items_html ? `<div class="mt-2">${items_html}</div>` : ""}
			</div>
			<div class="kqs-layby-action-row">
				<button type="button" class="btn btn-primary btn-sm kqs-layby-action-btn" data-action="pay">${__("Record payment")}</button>
				<button type="button" class="btn btn-default btn-sm kqs-layby-action-btn" data-action="amend">${__("Change item")}</button>
			</div>
			<div class="kqs-layby-action-row-danger">
				<span class="kqs-layby-danger-label">${__("Irreversible — confirmation required")}</span>
				<button type="button" class="btn btn-danger btn-sm kqs-layby-action-btn" data-action="cancel">${__("Cancel layby")}</button>
				${forfeit_btn}
			</div>
		`);

		$main.find(".kqs-layby-action-btn").on("click", function () {
			const action = $(this).data("action");
			if (action === "pay") {
				init_payment_state();
				show_step("pay");
			} else if (action === "amend") {
				amend_state = { line_idx: null, manager_approved: false, selected_item: null, preview: null, overpayment_action: "keep", overpayment_mode: null, refund_modes: [] };
				show_step("amend");
			} else if (action === "cancel") {
				frappe.confirm(
					__(
						"Open cancel for layby {0}? You must confirm again on the next screen before any refund is paid out.",
						[selected_agreement]
					),
					() => {
						init_cancel_state();
						show_step("cancel");
					}
				);
			} else if (action === "forfeit") {
				frappe.confirm(
					__(
						"Open forfeit for layby {0}? Customer receives no refund. You must confirm again before it is final.",
						[selected_agreement]
					),
					() => {
						forfeit_note = "";
						show_step("forfeit");
					}
				);
			}
		});
	}

	function init_payment_state() {
		const modes = get_payment_modes();
		payment_state = {
			modes,
			amounts: Object.fromEntries(modes.map((m) => [m, 0])),
			tendered: Object.fromEntries(modes.map((m) => [m, 0])),
			selected_mode: modes[0] || null,
			numpad_target: "paying",
			numpad_value: "",
			paying_control: null,
			tendered_control: null,
			numpad: null,
			pay_panel_bound: false,
		};
	}

	function sync_layby_pay_controls() {
		if (!payment_state?.selected_mode) return;
		payment_state.amounts[payment_state.selected_mode] = flt(
			payment_state.paying_control?.get_value()
		);
		if (is_physical_cash_mode(payment_state.selected_mode)) {
			payment_state.tendered[payment_state.selected_mode] = flt(
				payment_state.tendered_control?.get_value()
			);
		}
	}

	function on_layby_pay_numpad_clicked($main, $btn) {
		if (!payment_state?.selected_mode) {
			frappe.show_alert({ message: __("Select a payment method first."), indicator: "yellow" });
			return;
		}
		const control =
			payment_state.numpad_target === "tendered" &&
			payment_state.tendered_control &&
			is_physical_cash_mode(payment_state.selected_mode)
				? payment_state.tendered_control
				: payment_state.paying_control;
		if (!control) return;
		let val = String(control.get_value() || "");
		const bv = $btn.attr("data-button-value");
		val = bv === "Delete" || bv === "delete" ? val.slice(0, -1) : val + bv;
		control.set_value(val);
		const mode = payment_state.selected_mode;
		if (control === payment_state.tendered_control) {
			payment_state.tendered[mode] = flt(val);
		} else {
			payment_state.amounts[mode] = flt(val);
		}
		refresh_pay_ui($main);
		frappe.utils.play_sound("numpad-touch");
	}

	function init_layby_pay_numpad($main) {
		const $numpad = $main.find("#kqs-layby-hub-numpad");
		$numpad.empty();
		if (!window.erpnext?.PointOfSale?.NumberPad) {
			$main.find(".kqs-layby-numpad-hint").text(__("Keypad unavailable — type amounts in the fields."));
			return;
		}
		payment_state.numpad = new erpnext.PointOfSale.NumberPad({
			wrapper: $numpad,
			events: {
				numpad_event($btn) {
					on_layby_pay_numpad_clicked($main, $btn);
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

	function select_layby_pay_mode($main, mode) {
		if (!payment_state || !mode) return;
		sync_layby_pay_controls();
		payment_state.selected_mode = mode;
		payment_state.numpad_target = "paying";
		$main.find(".kqs-layby-mop-tile").removeClass("is-active");
		$main.find(".kqs-layby-mop-tile").filter(function () {
			return $(this).data("mode") === mode;
		}).addClass("is-active");
		$main.find(".kqs-layby-entry-paying").show();
		payment_state.paying_control?.set_value(payment_state.amounts[mode] || 0);
		if (is_physical_cash_mode(mode)) {
			$main.find(".kqs-layby-entry-tendered").show();
			payment_state.tendered_control?.set_value(payment_state.tendered[mode] || 0);
		} else {
			$main.find(".kqs-layby-entry-tendered").hide();
		}
		$main.find(".kqs-layby-numpad-hint").text(__("Tap digits for {0}.", [mode]));
		refresh_pay_ui($main);
	}

	function render_pay_step($main) {
		if (!payment_state) init_payment_state();
		const balance = flt(agreement_detail?.balance_amount);
		const currency = get_currency();
		const modes_html = payment_state.modes
			.map((mode) => {
				const key = sanitize_mode_key(mode);
				const active = payment_state.selected_mode === mode ? " is-active" : "";
				return `<button type="button" class="kqs-layby-mop-tile${active}" data-mode="${esc(mode)}">
					<div style="font-weight:600;font-size:12px">${esc(mode)}</div>
					<div class="small text-muted kqs-layby-mop-amt" data-key="${key}"></div>
				</button>`;
			})
			.join("");

		$main.html(`
			<button type="button" class="kqs-layby-back-link kqs-layby-go-detail">← ${__("Back to layby")}</button>
			<div class="kqs-layby-step-panel">
				<h2 style="margin:0 0 0.5rem">${__("Record installment")}</h2>
				<p class="small text-muted">${__("Balance due")}: <strong>${money(balance, currency)}</strong></p>
				<div class="kqs-layby-pay-grid mt-3">
					<div class="kqs-layby-entry-panel">
						<p class="small text-muted">${__("Payment methods")}</p>
						<div class="kqs-layby-mop-stack">${modes_html}</div>
						<div class="kqs-layby-entry-paying mt-2" id="kqs-layby-hub-paying-field"></div>
						<div class="kqs-layby-entry-tendered mt-2" id="kqs-layby-hub-tendered-field"></div>
						<div class="mt-2 small">${__("Paying today")}: <strong class="kqs-layby-hub-paying-total">0</strong></div>
						<div class="small kqs-layby-hub-change-row">${__("Change")}: <strong class="kqs-layby-hub-change">0</strong></div>
					</div>
					<div class="kqs-layby-numpad-panel">
						<p class="small text-muted">${__("Keypad")}</p>
						<div class="kqs-layby-numpad number-pad" id="kqs-layby-hub-numpad"></div>
						<p class="kqs-layby-numpad-hint"></p>
					</div>
				</div>
				<div class="kqs-layby-step-actions">
					<button type="button" class="btn btn-primary kqs-layby-submit-pay">${__("Record payment")}</button>
					<button type="button" class="btn btn-default kqs-layby-go-detail">${__("Go back")}</button>
				</div>
			</div>
		`);

		$main.find(".kqs-layby-go-detail").on("click", () => show_step("detail"));
		$main.find(".kqs-layby-mop-tile").on("click", function () {
			select_layby_pay_mode($main, $(this).data("mode"));
		});
		$main.find(".kqs-layby-submit-pay").on("click", submit_payment);

		payment_state.paying_control = frappe.ui.form.make_control({
			df: {
				label: __("Paying"),
				fieldtype: "Currency",
				onchange() {
					if (!payment_state?.selected_mode) return;
					payment_state.amounts[payment_state.selected_mode] = flt(this.value);
					refresh_pay_ui($main);
				},
			},
			parent: $main.find("#kqs-layby-hub-paying-field"),
			render_input: true,
		});
		payment_state.paying_control.$input.on("focus", () => {
			payment_state.numpad_target = "paying";
		});

		payment_state.tendered_control = frappe.ui.form.make_control({
			df: {
				label: __("Customer gave"),
				fieldtype: "Currency",
				onchange() {
					if (!payment_state?.selected_mode) return;
					payment_state.tendered[payment_state.selected_mode] = flt(this.value);
					refresh_pay_ui($main);
				},
			},
			parent: $main.find("#kqs-layby-hub-tendered-field"),
			render_input: true,
		});
		payment_state.tendered_control.$input.on("focus", () => {
			payment_state.numpad_target = "tendered";
		});

		$main.find(".kqs-layby-entry-paying").hide();
		$main.find(".kqs-layby-entry-tendered").hide();

		init_layby_pay_numpad($main);
		if (payment_state.selected_mode) {
			select_layby_pay_mode($main, payment_state.selected_mode);
		} else {
			$main.find(".kqs-layby-numpad-hint").text(__("Select a payment method to use the keypad."));
		}
		refresh_pay_ui($main);
	}

	function is_walk_in_customer(customer, customer_name) {
		const name = `${customer || ""} ${customer_name || ""}`.toLowerCase();
		return name.includes("walk-in") || name.includes("walk in");
	}

	function is_cancel_account_refund() {
		return (cancel_state?.refund_type || REFUND_TO_ACCOUNT) === REFUND_TO_ACCOUNT;
	}

	function render_cancel_refund_section(preview, currency) {
		const opts = cancel_state?.refund_options || {};
		const pos_modes = opts.pos_payment_modes || cancel_state?.refund_modes || [];
		const account_label = opts.account_label || __("Customer account");
		const needs_refund = flt(preview.refund_amount) > 0;
		if (!needs_refund) {
			return `<p class="text-muted mt-3">${__("No refund due.")}</p>`;
		}

		const account_btn = `<button type="button" class="kqs-layby-refund-mode-btn${
			is_cancel_account_refund() ? " is-active" : ""
		}" data-refund-type="${REFUND_TO_ACCOUNT}">
			<span>${esc(account_label)}</span>
			<span class="kqs-refund-default-badge">${__("Default")}</span>
		</button>`;

		const payment_btns = pos_modes
			.map((mode) => {
				const active =
					!is_cancel_account_refund() && cancel_state.selected_mode === mode ? " is-active" : "";
				return `<button type="button" class="kqs-layby-refund-mode-btn${active}"
					data-refund-type="payment" data-mode="${esc(mode)}">
					<span>${esc(mode)}</span>
				</button>`;
			})
			.join("");

		const amount_html = is_cancel_account_refund()
			? `<div class="kqs-layby-cancel-credit-box">
					<div class="small text-muted">${__("Estimated store credit")}</div>
					<div class="kqs-layby-cancel-credit-amount">${money(preview.refund_amount, currency)}</div>
					<div class="small text-muted">${__(
						"Credit stays on the customer account for a future sale at this store."
					)}</div>
				</div>`
			: `<div class="kqs-layby-cancel-credit-box" style="border-color:#e2e8f0;background:#fff">
					<div class="small text-muted">${__("Refund from till")}</div>
					<div class="kqs-layby-cancel-credit-amount">${money(preview.refund_amount, currency)}</div>
					<div class="small text-muted">${__(
						"Pay the customer from the till via {0}.",
						[cancel_state.selected_mode || __("selected payment mode")]
					)}</div>
				</div>`;

		return `<div class="mt-3">
				<div class="small font-weight-bold text-muted text-uppercase">${__("Refund method")}</div>
				<div class="kqs-layby-refund-modes-grid">${account_btn}${payment_btns}</div>
				<p class="small text-muted" style="margin:0.4rem 0 0">${__(
					"Account credit is the usual choice. Refund to Cash or mobile money only when required."
				)}</p>
				${amount_html}
			</div>`;
	}

	function update_cancel_submit_label($main) {
		const $btn = $main.find(".kqs-layby-submit-cancel");
		if (!flt(cancel_state?.preview?.refund_amount)) {
			$btn.text(__("Confirm cancel"));
			return;
		}
		if (is_cancel_account_refund()) {
			$btn.text(__("Credit customer account"));
		} else if (cancel_state.selected_mode) {
			$btn.text(__("Refund via {0}", [cancel_state.selected_mode]));
		} else {
			$btn.text(__("Select refund method"));
		}
	}

	function init_cancel_state() {
		cancel_state = {
			reason: "customer",
			preview: null,
			refund_options: null,
			refund_modes: [],
			refund_type: REFUND_TO_ACCOUNT,
			selected_mode: null,
		};
		frappe.call({
			method: "kqs_retail.api.layby_ops.get_layby_cancel_refund_modes",
			args: { pos_profile: get_pos_profile() },
			callback(r) {
				if (r.exc) return;
				cancel_state.refund_options = r.message || {};
				cancel_state.refund_modes = r.message?.pos_payment_modes || [];
				cancel_state.refund_type = r.message?.default_refund_type || REFUND_TO_ACCOUNT;
				cancel_state.selected_mode = r.message?.suggested_payment_mode || cancel_state.refund_modes[0] || null;
				load_cancel_preview();
			},
		});
	}

	function load_cancel_preview() {
		if (!selected_agreement || !cancel_state) return;
		frappe.call({
			method: "kqs_retail.api.layby_ops.preview_layby_cancel",
			args: { agreement_name: selected_agreement, reason: cancel_state.reason },
			callback(r) {
				if (!r.exc) {
					cancel_state.preview = r.message;
					render_main();
				}
			},
		});
	}

	function render_cancel_step($main) {
		const preview = cancel_state?.preview;
		const currency = get_currency();
		if (!preview) {
			$main.html(`<p class="text-muted">${__("Loading…")}</p>`);
			return;
		}
		const store_btn = is_kqs_manager()
			? `<button type="button" class="btn btn-sm ${cancel_state.reason === "store_error" ? "btn-primary" : "btn-default"} kqs-layby-cancel-reason" data-reason="store_error">${__("Store error (100%)")}</button>`
			: "";
		const refund_html = render_cancel_refund_section(preview, currency);

		$main.html(`
			<button type="button" class="kqs-layby-back-link kqs-layby-go-detail">← ${__("Back to layby")}</button>
			<div class="kqs-layby-step-panel">
				<h2 style="margin:0 0 0.5rem;font-size:1.1rem">${__("Cancel layby")}</h2>
				<p class="small text-muted">${esc(selected_agreement)} · ${esc(agreement_detail?.customer_name || "")}</p>
				<div class="mb-3" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem">
					<button type="button" class="btn btn-sm ${cancel_state.reason === "customer" ? "btn-primary" : "btn-default"} kqs-layby-cancel-reason" data-reason="customer">${__("Customer cancel")}</button>
					${store_btn}
				</div>
				<div class="kqs-layby-stat-row">
					<div class="kqs-layby-stat"><div class="label">${__("Paid")}</div><div class="value">${money(preview.paid_amount, currency)}</div></div>
					<div class="kqs-layby-stat"><div class="label">${__("Refund %")}</div><div class="value">${preview.refund_percent}%</div></div>
					<div class="kqs-layby-stat"><div class="label">${__("Refund")}</div><div class="value">${money(preview.refund_amount, currency)}</div></div>
					<div class="kqs-layby-stat"><div class="label">${__("Retained")}</div><div class="value">${money(preview.forfeit_amount, currency)}</div></div>
				</div>
				${refund_html}
				<div class="kqs-layby-step-actions">
					<button type="button" class="btn btn-danger kqs-layby-submit-cancel">${__("Credit customer account")}</button>
					<button type="button" class="btn btn-default kqs-layby-go-detail">${__("Go back")}</button>
				</div>
			</div>
		`);

		$main.find(".kqs-layby-cancel-reason").on("click", function () {
			cancel_state.reason = $(this).data("reason");
			load_cancel_preview();
		});
		$main.find(".kqs-layby-refund-mode-btn").on("click", function () {
			const refund_type = $(this).data("refund-type");
			if (refund_type === REFUND_TO_ACCOUNT) {
				cancel_state.refund_type = REFUND_TO_ACCOUNT;
			} else {
				cancel_state.refund_type = "payment";
				cancel_state.selected_mode = $(this).data("mode") || cancel_state.selected_mode;
			}
			render_main();
		});
		$main.find(".kqs-layby-go-detail").on("click", () => show_step("detail"));
		$main.find(".kqs-layby-submit-cancel").on("click", submit_cancel);
		update_cancel_submit_label($main);
	}

	function submit_cancel() {
		const preview = cancel_state?.preview;
		if (!preview) return;
		const needs_refund = flt(preview.refund_amount) > 0;
		if (needs_refund && is_cancel_account_refund()) {
			if (is_walk_in_customer(agreement_detail?.customer, agreement_detail?.customer_name)) {
				frappe.msgprint(__("Named customer required for store credit refund."));
				return;
			}
		} else if (needs_refund && !cancel_state.selected_mode) {
			frappe.msgprint(__("Select a refund payment mode."));
			return;
		}
		const currency = get_currency();
		const refund_txt = money(preview.refund_amount, currency);
		const retained_txt = money(preview.forfeit_amount, currency);
		const refund_desc = is_cancel_account_refund()
			? __("Store credit to account: {0}", [refund_txt])
			: __("Refund from till via {0}: {1}", [cancel_state.selected_mode, refund_txt]);
		frappe.confirm(
			__(
				"Cancel layby {0} for {1}? {2}. Retained by store: {3}. This cannot be undone.",
				[
					selected_agreement,
					agreement_detail?.customer_name || "",
					refund_desc,
					retained_txt,
				]
			),
			() => {
				frappe.call({
					method: "kqs_retail.api.layby_ops.submit_layby_cancel",
					args: {
						agreement_name: selected_agreement,
						reason: cancel_state.reason,
						refund_type: cancel_state.refund_type || REFUND_TO_ACCOUNT,
						mode_of_payment: is_cancel_account_refund() ? null : cancel_state.selected_mode,
					},
					freeze: true,
					callback(r) {
						if (r.exc) return;
						const msg = is_cancel_account_refund()
							? __("Layby cancelled. {0} credited to customer account.", [money(r.message?.refund_amount, currency)])
							: __("Layby cancelled. Refund {0}.", [money(r.message?.refund_amount, currency)]);
						done_success(msg);
						load_agreements(layout.find("#kqs-layby-hub-search").val());
					},
				});
			}
		);
	}

	function render_forfeit_step($main) {
		$main.html(`
			<button type="button" class="kqs-layby-back-link kqs-layby-go-detail">← ${__("Back to layby")}</button>
			<div class="kqs-layby-step-panel">
				<h2 style="margin:0 0 0.5rem;font-size:1.1rem">${__("Forfeit layby")}</h2>
				<div class="kqs-layby-forfeit-warning">${__("Customer receives no refund. Stock is released for resale. This cannot be undone.")}</div>
				<label class="small font-weight-bold">${__("Reason / note")} <span class="text-danger">*</span></label>
				<textarea class="form-control kqs-layby-forfeit-note" rows="4" placeholder="${__("e.g. Overdue after grace period")}"></textarea>
				<div class="kqs-layby-step-actions">
					<button type="button" class="btn btn-danger kqs-layby-submit-forfeit">${__("Confirm forfeit")}</button>
					<button type="button" class="btn btn-default kqs-layby-go-detail">${__("Go back")}</button>
				</div>
			</div>
		`);
		$main.find(".kqs-layby-go-detail").on("click", () => show_step("detail"));
		$main.find(".kqs-layby-submit-forfeit").on("click", () => {
			const note = ($main.find(".kqs-layby-forfeit-note").val() || "").trim();
			if (!note) {
				frappe.msgprint(__("Enter a note."));
				return;
			}
			frappe.confirm(
				__(
					"Forfeit layby {0} for {1}? No refund. Stock released for resale. Note: {2}",
					[selected_agreement, agreement_detail?.customer_name || "", note]
				),
				() => {
					frappe.call({
						method: "kqs_retail.api.layby_ops.submit_layby_forfeit",
						args: { agreement_name: selected_agreement, note },
						freeze: true,
						callback(r) {
							if (r.exc) return;
							done_success(__("Layby forfeited."));
							load_agreements(layout.find("#kqs-layby-hub-search").val());
						},
					});
				}
			);
		});
	}

	function render_amend_step($main) {
		if (!amend_state) return;
		const d = agreement_detail;
		const currency = get_currency();
		const mgr = d.is_manager || is_kqs_manager();

		if (amend_state.line_idx == null) {
			const lines = (d.items || [])
				.map(
					(line) => `<button type="button" class="kqs-layby-amend-line-pick" data-idx="${line.line_idx}">
						<strong>${esc(line.item_name || line.item_code)}</strong>
						<div class="small text-muted">${esc(line.item_code)} × ${line.qty}</div>
					</button>`
				)
				.join("");
			$main.html(`
				<button type="button" class="kqs-layby-back-link kqs-layby-go-detail">← ${__("Back to layby")}</button>
				<div class="kqs-layby-step-panel">
					<h2 style="margin:0 0 0.5rem">${__("Which item to change?")}</h2>
					<p class="small text-muted">${__("Tap the line you want to replace.")}</p>
					${lines}
				</div>
			`);
			$main.find(".kqs-layby-go-detail").on("click", () => show_step("detail"));
			$main.find(".kqs-layby-amend-line-pick").on("click", function () {
				amend_state.line_idx = $(this).data("idx");
				amend_state.selected_item = null;
				amend_state.preview = null;
				frappe.call({
					method: "kqs_retail.api.layby_ops.get_layby_cancel_refund_modes",
					args: { pos_profile: get_pos_profile() },
					callback(r) {
						if (!r.exc) {
							amend_state.refund_modes = r.message?.pos_payment_modes || [];
							amend_state.overpayment_mode = r.message?.suggested_payment_mode || amend_state.refund_modes[0] || null;
						}
						render_main();
					},
				});
			});
			return;
		}

		const manager_chk = mgr
			? `<label class="small d-block mb-2"><input type="checkbox" class="kqs-layby-amend-manager" ${amend_state.manager_approved ? "checked" : ""} />
				${__("Full product swap (manager — any in-stock SKU)")}</label>`
			: "";

		$main.html(`
			<button type="button" class="kqs-layby-back-link kqs-layby-amend-back-line">← ${__("Pick different line")}</button>
			<div class="kqs-layby-step-panel">
				<h2 style="margin:0 0 0.5rem">${__("Choose replacement")}</h2>
				${manager_chk}
				<div class="kqs-layby-search-row mb-2">
					<input type="search" class="form-control kqs-layby-amend-search" placeholder="${__("Search SKU or name")}" />
				</div>
				<div class="kqs-layby-amend-toolbar">
					<div class="small font-weight-bold text-uppercase" style="color:#2563eb;letter-spacing:0.04em;font-size:10px">${__("Replacement selected")}</div>
					<div class="kqs-layby-amend-selected-name"></div>
					<div class="kqs-layby-amend-selected-meta"></div>
					<div class="kqs-layby-amend-toolbar-actions">
						<button type="button" class="btn btn-sm kqs-layby-submit-amend">${__("Confirm item change")}</button>
						<button type="button" class="btn btn-default btn-sm kqs-layby-clear-amend-selection">${__("Clear selection")}</button>
					</div>
				</div>
				<div class="kqs-layby-amend-preview"></div>
				<div class="kqs-layby-amend-results"></div>
			</div>
		`);

		$main.find(".kqs-layby-go-detail").on("click", () => show_step("detail"));
		$main.find(".kqs-layby-amend-back-line").on("click", () => {
			amend_state.line_idx = null;
			render_main();
		});
		$main.find(".kqs-layby-amend-manager").on("change", function () {
			amend_state.manager_approved = $(this).is(":checked");
			amend_state.selected_item = null;
			amend_state.preview = null;
			render_amend_toolbar($main);
			$main.find(".kqs-layby-amend-preview").empty();
			search_amend_items($main);
		});
		$main.find(".kqs-layby-amend-search").on("input", frappe.utils.debounce(() => search_amend_items($main), 300));
		$main.find(".kqs-layby-submit-amend").on("click", () => submit_amend($main));
		$main.find(".kqs-layby-clear-amend-selection").on("click", () => clear_amend_selection($main));

		search_amend_items($main);
		if (amend_state.preview) {
			render_amend_toolbar($main);
			render_amend_preview($main);
		}
	}

	function clear_amend_selection($main) {
		amend_state.selected_item = null;
		amend_state.preview = null;
		render_amend_toolbar($main);
		$main.find(".kqs-layby-amend-preview").empty();
		sync_amend_selection_ui($main);
	}

	function render_amend_toolbar($main) {
		const $toolbar = $main.find(".kqs-layby-amend-toolbar");
		const preview = amend_state?.preview;
		if (!preview || !amend_state?.selected_item) {
			$toolbar.removeClass("is-visible");
			return;
		}
		$toolbar.addClass("is-visible");
		$toolbar.find(".kqs-layby-amend-selected-name").text(
			preview.new_item_name || preview.new_item_code || amend_state.selected_item
		);
		$toolbar.find(".kqs-layby-amend-selected-meta").text(
			`${preview.old_item_code} → ${preview.new_item_code}`
		);
	}

	function sync_amend_selection_ui($main) {
		const selected = amend_state?.selected_item || "";
		$main.find(".kqs-layby-replacement-card").each(function () {
			const code = $(this).data("code");
			const is_selected = !!selected && code === selected;
			$(this).toggleClass("is-selected", is_selected);
			const $btn = $(this).find(".kqs-layby-pick-btn");
			$btn.toggleClass("is-selected", is_selected);
			$btn.text(is_selected ? __("Selected") : __("Select"));
		});
	}

	function pick_amend_replacement($main, item_code) {
		amend_state.selected_item = item_code;
		sync_amend_selection_ui($main);
		frappe.call({
			method: "kqs_retail.api.layby_ops.preview_layby_amend",
			args: {
				agreement_name: selected_agreement,
				line_idx: amend_state.line_idx,
				new_item_code: item_code,
				manager_approved: amend_state.manager_approved ? 1 : 0,
			},
			callback(pr) {
				if (pr.exc) {
					amend_state.selected_item = null;
					amend_state.preview = null;
					sync_amend_selection_ui($main);
					render_amend_toolbar($main);
					return;
				}
				amend_state.preview = pr.message;
				render_amend_toolbar($main);
				render_amend_preview($main);
				sync_amend_selection_ui($main);
				$main.closest(".kqs-layby-main-panel").scrollTop(0);
			},
		});
	}

	function search_amend_items($main) {
		const query = $main.find(".kqs-layby-amend-search").val() || "";
		const $results = $main.find(".kqs-layby-amend-results");
		$results.html(`<p class="text-muted small">${__("Searching…")}</p>`);
		frappe.call({
			method: "kqs_retail.api.layby_ops.search_layby_amend_items",
			args: {
				agreement_name: selected_agreement,
				line_idx: amend_state.line_idx,
				query,
				manager_approved: amend_state.manager_approved ? 1 : 0,
				limit: 25,
			},
			callback(r) {
				if (r.exc) {
					$results.html(`<p class="text-danger small">${__("Search failed. Try again.")}</p>`);
					return;
				}
				const rows = r.message || [];
				const currency = get_currency();
				const html = rows.length
					? rows
							.map((row) => {
								const attrs = format_item_attributes(row.attributes);
								const is_selected = amend_state.selected_item === row.item_code;
								const card_cls = is_selected ? " is-selected" : "";
								const btn_cls = is_selected ? " is-selected" : "";
								const btn_label = is_selected ? __("Selected") : __("Select");
								return `<div class="kqs-layby-replacement-card${card_cls}" data-code="${esc(row.item_code)}">
									<div>
										<strong>${esc(row.item_name)}</strong>
										<div class="small text-muted">${esc(row.item_code)}${attrs ? " — " + esc(attrs) : ""}</div>
										<div class="small text-muted">${money(row.rate, currency)} · ${__("Sellable")}: ${row.sellable_qty}</div>
									</div>
									<button type="button" class="kqs-layby-pick-btn${btn_cls} kqs-layby-pick-replacement" data-code="${esc(row.item_code)}">${btn_label}</button>
								</div>`;
							})
							.join("")
					: `<p class="text-muted small">${amend_state.manager_approved ? __("No in-stock items found.") : __("No same-style variants. Ask a manager for full product swap.")}</p>`;
				$results.html(html);
				$results.find(".kqs-layby-replacement-card").on("click", function (e) {
					if ($(e.target).closest(".kqs-layby-pick-replacement").length) return;
					pick_amend_replacement($main, $(this).data("code"));
				});
				$results.find(".kqs-layby-pick-replacement").on("click", function (e) {
					e.stopPropagation();
					pick_amend_replacement($main, $(this).data("code"));
				});
			},
		});
	}

	function render_amend_preview($main) {
		const preview = amend_state?.preview;
		if (!preview) return;
		const currency = get_currency();
		const over = flt(preview.overpayment);
		let over_html = "";
		if (over > 0) {
			const mode_btns = (amend_state.refund_modes || [])
				.map((mode) => {
					const active = amend_state.overpayment_mode === mode ? " is-active" : "";
					return `<button type="button" class="kqs-layby-refund-mode-btn${active}" data-mode="${esc(mode)}">${esc(mode)}</button>`;
				})
				.join("");
			over_html = `<div class="mt-2 p-2 border rounded">
				<p class="small mb-2"><strong>${__("Overpayment")}: ${money(over, currency)}</strong></p>
				<div class="mb-2" style="display:flex;gap:0.5rem;flex-wrap:wrap">
					<button type="button" class="btn btn-sm ${amend_state.overpayment_action === "keep" ? "btn-primary" : "btn-default"} kqs-layby-overpay" data-action="keep">${__("Keep on layby")}</button>
					<button type="button" class="btn btn-sm ${amend_state.overpayment_action === "refund" ? "btn-primary" : "btn-default"} kqs-layby-overpay" data-action="refund">${__("Refund cash")}</button>
				</div>
				${amend_state.overpayment_action === "refund" ? `<div class="kqs-layby-refund-modes-grid">${mode_btns}</div>` : ""}
			</div>`;
		}
		$main.find(".kqs-layby-amend-preview").html(`
			<div class="p-2 border rounded">
				<p>${esc(preview.old_item_code)} → <strong>${esc(preview.new_item_code)}</strong></p>
				<p class="small text-muted">${__("New total")}: ${money(preview.new_total_amount, currency)}
					· ${__("Balance")}: ${money(preview.new_balance_amount, currency)}</p>
				${over_html}
			</div>
		`);
		$main.find(".kqs-layby-overpay").on("click", function () {
			amend_state.overpayment_action = $(this).data("action");
			render_amend_preview($main);
		});
		$main.find(".kqs-layby-refund-mode-btn").on("click", function () {
			amend_state.overpayment_mode = $(this).data("mode");
			render_amend_preview($main);
		});
	}

	function submit_amend($main) {
		if (!amend_state?.selected_item || !amend_state.preview) {
			frappe.msgprint(__("Select a replacement item."));
			return;
		}
		if (flt(amend_state.preview.overpayment) > 0 && amend_state.overpayment_action === "refund" && !amend_state.overpayment_mode) {
			frappe.msgprint(__("Select a payment mode for the overpayment refund."));
			return;
		}
		frappe.call({
			method: "kqs_retail.api.layby_ops.submit_layby_amend",
			args: {
				agreement_name: selected_agreement,
				line_idx: amend_state.line_idx,
				new_item_code: amend_state.selected_item,
				manager_approved: amend_state.manager_approved ? 1 : 0,
				overpayment_action: amend_state.overpayment_action,
				overpayment_mode_of_payment: amend_state.overpayment_mode,
			},
			freeze: true,
			callback(r) {
				if (r.exc) return;
				if (typeof kqs_retail?.point_of_sale?.after_layby_payment_recorded === "function" && r.message?.status === "Completed") {
					kqs_retail.point_of_sale.after_layby_payment_recorded(r.message);
				}
				select_agreement(selected_agreement, false);
				done_success(__("Layby item updated."));
			},
		});
	}

	function payment_total() {
		if (!payment_state) return 0;
		return payment_state.modes.reduce((s, m) => s + flt(payment_state.amounts[m]), 0);
	}

	function payment_cash_change() {
		if (!payment_state) return 0;
		const cash = payment_state.modes.find((m) => is_physical_cash_mode(m));
		if (!cash) return 0;
		const paying = flt(payment_state.amounts[cash]);
		const gave = flt(payment_state.tendered[cash]);
		return paying > 0 && gave > paying ? gave - paying : 0;
	}

	function refresh_pay_ui($main) {
		const currency = get_currency();
		const total = payment_total();
		const change = payment_cash_change();
		$main.find(".kqs-layby-hub-paying-total").text(money(total, currency));
		$main.find(".kqs-layby-hub-change").text(money(change, currency));
		const show_change =
			!!payment_state?.selected_mode && is_physical_cash_mode(payment_state.selected_mode);
		$main.find(".kqs-layby-hub-change-row").toggle(show_change);
		payment_state?.modes?.forEach((mode) => {
			const amt = flt(payment_state.amounts[mode]);
			$main.find(`[data-key="${sanitize_mode_key(mode)}"]`).text(amt > 0 ? money(amt, currency) : "");
		});
		$main.find(".kqs-layby-mop-tile").each(function () {
			$(this).toggleClass("is-active", $(this).data("mode") === payment_state?.selected_mode);
		});
	}

	function submit_payment() {
		sync_layby_pay_controls();
		const balance = flt(agreement_detail?.balance_amount);
		const currency = get_currency();
		const total = payment_total();
		if (total <= 0) {
			frappe.msgprint(__("Enter how much is being paid toward the layby."));
			return;
		}
		if (total > balance) {
			frappe.msgprint(__("Payment exceeds balance."));
			return;
		}
		const cash = payment_state.modes.find((m) => is_physical_cash_mode(m));
		if (cash && flt(payment_state.amounts[cash]) > 0) {
			const gave = flt(payment_state.tendered[cash]);
			const paying = flt(payment_state.amounts[cash]);
			if (gave < paying) {
				frappe.msgprint(__("Enter how much cash the customer gave."));
				return;
			}
		}
		const lines = payment_state.modes
			.filter((m) => flt(payment_state.amounts[m]) > 0)
			.map((m) => ({ mode_of_payment: m, amount: flt(payment_state.amounts[m]) }));

		frappe.call({
			method: "kqs_retail.api.record_layby_payment",
			args: {
				layby_agreement: selected_agreement,
				payments: JSON.stringify(lines),
				amount: total,
			},
			freeze: true,
			callback(r) {
				if (r.exc) return;
				if (typeof kqs_retail?.point_of_sale?.after_layby_payment_recorded === "function") {
					kqs_retail.point_of_sale.after_layby_payment_recorded(r.message);
				}
				const change = payment_cash_change();
				let msg = __("Payment recorded.");
				if (change > 0) msg = __("Payment recorded. Change: {0}", [money(change, currency)]);
				done_success(msg);
				select_agreement(selected_agreement, false);
			},
		});
	}

	let done_message = "";

	function done_success(message) {
		done_message = message;
		show_step("done");
	}

	function render_done_step($main) {
		$main.html(`
			<div class="kqs-layby-step-panel text-center" style="padding:2rem 1rem">
				<div style="font-size:2rem;margin-bottom:0.5rem">✓</div>
				<h2 style="margin:0 0 0.5rem">${esc(done_message)}</h2>
				<div class="kqs-layby-step-actions" style="justify-content:center;border:0">
					<button type="button" class="btn btn-primary kqs-layby-done-another">${__("Another layby")}</button>
					<button type="button" class="btn btn-default kqs-layby-hub-close">${__("Back to sale")}</button>
				</div>
			</div>
		`);
		$main.find(".kqs-layby-done-another").on("click", () => {
			reset_flow();
			load_agreements("");
		});
		$main.find(".kqs-layby-hub-close").on("click", () => close());
	}

	function get_pos_mount(pos) {
		return pos?.wrapper?.length ? pos.wrapper : null;
	}

	function get_scroll_root(pos) {
		const mount = get_pos_mount(pos);
		if (!mount) return null;
		const section = mount.closest(".layout-main-section");
		return section.length ? section : mount;
	}

	function clear_layout_styles() {
		hub_scroll_root?.css({ minHeight: "", height: "" });
		hub_mount?.css({ minHeight: "", height: "", display: "", flexDirection: "" });
		$layer?.css({ minHeight: "", height: "", flex: "" });
	}

	function fit_layer() {
		if (!active_pos || !$layer || $layer.hasClass("d-none")) return;
		if (!hub_scroll_root?.length || !hub_mount?.length) return;
		const top = hub_scroll_root[0].getBoundingClientRect().top;
		const height = Math.max(400, window.innerHeight - top);
		hub_scroll_root.css({ minHeight: height, height });
		hub_mount.css({ minHeight: height, height, display: "flex", flexDirection: "column" });
		$layer.css({ flex: "1 1 auto", minHeight: 0, height: "100%" });
	}

	function open(pos, opts) {
		opts = opts || {};
		const mount = get_pos_mount(pos);
		if (!mount || !pos.$components_wrapper?.length) {
			frappe.msgprint(__("POS is still loading. Try again in a moment."));
			return;
		}
		if (typeof kqs_retail?.pos_tools_menu?.close_other_overlays === "function") {
			kqs_retail.pos_tools_menu.close_other_overlays({ except: "layby" });
		}
		ensure_dom();
		active_pos = pos;
		open_opts = opts;

		if (!$layer) {
			$layer = $('<div class="kqs-pos-layby-hub-layer d-none">').appendTo(mount);
			$layer.append(layout);
		}

		if (pos.recent_order_list?.$component?.is(":visible")) {
			pos.toggle_recent_order_list(false);
		}
		pos.$components_wrapper.hide();
		$layer.removeClass("d-none");
		hub_mount = mount;
		hub_mount.addClass("kqs-layby-hub-mount-host");
		hub_scroll_root = get_scroll_root(pos);
		hub_scroll_root?.addClass("kqs-layby-hub-mount");
		fit_layer();
		$(window).on("resize.kqsLaybyHub", fit_layer);

		pos.page.set_title(__("Layby Lookup & Pay"));
		pos.page.set_primary_action(__("Back to sale"), () => kqs_retail.pos_layby_hub.close(), "arrow-left");
		if (pos.page.btn_secondary?.length) pos.page.btn_secondary.hide();

		reset_flow();
		layout.find("#kqs-layby-hub-search").val("");
		load_agreements("");

		if (opts.agreement) {
			select_agreement(opts.agreement, opts.step !== "pay");
			if (opts.step === "pay") {
				init_payment_state();
				show_step("pay");
			}
		} else if (opts.customer) {
			layout.find("#kqs-layby-hub-search").val(opts.customer);
		}
	}

	function close(opts = {}) {
		if (!active_pos) return;
		const pos = active_pos;
		const restore_pos = opts.restore_pos !== false;
		$layer?.addClass("d-none");
		$(window).off("resize.kqsLaybyHub");
		hub_mount?.removeClass("kqs-layby-hub-mount-host");
		hub_mount = null;
		hub_scroll_root?.removeClass("kqs-layby-hub-mount");
		clear_layout_styles();
		hub_scroll_root = null;
		if (restore_pos) {
			pos.$components_wrapper.show();
			pos.page.set_title(__("Point of Sale"));
			pos.page.set_primary_action(__("New Invoice"), () => pos.new_invoice_event());
			pos.page.set_secondary_action(__("Recent Orders"), () => pos.toggle_recent_order());
			if (pos.page.btn_secondary?.length) pos.page.btn_secondary.show();
		}
		active_pos = null;
		open_opts = {};
	}

	function is_open() {
		return Boolean(active_pos && $layer && !$layer.hasClass("d-none"));
	}

	return { open, close, is_open };
})();


/* Copyright (c) 2026, KQS — Tile-based POS tools menu for ERPNext Point of Sale
 */

const KQS_POS_TOOLS_MENU_VERSION = KQS_POS_PAGE_SCRIPT_VERSION;

frappe.provide("kqs_retail.pos_tools_menu");

kqs_retail.pos_tools_menu = (function () {
	let active_pos = null;
	let $layer = null;
	let layout = null;
	let hub_mount = null;
	let hub_scroll_root = null;

	const FONT_STACK =
		'-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", system-ui, sans-serif';

	function esc(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	function is_layby_enabled() {
		return cint(frappe.boot?.kqs_retail_settings?.layby_enabled_on_pos) !== 0;
	}

	function icon_layby() {
		return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 4h8a2 2 0 0 1 2 2v1H6V6a2 2 0 0 1 2-2zm-2 5h12v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9zm3 3.5a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H9zm0 3a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5H9z"/></svg>`;
	}

	function icon_customer() {
		return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 8.25a7 7 0 0 1 14 0 .75.75 0 0 1-.75.75H5.75A.75.75 0 0 1 5 20.25z"/></svg>`;
	}

	function icon_returns() {
		return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-6.36 15.36l.53.53V21a.75.75 0 0 0 1.28.53l2.25-2.25H12A9 9 0 0 0 12 3zm-1.25 5.5a.75.75 0 0 1 1.06 0L12 8.69l2.19-2.19a.75.75 0 1 1 1.06 1.06L13.06 9.75H15a.75.75 0 0 1 0 1.5h-3.25V13a.75.75 0 0 1-1.5 0v-1.75H9a.75.75 0 0 1 0-1.5h1.94l-2.19-2.19a.75.75 0 0 1 0-1.06z"/></svg>`;
	}

	function icon_recent() {
		return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.76 9.76 0 0 0 12 2.25zm.75 5a.75.75 0 0 0-1.5 0v4.19c0 .2.08.39.22.53l2.63 2.63a.75.75 0 1 0 1.06-1.06l-2.5-2.5V7.25z"/></svg>`;
	}

	function icon_close() {
		return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.47 8.47a.75.75 0 0 1 1.06 0L12 10.94l2.47-2.47a.75.75 0 1 1 1.06 1.06L13.06 12l2.47 2.47a.75.75 0 0 1-1.06 1.06L12 13.06l-2.47 2.47a.75.75 0 0 1-1.06-1.06L10.94 12 8.47 9.53a.75.75 0 0 1 0-1.06z"/><path d="M4.5 4.5A9 9 0 1 1 3 12a9 9 0 0 1 1.5-7.5z" opacity=".18"/></svg>`;
	}

	function get_tiles(pos) {
		const tiles = [];

		if (is_layby_enabled()) {
			tiles.push({
				id: "layby",
				title: __("Layby Lookup & Pay"),
				desc: __("Search agreements, collect payments, amend or cancel."),
				gradient: "linear-gradient(145deg, #64D2FF 0%, #0A84FF 100%)",
				icon: icon_layby(),
				action() {
					if (typeof kqs_retail?.point_of_sale?.open_layby_hub === "function") {
						kqs_retail.point_of_sale.open_layby_hub(pos);
					} else if (typeof kqs_retail?.pos_layby_hub?.open === "function") {
						kqs_retail.pos_layby_hub.open(pos);
					}
				},
			});
		}

		tiles.push(
			{
				id: "customer-account",
				title: __("Customer Account"),
				desc: __("Balances, on-account payments, and full history."),
				gradient: "linear-gradient(145deg, #63E6A5 0%, #30D158 100%)",
				icon: icon_customer(),
				action() {
					if (typeof kqs_retail?.point_of_sale?.open_customer_account === "function") {
						kqs_retail.point_of_sale.open_customer_account(pos);
					} else if (typeof kqs_retail?.pos_customer_account?.open === "function") {
						kqs_retail.pos_customer_account.open(pos);
					}
				},
			},
			{
				id: "returns",
				title: __("Returns & Store Credit"),
				desc: __("Find receipts, process returns, issue credit."),
				gradient: "linear-gradient(145deg, #FFB340 0%, #FF9F0A 100%)",
				icon: icon_returns(),
				action() {
					if (typeof kqs_retail?.point_of_sale?.open_returns === "function") {
						kqs_retail.point_of_sale.open_returns(pos);
					} else if (typeof kqs_retail?.pos_returns?.open === "function") {
						kqs_retail.pos_returns.open(pos);
					}
				},
			},
			{
				id: "recent-orders",
				title: __("Recent Orders"),
				desc: __("Reprint receipts or start a return quickly."),
				gradient: "linear-gradient(145deg, #DA8FFF 0%, #BF5AF2 100%)",
				icon: icon_recent(),
				action() {
					if (typeof pos.toggle_recent_order === "function") {
						pos.toggle_recent_order();
					}
				},
			},
			{
				id: "close-pos",
				title: __("Close POS"),
				desc: __("End your session and prepare the closing entry."),
				gradient: "linear-gradient(145deg, #AEAEB2 0%, #636366 100%)",
				icon: icon_close(),
				action() {
					if (typeof pos.close_pos === "function") {
						pos.close_pos();
					}
				},
			}
		);

		return tiles;
	}

	function inject_styles() {
		const style_id = `kqs-pos-tools-menu-styles-v${KQS_POS_TOOLS_MENU_VERSION}`;
		document.querySelectorAll('[id^="kqs-pos-tools-menu-styles"]').forEach((el) => el.remove());
		if (document.getElementById(style_id)) return;
		const style = document.createElement("style");
		style.id = style_id;
		style.textContent = `
			[data-page-route="point-of-sale"] .layout-main-section.kqs-tools-menu-mount {
				padding-bottom: 0 !important;
				margin-bottom: 0 !important;
				overflow: hidden;
				background: #ffffff !important;
			}
			.point-of-sale-app.kqs-tools-menu-mount-host {
				width: 100%;
				box-sizing: border-box;
				background: #ffffff;
				font-family: ${FONT_STACK};
				-webkit-font-smoothing: antialiased;
				-moz-osx-font-smoothing: grayscale;
			}
			.kqs-pos-tools-menu-layer {
				display: none;
				flex: 1 1 auto;
				width: 100%;
				min-height: 0;
				overflow: auto;
				background: #ffffff;
				-webkit-overflow-scrolling: touch;
			}
			.kqs-pos-tools-menu-layer:not(.d-none) {
				display: flex;
				flex-direction: column;
			}
			.kqs-tools-menu-app {
				flex: 1 1 auto;
				width: 100%;
				max-width: 52rem;
				margin: 0 auto;
				padding: 2rem 1.5rem 2.5rem;
				box-sizing: border-box;
				background: #ffffff;
			}
			@media (min-width: 768px) {
				.kqs-tools-menu-app {
					padding: 2.5rem 2rem 3rem;
				}
			}
			.kqs-tools-menu-hero {
				margin-bottom: 2rem;
				padding-bottom: 0.25rem;
			}
			.kqs-tools-menu-eyebrow {
				display: block;
				margin: 0 0 0.5rem;
				font-size: 0.6875rem;
				font-weight: 600;
				letter-spacing: 0.12em;
				text-transform: uppercase;
				color: #86868b;
			}
			.kqs-tools-menu-heading {
				margin: 0;
				font-size: clamp(2rem, 4vw, 2.75rem);
				font-weight: 700;
				line-height: 1.05;
				letter-spacing: -0.035em;
				color: #1d1d1f;
			}
			.kqs-tools-menu-subtitle {
				margin: 0.65rem 0 0;
				max-width: 28rem;
				font-size: 1.0625rem;
				font-weight: 400;
				line-height: 1.45;
				letter-spacing: -0.01em;
				color: #6e6e73;
			}
			.kqs-tools-menu-grid {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 0.875rem;
				max-width: 38rem;
				margin: 0 auto;
				width: 100%;
			}
			@media (max-width: 480px) {
				.kqs-tools-menu-grid {
					grid-template-columns: repeat(2, minmax(0, 1fr));
					gap: 0.75rem;
				}
			}
			.kqs-tools-menu-tile {
				display: flex;
				flex-direction: column;
				align-items: flex-start;
				justify-content: space-between;
				gap: 0.7rem;
				width: 100%;
				aspect-ratio: 1 / 1;
				padding: 0.95rem 0.9rem 1rem;
				border: 1px solid #e5e5ea;
				border-radius: 1.15rem;
				background: #f5f5f7;
				box-shadow:
					0 1px 2px rgba(0, 0, 0, 0.04),
					inset 0 1px 0 rgba(255, 255, 255, 0.7);
				text-align: left;
				cursor: pointer;
				transition:
					transform 0.22s cubic-bezier(0.25, 0.1, 0.25, 1),
					box-shadow 0.22s cubic-bezier(0.25, 0.1, 0.25, 1),
					border-color 0.22s ease,
					background 0.22s ease;
				-webkit-tap-highlight-color: transparent;
			}
			.kqs-tools-menu-tile:hover {
				transform: translateY(-2px);
				border-color: #d1d1d6;
				background: #f2f2f7;
				box-shadow:
					0 4px 10px rgba(0, 0, 0, 0.06),
					0 12px 28px rgba(0, 0, 0, 0.07),
					inset 0 1px 0 rgba(255, 255, 255, 0.85);
			}
			.kqs-tools-menu-tile:focus {
				outline: none;
				border-color: #c7c7cc;
				box-shadow:
					0 0 0 4px rgba(0, 122, 255, 0.16),
					0 4px 12px rgba(0, 0, 0, 0.06);
			}
			.kqs-tools-menu-tile:active {
				transform: scale(0.98);
				background: #ebebf0;
				box-shadow:
					0 1px 2px rgba(0, 0, 0, 0.05),
					inset 0 1px 0 rgba(255, 255, 255, 0.55);
			}
			.kqs-tools-menu-tile-icon {
				display: flex;
				align-items: center;
				justify-content: center;
				flex: 0 0 auto;
				width: 3rem;
				height: 3rem;
				border-radius: 0.85rem;
				color: #ffffff;
				background: var(--kqs-tile-gradient, linear-gradient(145deg, #64D2FF 0%, #0A84FF 100%));
				box-shadow:
					inset 0 1px 0 rgba(255, 255, 255, 0.28),
					0 6px 14px rgba(0, 0, 0, 0.14);
			}
			.kqs-tools-menu-tile-icon svg {
				width: 1.45rem;
				height: 1.45rem;
			}
			.kqs-tools-menu-tile-body {
				flex: 1 1 auto;
				min-width: 0;
				display: flex;
				flex-direction: column;
				justify-content: flex-end;
				width: 100%;
			}
			.kqs-tools-menu-tile-title {
				display: block;
				margin: 0;
				font-size: 0.9375rem;
				font-weight: 600;
				line-height: 1.2;
				letter-spacing: -0.02em;
				color: #1d1d1f;
			}
			.kqs-tools-menu-tile-desc {
				display: -webkit-box;
				margin: 0.35rem 0 0;
				font-size: 0.8125rem;
				font-weight: 400;
				line-height: 1.35;
				letter-spacing: -0.008em;
				color: #6e6e73;
				-webkit-line-clamp: 3;
				-webkit-box-orient: vertical;
				overflow: hidden;
			}
			.kqs-pos-tools-header-btn {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 0.4rem;
				min-height: 2.125rem;
				padding: 0.4rem 0.95rem 0.4rem 0.8rem;
				border: none !important;
				border-radius: 999px;
				background: rgba(0, 0, 0, 0.05) !important;
				color: #1d1d1f !important;
				font-family: ${FONT_STACK};
				font-size: 0.875rem;
				font-weight: 600;
				letter-spacing: -0.01em;
				box-shadow: none !important;
				transition: background 0.18s ease, transform 0.18s ease;
				-webkit-tap-highlight-color: transparent;
			}
			.kqs-pos-tools-header-btn svg {
				width: 1rem;
				height: 1rem;
				flex: 0 0 auto;
				opacity: 0.88;
			}
			.kqs-pos-tools-header-btn:hover,
			.kqs-pos-tools-header-btn:focus {
				background: rgba(0, 0, 0, 0.08) !important;
				color: #1d1d1f !important;
			}
			.kqs-pos-tools-header-btn:active {
				transform: scale(0.97);
				background: rgba(0, 0, 0, 0.11) !important;
			}
			[data-page-route="point-of-sale"] .page-actions .menu-btn-group {
				display: none !important;
			}
		`;
		document.head.appendChild(style);
	}

	function close_other_overlays(opts = {}) {
		const except = opts.except;
		const restore_pos = opts.restore_pos === true;
		const overlays = [
			["layby", kqs_retail.pos_layby_hub],
			["customer-account", kqs_retail.pos_customer_account],
			["returns", kqs_retail.pos_returns],
			["menu", kqs_retail.pos_tools_menu],
		];
		overlays.forEach(([id, hub]) => {
			if (except && id === except) return;
			if (hub?.is_open?.()) {
				hub.close({ restore_pos });
			}
		});
	}

	function render_tiles(pos) {
		const tiles = get_tiles(pos);
		const html = tiles
			.map((tile) => {
				return `<button type="button" class="kqs-tools-menu-tile" data-tile-id="${esc(tile.id)}"
					style="--kqs-tile-gradient:${esc(tile.gradient)};">
					<span class="kqs-tools-menu-tile-icon">${tile.icon}</span>
					<span class="kqs-tools-menu-tile-body">
						<span class="kqs-tools-menu-tile-title">${esc(tile.title)}</span>
						<span class="kqs-tools-menu-tile-desc">${esc(tile.desc)}</span>
					</span>
				</button>`;
			})
			.join("");

		layout.find(".kqs-tools-menu-grid").html(html);
		layout.find(".kqs-tools-menu-tile").on("click", function () {
			const id = $(this).data("tile-id");
			const tile = tiles.find((row) => row.id === id);
			if (!tile) return;
			const target_pos = active_pos;
			close({ restore_pos: false });
			frappe.after_ajax(() => tile.action(target_pos));
		});
	}

	function ensure_dom() {
		inject_styles();
		if (layout) return;
		layout = $(`
			<div class="kqs-tools-menu-app">
				<header class="kqs-tools-menu-hero">
					<span class="kqs-tools-menu-eyebrow">${__("Store tools")}</span>
					<h2 class="kqs-tools-menu-heading">${__("Menu")}</h2>
					<p class="kqs-tools-menu-subtitle">${__(
						"Everything you need beyond the sale — laid out clearly for the till."
					)}</p>
				</header>
				<div class="kqs-tools-menu-grid" role="list"></div>
			</div>
		`);
	}

	function get_pos_mount(pos) {
		const mount = pos?.wrapper;
		return mount?.length ? mount : null;
	}

	function get_scroll_root(pos) {
		const mount = get_pos_mount(pos);
		if (!mount) return null;
		const section = mount.closest(".layout-main-section");
		return section.length ? section : mount;
	}

	function clear_layout_styles() {
		hub_scroll_root?.css({ minHeight: "", height: "" });
		hub_mount?.css({ minHeight: "", height: "", display: "", flexDirection: "" });
		$layer?.css({ minHeight: "", height: "", flex: "" });
	}

	function fit_layer() {
		if (!active_pos || !$layer || $layer.hasClass("d-none")) return;
		if (!hub_scroll_root?.length || !hub_mount?.length) return;
		const top = hub_scroll_root[0].getBoundingClientRect().top;
		const height = Math.max(400, window.innerHeight - top);
		hub_scroll_root.css({ minHeight: height, height });
		hub_mount.css({ minHeight: height, height, display: "flex", flexDirection: "column" });
		$layer.css({ flex: "1 1 auto", minHeight: 0, height: "100%" });
	}

	function open(pos) {
		const mount = get_pos_mount(pos);
		if (!mount) {
			frappe.msgprint(__("POS layout is not ready. Wait for the till to finish loading."));
			return;
		}
		if (!pos.$components_wrapper?.length) {
			frappe.msgprint(__("POS is still starting up. Try again in a moment."));
			return;
		}
		if (is_open()) return;
		close_other_overlays({ except: "menu" });
		ensure_dom();
		active_pos = pos;

		if (!$layer) {
			$layer = $('<div class="kqs-pos-tools-menu-layer d-none">').appendTo(mount);
			$layer.append(layout);
		}

		if (pos.recent_order_list?.$component?.is(":visible")) {
			pos.toggle_recent_order_list(false);
		}
		pos.$components_wrapper.hide();
		$layer.removeClass("d-none");
		hub_mount = mount;
		hub_mount.addClass("kqs-tools-menu-mount-host");
		hub_scroll_root = get_scroll_root(pos);
		hub_scroll_root?.addClass("kqs-tools-menu-mount");
		fit_layer();
		$(window).on("resize.kqsToolsMenu", fit_layer);

		pos.page.set_title(__("Menu"));
		pos.page.set_primary_action(__("Back to sale"), () => kqs_retail.pos_tools_menu.close(), "arrow-left");
		if (pos.page.btn_secondary?.length) pos.page.btn_secondary.hide();

		render_tiles(pos);
	}

	function close(opts = {}) {
		if (!active_pos) return;
		const pos = active_pos;
		const restore_pos = opts.restore_pos !== false;
		$layer?.addClass("d-none");
		$(window).off("resize.kqsToolsMenu");
		hub_mount?.removeClass("kqs-tools-menu-mount-host");
		hub_mount = null;
		hub_scroll_root?.removeClass("kqs-tools-menu-mount");
		clear_layout_styles();
		hub_scroll_root = null;
		if (restore_pos) {
			pos.$components_wrapper.show();
			pos.page.set_title(__("Point of Sale"));
			pos.page.set_primary_action(__("New Invoice"), () => pos.new_invoice_event());
			pos.page.set_secondary_action(__("Recent Orders"), () => pos.toggle_recent_order());
			if (pos.page.btn_secondary?.length) pos.page.btn_secondary.show();
		}
		active_pos = null;
	}

	function is_open() {
		return Boolean(active_pos && $layer && !$layer.hasClass("d-none"));
	}

	function ensure_header_button(pos) {
		if (!pos?.page) return;
		inject_styles();
		const $actions = pos.page.wrapper?.find(".page-actions");
		if (!$actions?.length || $actions.find(".kqs-pos-tools-header-btn").length) return;

		const label = __("Menu");
		const $btn = $(`
			<button type="button" class="btn btn-default kqs-pos-tools-header-btn" title="${esc(label)}" aria-label="${esc(label)}">
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<rect x="3" y="3" width="8" height="8" rx="2.2"></rect>
					<rect x="13" y="3" width="8" height="8" rx="2.2"></rect>
					<rect x="3" y="13" width="8" height="8" rx="2.2"></rect>
					<rect x="13" y="13" width="8" height="8" rx="2.2"></rect>
				</svg>
				<span>${esc(label)}</span>
			</button>
		`);
		$btn.on("click", () => open(window.cur_pos || pos));

		const $menu = $actions.find(".menu-btn-group").first();
		if ($menu.length) {
			$btn.insertBefore($menu);
		} else {
			$actions.prepend($btn);
		}
	}

	return { open, close, is_open, ensure_header_button, close_other_overlays };
})();


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
		auto_print_ar_payment_receipts: 1,
		ar_payment_print_format: "",
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

	function should_auto_print_ar_payment_receipts() {
		return cint(get_layby_settings().auto_print_ar_payment_receipts) === 1;
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
				"Open KQS Retail Settings â†’ Layby Receipts and link: {0}. You can still reprint later from Layby Agreement.",
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
				"Print or email receipts below â€” same as after a normal POS sale."
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

	function print_ar_payment_receipts(payment_entries, print_format) {
		if (!print_format || !payment_entries?.length) return;
		payment_entries.forEach((pe, index) => {
			setTimeout(() => open_kqs_print_view("Payment Entry", pe, print_format), index * 700);
		});
	}

	function normalize_payment_entry_names(result) {
		const raw = result?.payment_entries;
		if (Array.isArray(raw) && raw.length) {
			return raw.filter(Boolean);
		}
		if (typeof raw === "string" && raw.trim()) {
			return [raw.trim()];
		}
		if (result?.primary_payment_entry) {
			return [result.primary_payment_entry];
		}
		return [];
	}

	async function fetch_recent_ar_payment_entries(customer, limit = 5) {
		if (!customer) return [];
		try {
			const { message } = await frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Payment Entry",
					filters: {
						party_type: "Customer",
						party: customer,
						payment_type: "Receive",
						docstatus: 1,
					},
					fields: ["name"],
					order_by: "creation desc",
					limit_page_length: limit,
				},
			});
			return (message || []).map((row) => row.name).filter(Boolean);
		} catch (e) {
			console.warn("Could not load recent account payment entries.", e);
			return [];
		}
	}

	async function resolve_ar_payment_receipt_context(result) {
		let payment_entries = normalize_payment_entry_names(result);
		if (!payment_entries.length && result?.customer) {
			payment_entries = await fetch_recent_ar_payment_entries(result.customer, 3);
		}

		let print_format = (result?.print_format || "").trim();
		let auto_print = result?.auto_print_receipt;
		if (!print_format || auto_print === undefined || auto_print === null) {
			await refresh_layby_settings_from_server();
			const settings = get_layby_settings();
			if (!print_format) print_format = (settings.ar_payment_print_format || "").trim();
			if (auto_print === undefined || auto_print === null) {
				auto_print = settings.auto_print_ar_payment_receipts;
			}
		}

		return { payment_entries, print_format, auto_print: cint(auto_print) === 1 };
	}

	async function show_ar_payment_success_dialog(result, extras = {}) {
		if (!result?.customer) return;
		const { payment_entries, print_format, auto_print } =
			await resolve_ar_payment_receipt_context(result);
		const currency = extras.currency || frappe.defaults.get_default("currency");
		const customer_name = extras.customer_name || result.customer_name || result.customer;
		const change = flt(extras.change);
		const paid = flt(result.paid_amount);
		const remaining = flt(result.ar_outstanding_after);

		if (auto_print && print_format && payment_entries.length) {
			print_ar_payment_receipts(payment_entries, print_format);
		}

		const d = new frappe.ui.Dialog({
			title: __("Payment Recorded"),
			fields: [{ fieldname: "ui", fieldtype: "HTML" }],
			primary_action_label: __("Done"),
			primary_action() {
				d.hide();
			},
		});

		const change_html =
			change > 0
				? `<div class="kqs-layby-deposit-hero" style="margin-top:0.75rem">
					<div class="hero-label">${__("Change to give customer")}</div>
					<div class="hero-amount">${format_currency(change, currency)}</div>
				</div>`
				: "";

		let receipt_actions = "";
		if (print_format && payment_entries.length) {
			receipt_actions = `<button type="button" class="btn btn-primary btn-sm kqs-ar-print-receipt">${__(
				"Print Receipt"
			)}</button>`;
		} else if (!print_format) {
			receipt_actions = `<p class="text-muted small">${__(
				"Link an Account Payment Print Format in KQS Retail Settings to print receipts."
			)}</p>`;
		} else {
			receipt_actions = `<p class="text-muted small">${__(
				"Receipt could not be loaded. Reprint from Desk → Payment Entry."
			)}</p>`;
		}

		d.fields_dict.ui.$wrapper.html(`
			<p>${__("Account payment recorded for {0}.", [
				frappe.utils.escape_html(customer_name),
			])}</p>
			${change_html}
			<div class="kqs-layby-summary" style="margin-top:0.75rem">
				<div class="kqs-layby-summary-card">
					<div class="label">${__("Paid Today")}</div>
					<div class="value">${format_currency(paid, currency)}</div>
				</div>
				<div class="kqs-layby-summary-card">
					<div class="label">${__("Still Owes")}</div>
					<div class="value">${format_currency(remaining, currency)}</div>
				</div>
			</div>
			<p class="text-muted small" style="margin-top:0.65rem">${__(
				"Give the customer their receipt — same as after a normal sale."
			)}</p>
			<div class="kqs-layby-receipt-actions" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem;">
				${receipt_actions}
			</div>
		`);

		d.$wrapper.addClass("kqs-layby-dialog");
		d.fields_dict.ui.$wrapper.find(".kqs-ar-print-receipt").on("click", () => {
			print_ar_payment_receipts(payment_entries, print_format);
		});

		d.show();
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

	const STORE_CREDIT_MODE_NAMES = ["Store Credit", "Account Balance"];
	const ACCOUNT_SALE_MODE_NAMES = ["On Account", "Account"];
	const EMPTY_CUSTOMER_ACCOUNT = {
		store_credit_balance: 0,
		ar_outstanding: 0,
		layby_balance_total: 0,
		layby_count: 0,
		credit_available: 0,
		allow_account_sales: false,
		loyalty_points: 0,
		loyalty_program: "",
		loyalty_amount: 0,
		walk_in: true,
	};
	let kqs_customer_account = { ...EMPTY_CUSTOMER_ACCOUNT };

	function format_loyalty_points(points) {
		const value = Math.floor(flt(points));
		return `${value.toLocaleString()} ${__("pts")}`;
	}

	function get_store_credit_balance_from_account() {
		return flt(kqs_customer_account.store_credit_balance);
	}

	function fetch_customer_account_summary(frm) {
		if (!frm?.doc?.customer || is_walk_in_customer(frm)) {
			kqs_customer_account = { ...EMPTY_CUSTOMER_ACCOUNT, walk_in: true };
			return Promise.resolve(kqs_customer_account);
		}
		const warehouse = get_pos_warehouse(frm);
		return frappe
			.call({
				method: "kqs_retail.api.customer_account.get_customer_account_summary",
				args: {
					customer: frm.doc.customer,
					company: frm.doc.company,
					warehouse: warehouse,
				},
			})
			.then((r) => {
				kqs_customer_account = { ...EMPTY_CUSTOMER_ACCOUNT, ...(r.message || {}) };
				return kqs_customer_account;
			})
			.catch(() => {
				kqs_customer_account = { ...EMPTY_CUSTOMER_ACCOUNT };
				return kqs_customer_account;
			});
	}

	function fetch_store_credit_balance(frm) {
		return fetch_customer_account_summary(frm).then(() =>
			get_store_credit_balance_from_account()
		);
	}

	function is_store_credit_mode(mode_of_payment) {
		if (!mode_of_payment) return false;
		const normalized = String(mode_of_payment).trim().toLowerCase();
		return STORE_CREDIT_MODE_NAMES.some((name) => name.toLowerCase() === normalized);
	}

	function is_account_sale_mode(mode_of_payment) {
		if (!mode_of_payment) return false;
		const normalized = String(mode_of_payment).trim().toLowerCase();
		return ACCOUNT_SALE_MODE_NAMES.some((name) => name.toLowerCase() === normalized);
	}

	function is_real_money_mode(mode_of_payment) {
		return !is_store_credit_mode(mode_of_payment) && !is_account_sale_mode(mode_of_payment);
	}

	function get_cash_paid_total(frm) {
		return (frm.doc.payments || []).reduce((sum, row) => {
			if (!is_real_money_mode(row.mode_of_payment)) return sum;
			return sum + flt(row.amount);
		}, 0);
	}

	function get_account_payment_total(frm) {
		return (frm.doc.payments || []).reduce(
			(sum, row) => sum + (is_account_sale_mode(row.mode_of_payment) ? flt(row.amount) : 0),
			0
		);
	}

	function get_total_payment_allocated(frm) {
		return (frm.doc.payments || []).reduce((sum, row) => sum + flt(row.amount), 0);
	}

	function get_store_credit_payment_total(frm) {
		return (frm.doc.payments || []).reduce(
			(sum, row) => sum + (is_store_credit_mode(row.mode_of_payment) ? flt(row.amount) : 0),
			0
		);
	}

	function max_store_credit_for_cart(frm) {
		return Math.min(get_store_credit_balance_from_account(), get_grand_total(frm));
	}

	function validate_store_credit_payments(frm) {
		const credit_used = get_store_credit_payment_total(frm);
		if (credit_used <= 0) return true;
		if (is_walk_in_customer(frm)) {
			frappe.msgprint(__("Select a named customer to use store credit."));
			return false;
		}
		const max_credit = max_store_credit_for_cart(frm);
		if (credit_used > max_credit + 0.01) {
			frappe.msgprint(
				__("Store credit cannot exceed {0} (available balance).", [
					format_currency(max_credit, frm.doc.currency),
				])
			);
			return false;
		}
		return true;
	}

	function validate_pos_payment_completion(frm) {
		if (!frm || is_return_checkout(frm)) {
			return Promise.resolve(true);
		}
		const grand = get_grand_total(frm);
		const allocated = get_total_payment_allocated(frm);
		const account = get_account_payment_total(frm);
		const currency = frm.doc.currency;

		if (allocated <= 0.01) {
			frappe.msgprint({
				title: __("Payment required"),
				indicator: "red",
				message: __("Enter payment amounts before completing the order."),
			});
			return Promise.resolve(false);
		}

		// Cash/card/mobile over the sale is change (ERPNext change_amount + receipt print).
		// Only underpayment is blocked here; store credit caps are checked separately.
		const shortfall = grand - allocated;
		if (shortfall > 0.02) {
			if (account <= 0.01) {
				frappe.msgprint({
					title: __("Payment incomplete"),
					indicator: "red",
					message: __(
						"Payments are short by {0}. Collect more or allocate the balance to On Account.",
						[format_currency(shortfall, currency)]
					),
				});
				return Promise.resolve(false);
			}
			frappe.msgprint({
				title: __("Payment incomplete"),
				indicator: "red",
				message: __("Payments total {0} does not match sale total {1}.", [
					format_currency(allocated, currency),
					format_currency(grand, currency),
				]),
			});
			return Promise.resolve(false);
		}

		if (account <= 0.01) {
			return Promise.resolve(true);
		}
		if (is_walk_in_customer(frm)) {
			frappe.msgprint(__("Named customer required for On Account."));
			return Promise.resolve(false);
		}
		return frappe
			.call({
				method: "kqs_retail.api.customer_account.validate_account_sale",
				args: {
					customer: frm.doc.customer,
					company: frm.doc.company,
					account_amount: account,
				},
			})
			.then((r) => {
				if (r.message?.allowed) {
					return true;
				}
				frappe.msgprint({
					title: __("On Account not allowed"),
					indicator: "red",
					message:
						r.message?.reason ||
						__("This customer cannot take this amount on account."),
				});
				return false;
			})
			.catch(() => false);
	}

	function inject_store_credit_styles() {
		if (document.getElementById("kqs-pos-store-credit-styles")) return;
		const style = document.createElement("style");
		style.id = "kqs-pos-store-credit-styles";
		style.textContent = `
			.point-of-sale-app .customer-section .kqs-store-credit-badge {
				flex-shrink: 0;
				margin-left: auto;
				margin-right: 0.5rem;
				display: flex;
				flex-direction: column;
				align-items: flex-end;
				gap: 0.05rem;
				padding: 0.3rem 0.55rem;
				border-radius: 8px;
				border: 1px solid #a7f3d0;
				background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
				color: #065f46;
				line-height: 1.2;
				min-width: 4.5rem;
			}
			.point-of-sale-app .customer-section .kqs-store-credit-badge__label {
				font-size: 9px;
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				opacity: 0.8;
			}
			.point-of-sale-app .customer-section .kqs-store-credit-badge__amount {
				font-size: 12px;
				font-weight: 800;
				white-space: nowrap;
			}
			.point-of-sale-app .customer-section .kqs-store-credit-badge__hint {
				font-size: 9px;
				font-weight: 600;
				text-align: right;
				max-width: 5.5rem;
				line-height: 1.25;
			}
			.point-of-sale-app .customer-section .kqs-store-credit-badge.is-empty {
				background: #f9fafb;
				border-color: #e5e7eb;
				color: #6b7280;
			}
			.point-of-sale-app .customer-section .kqs-store-credit-badge.is-walkin {
				background: #fffbeb;
				border-color: #fcd34d;
				color: #92400e;
			}
			.point-of-sale-app .customer-section .customer-details.kqs-has-checkout-wallet {
				display: flex;
				flex-direction: column;
				gap: 0.45rem;
			}
			.point-of-sale-app .customer-section .customer-details.kqs-has-checkout-wallet > .customer-display {
				min-width: 0;
				width: 100%;
			}
			.point-of-sale-app .customer-section .customer-details.kqs-has-checkout-wallet .customer-name-desc {
				flex: 1 1 auto;
				min-width: 0;
				overflow: hidden;
			}
			.point-of-sale-app .customer-section .customer-details.kqs-has-checkout-wallet .customer-name {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.point-of-sale-app .customer-section .customer-details.kqs-has-checkout-wallet .customer-desc {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.point-of-sale-app .customer-section .customer-details.kqs-has-checkout-wallet .reset-customer-btn {
				flex-shrink: 0;
				margin-left: auto;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet {
				flex-shrink: 0;
				margin: 0;
				width: 100%;
				max-width: none;
				box-sizing: border-box;
				display: flex;
				flex-direction: column;
				gap: 0.35rem;
				padding: 0.45rem 0.55rem 0.5rem;
				border-radius: 12px;
				background: linear-gradient(145deg, #ffffff 0%, #f8fafc 55%, #f1f5f9 100%);
				border: 1px solid rgba(15, 23, 42, 0.08);
				box-shadow:
					0 1px 2px rgba(15, 23, 42, 0.06),
					0 4px 14px rgba(15, 23, 42, 0.05),
					inset 0 1px 0 rgba(255, 255, 255, 0.9);
				min-width: 0;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__head {
				display: flex;
				align-items: center;
				gap: 0.35rem;
				padding-bottom: 0.25rem;
				border-bottom: 1px dashed rgba(100, 116, 139, 0.25);
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__mark {
				width: 1.15rem;
				height: 1.15rem;
				border-radius: 999px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 0.55rem;
				font-weight: 800;
				color: #fff;
				background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
				box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
				flex-shrink: 0;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__title {
				font-size: 8px;
				font-weight: 800;
				letter-spacing: 0.12em;
				text-transform: uppercase;
				color: #64748b;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stats {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 0.35rem;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat {
				display: flex;
				flex-direction: column;
				gap: 0.1rem;
				padding: 0.35rem 0.4rem;
				border-radius: 8px;
				min-width: 0;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--owe {
				background: linear-gradient(160deg, #fff7ed 0%, #ffedd5 100%);
				border: 1px solid rgba(234, 88, 12, 0.18);
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--credit {
				background: linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%);
				border: 1px solid rgba(5, 150, 105, 0.18);
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--loyalty {
				background: linear-gradient(160deg, #f5f3ff 0%, #ede9fe 100%);
				border: 1px solid rgba(109, 40, 217, 0.18);
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat-label {
				font-size: 7px;
				font-weight: 800;
				letter-spacing: 0.08em;
				text-transform: uppercase;
				opacity: 0.75;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--owe .kqs-customer-wallet__stat-label {
				color: #9a3412;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--credit .kqs-customer-wallet__stat-label {
				color: #065f46;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--loyalty .kqs-customer-wallet__stat-label {
				color: #5b21b6;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat-value {
				font-size: 11px;
				font-weight: 800;
				line-height: 1.15;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				font-variant-numeric: tabular-nums;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--owe .kqs-customer-wallet__stat-value {
				color: #c2410c;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--credit .kqs-customer-wallet__stat-value {
				color: #047857;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__stat--loyalty .kqs-customer-wallet__stat-value {
				color: #6d28d9;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet.is-walkin {
				background: linear-gradient(145deg, #fffbeb 0%, #fef3c7 100%);
				border-color: rgba(217, 119, 6, 0.22);
				box-shadow: 0 2px 10px rgba(217, 119, 6, 0.08);
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet.is-walkin .kqs-customer-wallet__mark {
				background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet.is-walkin .kqs-customer-wallet__title {
				color: #92400e;
			}
			.point-of-sale-app .customer-section .kqs-customer-wallet__walkin-msg {
				font-size: 10px;
				font-weight: 700;
				line-height: 1.3;
				color: #92400e;
			}
			.point-of-sale-app .payment-container .kqs-account-sale-hint {
				margin: 0.5rem 0;
				padding: 0.45rem 0.6rem;
				border-radius: 6px;
				background: #fff7ed;
				border: 1px solid #fdba74;
				color: #9a3412;
				font-size: 11px;
				font-weight: 600;
			}
			.point-of-sale-app .payment-container .mode-of-payment.kqs-store-credit-disabled {
				opacity: 0.45;
				pointer-events: none;
			}
		`;
		document.head.appendChild(style);
	}

	function update_customer_account_banner(payment) {
		const frm = payment?.events?.get_frm?.() || window.cur_pos?.frm;
		const $customerSection = $(".customer-section:visible");
		const paymentVisible = $(".payment-container:visible").length > 0;

		inject_store_credit_styles();
		$(".kqs-store-credit-badge, .kqs-customer-wallet, .kqs-customer-account-banner").remove();
		$(".customer-section .customer-details").removeClass("kqs-has-checkout-wallet");
		$(".payment-container .kqs-store-credit-banner, .payment-container .kqs-account-sale-hint").remove();

		if (!$customerSection.length || !paymentVisible) return;

		const walkIn = !frm || is_walk_in_customer(frm);
		const currency = frm?.doc?.currency;
		const acct = kqs_customer_account;
		const $display = $customerSection.find(".customer-display");
		const $details = $customerSection.find(".customer-details");
		if (!$display.length) return;

		$details.removeClass("kqs-has-checkout-wallet");

		let bannerHtml;
		if (walkIn) {
			bannerHtml = `<div class="kqs-customer-wallet is-walkin">
				<div class="kqs-customer-wallet__head">
					<span class="kqs-customer-wallet__mark">!</span>
					<span class="kqs-customer-wallet__title">${__("Checkout")}</span>
				</div>
				<span class="kqs-customer-wallet__walkin-msg">${__("Select a named customer for store credit or on account.")}</span>
			</div>`;
		} else {
			bannerHtml = `<div class="kqs-customer-wallet">
				<div class="kqs-customer-wallet__head">
					<span class="kqs-customer-wallet__mark">K</span>
					<span class="kqs-customer-wallet__title">${__("Balances")}</span>
				</div>
				<div class="kqs-customer-wallet__stats">
					<div class="kqs-customer-wallet__stat kqs-customer-wallet__stat--owe">
						<span class="kqs-customer-wallet__stat-label">${__("Owes")}</span>
						<span class="kqs-customer-wallet__stat-value">${format_currency(
							acct.ar_outstanding,
							currency
						)}</span>
					</div>
					<div class="kqs-customer-wallet__stat kqs-customer-wallet__stat--credit">
						<span class="kqs-customer-wallet__stat-label">${__("Credit")}</span>
						<span class="kqs-customer-wallet__stat-value">${format_currency(
							acct.store_credit_balance,
							currency
						)}</span>
					</div>
					<div class="kqs-customer-wallet__stat kqs-customer-wallet__stat--loyalty">
						<span class="kqs-customer-wallet__stat-label">${__("Loyalty")}</span>
						<span class="kqs-customer-wallet__stat-value">${format_loyalty_points(
							acct.loyalty_points
						)}</span>
					</div>
				</div>
			</div>`;
		}

		const $banner = $(bannerHtml);
		$details.addClass("kqs-has-checkout-wallet");
		$banner.insertAfter($display);
		if (!walkIn && frm?.doc?.customer) {
			$banner.addClass("kqs-customer-wallet--open-hub").css("cursor", "pointer");
			$banner.attr("title", __("Open Customer Account"));
			$banner.on("click.kqsOpenCustomerAccount", () => {
				open_kqs_customer_account(window.cur_pos, {
					customer: frm.doc.customer,
					prefill_pos_customer: false,
				});
			});
		}

		const $paymentModes = payment?.$payment_modes || $(".payment-container:visible .payment-modes");
		$paymentModes.find(".mode-of-payment").each(function () {
			const $tile = $(this);
			const label = ($tile.text() || "").toLowerCase();
			const isCredit = STORE_CREDIT_MODE_NAMES.some((name) =>
				label.includes(name.toLowerCase())
			);
			const isAccount = ACCOUNT_SALE_MODE_NAMES.some((name) =>
				label.includes(name.toLowerCase())
			);
			$tile.toggleClass(
				"kqs-store-credit-disabled",
				(walkIn && (isCredit || isAccount)) ||
					(!walkIn && isAccount && !acct.allow_account_sales)
			);
		});
		apply_payment_mode_themes($(".payment-container:visible"));
		update_account_sale_hint(payment, frm);
	}

	function update_store_credit_badge(payment) {
		update_customer_account_banner(payment);
	}

	function is_walk_in_customer_doc(doc) {
		if (!doc?.customer) return true;
		const name = (doc.customer_name || doc.customer || "").toLowerCase();
		return name.includes("walk-in") || name.includes("walk in");
	}

	function show_return_customer_dialog(doc, onConfirm) {
		const d = new frappe.ui.Dialog({
			title: __("Return â€” store credit customer"),
			size: "small",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "intro",
					options: `<p class="text-muted small" style="margin:0 0 0.5rem">${__(
						"Search by name or mobile, pick an existing customer, or use <strong>+</strong> to create a new Customer. Credit is assigned to this account."
					)}</p>`,
				},
				{
					fieldname: "customer",
					fieldtype: "Link",
					options: "Customer",
					label: __("Customer"),
					reqd: 1,
					default: is_walk_in_customer_doc(doc) ? "" : doc.customer,
					get_query() {
						return {
							query: "kqs_retail.api.store_credit.customer_query_for_return_credit",
						};
					},
				},
			],
			primary_action_label: __("Continue return"),
			primary_action(values) {
				const customer = values.customer;
				if (!customer) return;
				frappe.call({
					method: "kqs_retail.api.store_credit.validate_return_credit_customer",
					args: { customer },
					freeze: true,
					callback(r) {
						if (r.exc) return;
						frappe.call({
							method: "kqs_retail.api.store_credit.set_return_credit_customer",
							args: { customer },
							callback(r2) {
								if (r2.exc) return;
								d.hide();
								onConfirm?.();
							},
						});
					},
				});
			},
		});
		d.show();
	}

	function open_kqs_customer_account(pos, opts) {
		const target = pos || window.cur_pos;
		if (!target) {
			frappe.msgprint(__("Point of Sale is still loading. Try again in a moment."));
			return;
		}
		if (typeof kqs_retail?.pos_customer_account?.open !== "function") {
			frappe.msgprint({
				title: __("Customer Account not loaded"),
				indicator: "orange",
				message: __("Reload the page once (F5). Your browser cached an older POS script."),
			});
			return;
		}
		try {
			kqs_retail.pos_customer_account.open(target, opts || {});
		} catch (e) {
			console.error("KQS Customer Account open failed", e);
			frappe.msgprint({
				title: __("Customer Account error"),
				indicator: "red",
				message: __("Could not open Customer Account. Check the browser console (F12) for details."),
			});
		}
	}

	function open_kqs_pos_returns(pos) {
		const target = pos || window.cur_pos;
		if (!target) {
			frappe.msgprint(__("Point of Sale is still loading. Try again in a moment."));
			return;
		}
		if (typeof kqs_retail?.pos_returns?.open !== "function") {
			frappe.msgprint({
				title: __("Returns not loaded"),
				indicator: "orange",
				message: __("Reload the page once (F5). Your browser cached an older POS script."),
			});
			return;
		}
		try {
			kqs_retail.pos_returns.open(target);
		} catch (e) {
			console.error("KQS Returns open failed", e);
			frappe.msgprint({
				title: __("Returns error"),
				indicator: "red",
				message: __("Could not open Returns. Check the browser console (F12) for details."),
			});
		}
	}

	function bind_kqs_return_button(order_summary) {
		if (!order_summary?.$summary_container) return;
		order_summary.$summary_container.off("click", ".return-btn");
		order_summary.$summary_container.off("click.kqs-return-credit", ".return-btn");
		order_summary.$summary_container.on("click.kqs-return-credit", ".return-btn", () => {
			open_kqs_pos_returns(window.cur_pos);
		});
	}

	function patch_past_order_summary_return() {
		if (!window.erpnext?.PointOfSale?.PastOrderSummary) return;
		const PastOrderSummary = erpnext.PointOfSale.PastOrderSummary;
		if (PastOrderSummary.prototype._kqs_return_customer_patched) return;

		const orig_bind_events = PastOrderSummary.prototype.bind_events;
		PastOrderSummary.prototype.bind_events = function () {
			orig_bind_events.call(this);
			bind_kqs_return_button(this);
		};
		PastOrderSummary.prototype._kqs_return_customer_patched = true;
	}

	function ensure_kqs_pos_instance_patches(pos) {
		if (!pos) return;
		bind_kqs_return_button(pos.order_summary);
		wrap_pos_submit_invoice(pos);
	}

	function submit_pos_invoice_without_confirm(frm) {
		/** Skip Frappe's "Permanently Submit?" dialog — Complete Order is already the confirm. */
		return new Promise((resolve, reject) => {
			try {
				frm.validate_form_action("Submit");
			} catch (e) {
				reject(e);
				return;
			}
			frappe.validated = true;
			frm.script_manager.trigger("before_submit").then(() => {
				if (!frappe.validated) {
					reject();
					return;
				}
				frm.save(
					"Submit",
					(r) => {
						if (r?.exc) {
							reject(r);
							return;
						}
						frappe.utils.play_sound("submit");
						frm.script_manager.trigger("on_submit").then(() => resolve(frm));
					},
					null,
					() => reject()
				);
			});
		});
	}

	function wrap_pos_submit_invoice(pos) {
		if (!pos?.payment) return;
		// Always rebind so a stale in-memory handler cannot keep the old overpayment block.
		pos.payment.events.submit_invoice = async () => {
			const frm = pos.frm;
			const is_return = frm?.doc?.is_return;
			const customer_label = frm?.doc?.customer_name || frm?.doc?.customer;
			if (is_return_checkout(frm)) {
				try {
					await sync_return_payments(frm);
				} catch (e) {
					console.error(e);
					frappe.msgprint({
						title: __("Return payment error"),
						indicator: "red",
						message: __("Could not prepare return payments. Please try again."),
					});
					return;
				}
			}
			if (!validate_store_credit_payments(frm)) {
				return;
			}
			const account_ok = await validate_pos_payment_completion(frm);
			if (!account_ok) {
				return;
			}
			try {
				const submitted = await submit_pos_invoice_without_confirm(frm);
				pos.toggle_components(false);
				pos.toggle_submitted_invoice_summary(true);
				if (is_return) {
					frappe.show_alert(
						{
							indicator: "green",
							message: __(
								"Credit note {0} submitted. Store credit is on account {1}.",
								[submitted.doc.name, customer_label || __("customer")]
							),
						},
						8
					);
				} else {
					frappe.show_alert({
						indicator: "green",
						message: __("POS invoice {0} created successfully", [submitted.doc.name]),
					});
				}
			} catch (e) {
				console.error(e);
			}
		};
		pos.payment._kqs_submit_wrapped_v4 = true;
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

	function lock_frm_auto_payment(frm) {
		if (!frm || frm._kqs_auto_payment_locked) return;
		frm._kqs_auto_payment_locked = true;
		frm.skip_default_payment = 1;
		try {
			Object.defineProperty(frm, "set_default_payment", {
				get() {
					return 0;
				},
				set() {},
				configurable: true,
			});
		} catch (e) {
			frm.set_default_payment = 0;
		}
	}

	function disable_auto_payment_fill(frm) {
		if (!frm) return;
		lock_frm_auto_payment(frm);
		if (!frm.cscript || frm.cscript._kqs_payment_autofill_patched) return;

		const cscript = frm.cscript;
		const orig_calc = cscript.calculate_outstanding_amount;
		if (orig_calc) {
			cscript.calculate_outstanding_amount = function (update_paid_amount) {
				return orig_calc.call(this, false);
			};
		}
		if (cscript.set_default_payment) {
			cscript.set_default_payment = function () {};
		}
		if (cscript.set_total_amount_to_default_mop) {
			cscript.set_total_amount_to_default_mop = function () {};
		}
		cscript._kqs_payment_autofill_patched = true;
	}

	function bind_manual_payment_mode_clicks(payment) {
		if (!payment?.$payment_modes?.length) return;

		const me = payment;
		// Replace ERPNext handler entirely â€” running both causes immediate deselect.
		me.$payment_modes.off("click", ".mode-of-payment");
		me.$payment_modes.off("click.kqs-manual-payment", ".mode-of-payment");
		me.$payment_modes.on("click.kqs-manual-payment", ".mode-of-payment", function (e) {
			e.stopPropagation();
			const mode_clicked = $(this);
			const mode = mode_clicked.attr("data-mode");
			if (!mode || !me[`${mode}_control`]) return;

			$(`.mode-of-payment-control`).css("display", "none");
			me.$payment_modes.find(`.pay-amount`).css("display", "inline");
			me.$payment_modes.find(`.loyalty-amount-name`).css("display", "none");
			$(".mode-of-payment").removeClass("border-primary");
			me.hide_zero_amount();

			const mode_control = me[`${mode}_control`];
			if (me.selected_mode?._label === mode_control?._label) {
				mode_clicked.removeClass("border-primary");
				me.selected_mode = "";
			} else {
				mode_clicked.addClass("border-primary");
				me.selected_mode = mode_control;
				const mode_clicked_amount = mode_clicked.find(`.${mode}-amount`).get(0);
				const frm = me.events.get_frm();
				if (mode_clicked_amount && !mode_clicked_amount.innerHTML) {
					mode_clicked_amount.innerHTML = format_currency(0, frm?.doc?.currency);
				}
				// Do not set_value(0) here â€” onchange re-renders payment modes and clears selection.
			}
			me.numpad_value = "";
			apply_payment_mode_themes($(".payment-container:visible"));
		});
	}

	function restore_selected_payment_mode(payment, selected_label) {
		if (!payment?.$payment_modes?.length || !selected_label) return;
		const mode =
			typeof payment.sanitize_mode_of_payment === "function"
				? payment.sanitize_mode_of_payment(selected_label)
				: sanitize_payment_mode_key(selected_label);
		const control = payment[`${mode}_control`];
		if (!control) return;
		payment.selected_mode = control;
		payment.$payment_modes.find(".mode-of-payment").removeClass("border-primary");
		payment.$payment_modes
			.find(`.mode-of-payment[data-mode="${mode}"]`)
			.addClass("border-primary");
	}

	function apply_payment_instance_guards(payment) {
		if (!payment) return;
		payment.set_gt_to_default_mop = false;
		bind_manual_payment_mode_clicks(payment);
	}

	function ensure_pos_manual_payment(pos) {
		if (!pos) return;
		patch_pos_payment();
		patch_pos_controller();
		ensure_kqs_pos_instance_patches(pos);
		ensure_pos_tools_menu();
		if (pos.frm) {
			lock_frm_auto_payment(pos.frm);
			disable_auto_payment_fill(pos.frm);
		}
		if (pos.payment) {
			apply_payment_instance_guards(pos.payment);
		}
	}

	function install_cur_pos_hook() {
		if (window._kqs_cur_pos_hook_installed) return;
		window._kqs_cur_pos_hook_installed = true;

		let cur_pos_value = window.cur_pos;
		Object.defineProperty(window, "cur_pos", {
			get() {
				return cur_pos_value;
			},
			set(value) {
				cur_pos_value = value;
				if (value) {
					ensure_pos_manual_payment(value);
					if (sessionStorage.getItem("kqs_open_returns") === "1") {
						sessionStorage.removeItem("kqs_open_returns");
						frappe.after_ajax(() => open_kqs_pos_returns(value));
					}
					if (sessionStorage.getItem("kqs_open_customer_account") === "1") {
						sessionStorage.removeItem("kqs_open_customer_account");
						frappe.after_ajax(() => open_kqs_customer_account(value));
					}
					if (sessionStorage.getItem("kqs_open_layby_hub") === "1") {
						sessionStorage.removeItem("kqs_open_layby_hub");
						frappe.after_ajax(() => open_kqs_layby_hub(value));
					}
				}
			},
			configurable: true,
		});

		if (cur_pos_value) {
			ensure_pos_manual_payment(cur_pos_value);
		}
	}

	async function clear_payment_amounts_for_manual_entry(frm) {
		if (!frm?.doc?.payments?.length) return;
		const zero_ops = frm.doc.payments.map(
			(row) => () => frappe.model.set_value(row.doctype, row.name, "amount", 0)
		);
		await frappe.run_serially([
			...zero_ops,
			() => frm.set_value("paid_amount", 0),
			() => frm.set_value("change_amount", 0),
		]);
	}

	function patch_payment_mode_click_no_autofill(Payment) {
		const orig_bind_events = Payment.prototype.bind_events;
		Payment.prototype.bind_events = function () {
			orig_bind_events.call(this);
			this.set_gt_to_default_mop = false;
			apply_payment_instance_guards(this);
		};

		const orig_init_component = Payment.prototype.init_component;
		if (orig_init_component) {
			Payment.prototype.init_component = function () {
				this.set_gt_to_default_mop = false;
				orig_init_component.call(this);
				apply_payment_instance_guards(this);
			};
		}
	}

	function wrap_payment_class() {
		const Orig = erpnext?.PointOfSale?.Payment;
		if (!Orig || Orig._kqs_class_wrapped) return;

		class KQSManualPayment extends Orig {
			constructor(opts = {}) {
				const settings = { ...(opts.settings || {}), set_grand_total_to_default_mop: 0 };
				super({ ...opts, settings });
				this.set_gt_to_default_mop = false;
			}
		}
		KQSManualPayment._kqs_class_wrapped = true;
		erpnext.PointOfSale.Payment = KQSManualPayment;
	}

	function is_return_checkout(frm) {
		return cint(frm?.doc?.is_return) === 1;
	}

	function get_checkout_total(frm) {
		const doc = frm.doc;
		return cint(frappe.sys_defaults.disable_rounded_total)
			? flt(doc.grand_total)
			: flt(doc.rounded_total || doc.grand_total);
	}

	async function sync_return_payments(frm) {
		if (!is_return_checkout(frm)) return;
		const total = get_checkout_total(frm);
		if (total >= 0) return;

		const payments = frm.doc.payments || [];
		if (!payments.length) return;

		const default_row = payments.find((row) => row.default) || payments[0];
		const clear_other_rows = payments
			.filter((row) => row.name !== default_row.name)
			.map((row) => () => frappe.model.set_value(row.doctype, row.name, "amount", 0));

		await frappe.run_serially([
			...clear_other_rows,
			() => frappe.model.set_value(default_row.doctype, default_row.name, "amount", total),
			() => frm.set_value("paid_amount", total),
			() => frm.set_value("change_amount", 0),
			() => frm.set_value("write_off_amount", 0),
		]);

		if (!frm.is_dirty()) return;

		let save_error = false;
		await frm.save(null, null, null, () => (save_error = true));
		if (save_error) {
			throw new Error("Could not prepare return payments");
		}
	}

	async function reset_pos_payments(frm) {
		if (is_return_checkout(frm)) {
			await sync_return_payments(frm);
			return;
		}
		// Do not call reset_mode_of_payments on POS Invoice â€” ERPNext 16.x raises
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

	function get_ar_payment_modes(frm) {
		return get_pos_payment_modes(frm).filter(
			(mode) => !is_store_credit_mode(mode) && !is_account_sale_mode(mode)
		);
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
			/* Record Layby Payment â€” compact, no-scroll layout */
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
						"Enter amounts below â€” minimum {0}",
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

	function open_kqs_layby_hub(pos, opts) {
		const target = pos || window.cur_pos;
		if (!target) {
			frappe.msgprint(__("Point of Sale is still loading. Try again in a moment."));
			return;
		}
		if (typeof kqs_retail?.pos_layby_hub?.open !== "function") {
			frappe.msgprint({
				title: __("Layby hub not loaded"),
				indicator: "orange",
				message: __("Reload the page once (F5). Your browser cached an older POS script."),
			});
			return;
		}
		try {
			kqs_retail.pos_layby_hub.open(target, opts || {});
		} catch (e) {
			console.error("KQS Layby hub open failed", e);
			frappe.msgprint({
				title: __("Layby error"),
				indicator: "red",
				message: __("Could not open Layby Lookup. Check the browser console (F12)."),
			});
		}
	}

	function show_layby_lookup_dialog(frm, opts) {
		open_kqs_layby_hub(window.cur_pos, opts);
	}

	function show_account_lookup_dialog(frm, opts) {
		opts = opts || {};
		const filterCustomer = opts.customer || "";
		const company = frm.doc.company;
		const d = new frappe.ui.Dialog({
			title: __("Account Lookup & Pay"),
			size: "large",
			fields: [
				{
					fieldname: "query",
					fieldtype: "Data",
					label: __("Search"),
					description: __("Customer name or phone"),
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
					`<p class="text-muted">${__("No customers with outstanding account balances found.")}</p>`
				);
				return;
			}
			const currency = frm.doc.currency || frappe.defaults.get_default("currency");
			const html = rows
				.map((row) => {
					const owes = format_currency(row.ar_outstanding, currency);
					const phone = row.mobile_no
						? `<br><span class="text-muted">${frappe.utils.escape_html(row.mobile_no)}</span>`
						: "";
					return `<div class="kqs-layby-row flex justify-between align-center mb-2 p-2 border rounded">
						<div>
							<strong>${frappe.utils.escape_html(row.customer_name || row.customer)}</strong>
							${phone}
							<br><span class="text-muted">${__("Owes")}: ${owes}</span>
						</div>
						<button class="btn btn-primary btn-sm kqs-ar-pay" data-customer="${frappe.utils.escape_html(
							row.customer
						)}" data-balance="${row.ar_outstanding}">
							${__("Pay")}
						</button>
					</div>`;
				})
				.join("");
			d.fields_dict.results_html.$wrapper.html(html);
			d.fields_dict.results_html.$wrapper.find(".kqs-ar-pay").on("click", function () {
				const customer = $(this).data("customer");
				const balance = $(this).data("balance");
				frappe.call({
					method: "kqs_retail.api.customer_account.get_customer_ar_details_api",
					args: { customer, company },
					callback(r) {
						if (!r.exc && r.message) {
							show_account_payment_dialog(frm, r.message, () => search());
						}
					},
				});
			});
		}

		function search() {
			frappe.call({
				method: "kqs_retail.api.customer_account.search_customers_with_ar",
				args: {
					query: d.get_value("query") || "",
					company,
					limit: 30,
				},
				callback(r) {
					if (!r.exc) render_results(r.message);
				},
			});
		}

		d.fields_dict.query.$input.on("keyup", frappe.utils.debounce(search, 300));
		d.show();
		if (filterCustomer) {
			d.set_value("query", filterCustomer);
		} else if (
			frm.doc.customer &&
			!is_walk_in_customer(frm) &&
			flt(kqs_customer_account.ar_outstanding) > 0
		) {
			d.set_value("query", frm.doc.customer_name || frm.doc.customer);
		}
		search();
	}

	function show_account_payment_dialog(frm, details, on_success) {
		inject_layby_dialog_styles();

		const customer = details.customer;
		const customer_name = details.customer_name || customer;
		const currency = frm.doc.currency || frappe.defaults.get_default("currency");
		const balance_due = flt(details.ar_outstanding);
		const payment_modes = get_ar_payment_modes(frm);
		if (!payment_modes.length) {
			frappe.msgprint(__("No cash or mobile payment modes are configured on this POS profile."));
			return;
		}

		const amounts = Object.fromEntries(payment_modes.map((mode) => [mode, 0]));
		const tendered = Object.fromEntries(payment_modes.map((mode) => [mode, 0]));
		let paying_control = null;
		let tendered_control = null;
		let selected_mode = null;
		let numpad_target = "paying";
		let numpad_value = "";

		const pay_d = new frappe.ui.Dialog({
			title: __("Record Account Payment"),
			fields: [{ fieldname: "ar_ui", fieldtype: "HTML" }],
			primary_action_label: __("Record Payment"),
			primary_action() {
				sync_controls_to_state();
				const payment_total = total_payment();
				if (payment_total <= 0) {
					frappe.msgprint(__("Enter how much is being paid toward the account balance."));
					return;
				}
				if (payment_total > balance_due) {
					frappe.msgprint(
						__("Payment ({0}) exceeds amount owed ({1}).", [
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
					method: "kqs_retail.api.customer_account.record_ar_payment",
					args: {
						customer,
						company: frm.doc.company,
						payments: JSON.stringify(payment_lines),
					},
					freeze: true,
					callback(r) {
						if (!r.exc) {
							const change = cash_change();
							let message = __("Account payment recorded for {0}.", [customer_name]);
							if (change > 0) {
								message = __("Account payment recorded for {0}. Change: {1}", [
									customer_name,
									format_currency(change, currency),
								]);
							}
							frappe.show_alert({ message, indicator: "green" });
							pay_d.hide();
							after_ar_payment_recorded(frm, r.message, {
								change,
								currency,
								customer_name,
							});
							if (on_success) on_success();
						}
					},
				});
			},
		});

		pay_d.$wrapper.addClass("kqs-layby-dialog kqs-layby-pay-dialog");

		const customer_label = frappe.utils.escape_html(customer_name);
		const $ui = pay_d.fields_dict.ar_ui.$wrapper;
		$ui.html(`
			<div class="kqs-layby-dialog-grid">
				<div class="kqs-layby-customer-card">
					<div class="label">${__("Customer")}</div>
					<div class="value">${customer_label}</div>
				</div>
				<div class="kqs-layby-summary">
					<div class="kqs-layby-summary-card">
						<div class="label">${__("Amount Owed")}</div>
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
			if (paying_control) amounts[selected_mode] = flt(paying_control.get_value());
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
			$ui.find(".kqs-layby-change-card").toggleClass("is-visible", !!selected_mode && is_physical_cash_mode(selected_mode));
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
			$ui.find(".kqs-layby-entry-placeholder").toggle(!selected_mode);
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
			if (is_physical_cash_mode(mode)) tendered_control?.set_value(tendered[mode] || "");
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
				frappe.show_alert({ message: __("Select a payment method first."), indicator: "yellow" });
				return;
			}
			const control = get_active_control();
			if (!control) {
				frappe.show_alert({ message: __("Select a payment method first."), indicator: "yellow" });
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
			if (numpad_target === "tendered" && is_physical_cash_mode(selected_mode)) {
				tendered[selected_mode] = flt(numpad_value);
			} else {
				amounts[selected_mode] = flt(numpad_value);
			}
			refresh_payment_ui();
			frappe.utils.play_sound("numpad-touch");
		}

		paying_control = frappe.ui.form.make_control({
			df: {
				label: __("Paying"),
				fieldtype: "Currency",
				placeholder: __("Amount toward balance"),
				onchange() {
					if (!selected_mode) return;
					amounts[selected_mode] = flt(this.value);
					if (numpad_target === "paying") numpad_value = this.value ? String(this.value) : "";
					refresh_payment_ui();
				},
			},
			parent: $entry_paying,
			render_input: true,
		});
		paying_control.toggle_label(true);
		paying_control.$input.on("focus", () => focus_numpad_target("paying"));
		paying_control.$input.on("input", function () {
			if (!selected_mode) return;
			amounts[selected_mode] = flt($(this).val());
			if (numpad_target === "paying") numpad_value = $(this).val() ? String($(this).val()) : "";
			refresh_payment_ui();
		});

		tendered_control = frappe.ui.form.make_control({
			df: {
				label: __("Customer Gave"),
				fieldtype: "Currency",
				placeholder: __("Cash received"),
				onchange() {
					if (!selected_mode || !is_physical_cash_mode(selected_mode)) return;
					tendered[selected_mode] = flt(this.value);
					if (numpad_target === "tendered") numpad_value = this.value ? String(this.value) : "";
					refresh_payment_ui();
				},
			},
			parent: $entry_tendered,
			render_input: true,
		});
		tendered_control.toggle_label(true);
		tendered_control.$input.on("focus", () => focus_numpad_target("tendered"));
		tendered_control.$input.on("input", function () {
			if (!selected_mode || !is_physical_cash_mode(selected_mode)) return;
			tendered[selected_mode] = flt($(this).val());
			if (numpad_target === "tendered") numpad_value = $(this).val() ? String($(this).val()) : "";
			refresh_payment_ui();
		});

		$ui.find(".kqs-layby-mop-tile").on("click", function () {
			const key = $(this).attr("data-mode-key");
			const mode = get_mode_from_key(key);
			if (mode) select_payment_mode(mode);
		});

		if (window.erpnext?.PointOfSale?.NumberPad) {
			new erpnext.PointOfSale.NumberPad({
				wrapper: $ui.find(".kqs-layby-numpad"),
				events: { numpad_event($btn) { on_numpad_clicked($btn); } },
				cols: 3,
				keys: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [".", 0, "Delete"]],
			});
		}

		refresh_entry_panel();
		pay_d.show();
		refresh_payment_ui();
	}

	function after_ar_payment_recorded(frm, result, extras = {}) {
		if (!result?.customer) return;
		if (frm?.doc?.customer === result.customer) {
			fetch_customer_account_summary(frm).then(() => {
				const payment = window.cur_pos?.payment;
				if (payment) update_customer_account_banner(payment);
			});
		}
		show_ar_payment_success_dialog(result, extras);
	}

	kqs_retail.point_of_sale = kqs_retail.point_of_sale || {};
	kqs_retail.point_of_sale.after_ar_payment = after_ar_payment_recorded;
	kqs_retail.point_of_sale.after_layby_payment_recorded = after_layby_payment_recorded;
	kqs_retail.point_of_sale.open_layby_hub = open_kqs_layby_hub;
	kqs_retail.point_of_sale.open_customer_account = open_kqs_customer_account;
	kqs_retail.point_of_sale.open_returns = open_kqs_pos_returns;
	kqs_retail.point_of_sale.open_tools_menu = open_kqs_tools_menu;

	function inject_cart_layby_styles() {
		if (document.getElementById("kqs-pos-cart-layby-styles")) return;
		const style = document.createElement("style");
		style.id = "kqs-pos-cart-layby-styles";
		style.textContent = `
			/* Wrapper replaces direct-child slot â€” restore ERPNext primary-action row */
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

	function inject_return_mode_styles() {
		if (document.getElementById("kqs-pos-return-mode-styles")) return;
		const style = document.createElement("style");
		style.id = "kqs-pos-return-mode-styles";
		style.textContent = `
			.point-of-sale-app .kqs-return-banner {
				margin: 0.5rem 0.75rem 0;
				padding: 0.65rem 0.85rem;
				border-radius: 8px;
				background: #eff6ff;
				border: 1px solid #93c5fd;
				color: #1e3a8a;
				font-size: 12px;
				line-height: 1.45;
			}
			.point-of-sale-app .kqs-return-banner strong {
				display: block;
				font-size: 13px;
				margin-bottom: 0.15rem;
			}
		`;
		document.head.appendChild(style);
	}

	function update_return_mode_banner(cart) {
		if (!cart?.$component) return;
		inject_return_mode_styles();
		cart.$component.find(".kqs-return-banner").remove();
		const frm = cart.events?.get_frm?.();
		if (!frm?.doc?.is_return) return;
		const customer = frappe.utils.escape_html(frm.doc.customer_name || frm.doc.customer || "");
		cart.$component.prepend(
			`<div class="kqs-return-banner">
				<strong>${__("Return in progress")}</strong>
				${__(
					"No cash refund at the till â€” tap <strong>Checkout</strong>, then <strong>Complete Order</strong>. Do not enter payment amounts. Credit goes to {0}.",
					[customer || __("the selected customer")]
				)}
			</div>`
		);
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
			// highlight_checkout_btn styles every .checkout-btn â€” keep totals checkout on primary-action sizing
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

		const orig_make_customer_selector = ItemCart.prototype.make_customer_selector;
		ItemCart.prototype.make_customer_selector = function () {
			orig_make_customer_selector.call(this);
			pin_add_customer_control(this);
		};

		const orig_reset_customer_selector = ItemCart.prototype.reset_customer_selector;
		ItemCart.prototype.reset_customer_selector = function () {
			orig_reset_customer_selector.call(this);
			pin_add_customer_control(this);
		};

		const orig_load_invoice = ItemCart.prototype.load_invoice;
		ItemCart.prototype.load_invoice = function () {
			orig_load_invoice.call(this);
			update_return_mode_banner(this);
			ensure_default_walk_in_customer(this);
		};

		const orig_update_customer_section = ItemCart.prototype.update_customer_section;
		ItemCart.prototype.update_customer_section = function () {
			orig_update_customer_section.call(this);
			update_customer_account_banner(window.cur_pos?.payment);
		};

		ItemCart.prototype._kqs_cart_patched = true;
		inject_pos_customer_picker_styles();

		const pos = window.cur_pos;
		if (pos?.cart) {
			ensure_cart_layby_button(pos.cart);
			pin_add_customer_control(pos.cart);
			ensure_default_walk_in_customer(pos.cart);
		}
	}

	function resolve_default_walk_in_customer() {
		const from_settings = window.cur_pos?.settings?.customer;
		if (from_settings) return from_settings;
		return "Walk-in Customer";
	}

	function ensure_default_walk_in_customer(cart) {
		if (!cart?.events?.get_frm) return;
		const frm = cart.events.get_frm();
		if (!frm?.doc || frm.doc.is_return) return;
		if (frm.doc.customer) return;

		const customer = resolve_default_walk_in_customer();
		if (!customer) return;

		frappe.db.exists("Customer", customer).then((exists) => {
			if (!exists || frm.doc.customer) return;
			frappe.model.set_value(frm.doc.doctype, frm.doc.name, "customer", customer).then(() => {
				if (typeof cart.fetch_customer_details === "function") {
					cart.fetch_customer_details(customer).then(() => {
						cart.events.customer_details_updated?.(cart.customer_info);
						cart.update_customer_section?.();
						cart.update_totals_section?.();
					});
				}
			});
		});
	}

	function pin_add_customer_control(cart) {
		if (!cart?.$customer_section?.length || !cart.customer_field) return;
		if (cart.$customer_section.find(".kqs-add-customer-btn").length) return;
		// Only while the search field is visible (no selected customer card yet).
		if (!cart.$customer_section.find(".customer-field").length) return;

		const $btn = $(`
			<button type="button" class="btn btn-default btn-sm kqs-add-customer-btn">
				${__("Add Customer")}
			</button>
		`);
		$btn.on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			cart.customer_field.new_doc();
		});
		cart.$customer_section.append($btn);
	}

	function inject_pos_customer_picker_styles() {
		if (document.getElementById("kqs-pos-customer-picker-styles")) return;
		const style = document.createElement("style");
		style.id = "kqs-pos-customer-picker-styles";
		style.textContent = `
			.point-of-sale-app .customer-section {
				display: flex;
				flex-direction: column;
				gap: 0.45rem;
			}
			.point-of-sale-app .customer-section .kqs-add-customer-btn {
				align-self: stretch;
				flex-shrink: 0;
				font-weight: 600;
				border: 1px solid var(--border-color, #d1d5db);
				background: var(--fg-color, #fff);
			}
			.point-of-sale-app .customer-section .customer-field {
				min-width: 0;
			}
			/* Keep Frappe "Create a new Customer" visible at the bottom of long lists */
			.point-of-sale-app .customer-section .awesomplete > ul {
				max-height: min(42vh, 280px);
				overflow-y: auto;
				padding-bottom: 2.6rem;
				position: relative;
			}
			.point-of-sale-app .customer-section .awesomplete > ul > li:last-child {
				position: sticky;
				bottom: 0;
				z-index: 2;
				background: var(--fg-color, #fff);
				border-top: 1px solid var(--border-color, #e5e7eb);
				box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.04);
			}
		`;
		document.head.appendChild(style);
	}

	function inject_pos_payment_styles() {
		if (document.getElementById("kqs-pos-payment-styles-v5")) return;
		document.getElementById("kqs-pos-payment-styles-v4")?.remove();
		document.getElementById("kqs-pos-payment-styles-v3")?.remove();
		document.getElementById("kqs-pos-payment-styles-v2")?.remove();
		document.getElementById("kqs-pos-payment-styles")?.remove();
		const style = document.createElement("style");
		style.id = "kqs-pos-payment-styles-v5";
		style.textContent = `
			.point-of-sale-app .payment-container {
				overflow: hidden;
			}
			.point-of-sale-app .payment-container .section-label {
				margin-bottom: 0.4rem;
			}
			.point-of-sale-app .payment-container .payment-split-container {
				flex: 1 1 auto;
				min-height: 0;
				align-items: stretch;
			}
			.point-of-sale-app .payment-container .payment-container-left {
				display: flex;
				flex-direction: column;
				min-height: 0;
				margin-bottom: 0.35rem !important;
			}
			.point-of-sale-app .payment-container .payment-modes {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 0.5rem;
				margin-bottom: 0.25rem;
				min-height: 0 !important;
				height: auto !important;
				max-height: none !important;
				overflow: visible !important;
				padding-right: 0.35rem;
				margin-right: 0.35rem;
			}
			.point-of-sale-app .payment-container .payment-mode-wrapper {
				width: 100%;
				margin: 0 !important;
				padding: 0 !important;
			}
			.point-of-sale-app .payment-container .mode-of-payment {
				width: 100%;
				min-height: 3.65rem;
				display: flex;
				flex-direction: row;
				align-items: center;
				justify-content: space-between;
				gap: 0.5rem;
				padding: 0.85rem 1.05rem;
				border-radius: var(--border-radius-md, 8px);
				border: 2px solid var(--border-color, #d1d5db);
				background: var(--card-bg, #fff);
				font-size: 13px;
				font-weight: 600;
				line-height: 1.3;
				text-align: left;
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
			.point-of-sale-app .payment-container .mode-of-payment[class*="kqs-mop-"].border-primary {
				box-shadow: none;
			}
			.point-of-sale-app .payment-container .mode-of-payment [class$="-amount"],
			.point-of-sale-app .payment-container .mode-of-payment .pay-amount {
				display: block;
				flex-shrink: 0;
				margin: 0 0 0 auto;
				text-align: right;
				font-size: 1.2rem;
				font-weight: 800;
				line-height: 1.15;
				letter-spacing: -0.02em;
				font-variant-numeric: tabular-nums;
				color: var(--text-color, #0a0a0a);
			}
			.point-of-sale-app .payment-container .mode-of-payment.border-primary [class$="-amount"],
			.point-of-sale-app .payment-container .mode-of-payment.border-primary .pay-amount {
				font-size: 1.3rem;
				color: var(--primary, #171717);
			}
			.point-of-sale-app .payment-container .mode-of-payment .loyalty-amount-name {
				display: none;
			}
			.point-of-sale-app .payment-container .mode-of-payment .kqs-mop-label {
				flex: 1 1 auto;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.point-of-sale-app .payment-container .mode-of-payment-control {
				display: none !important;
			}
			.point-of-sale-app .payment-container .kqs-payment-hint {
				margin: 0 0 0.4rem;
				font-size: 11px;
				color: var(--text-muted, #6b7280);
				line-height: 1.3;
			}
			.point-of-sale-app .payment-container .totals-section {
				margin-top: auto;
				margin-bottom: 0.4rem;
			}
			.point-of-sale-app .payment-container .totals-section > .totals {
				padding: 0.55rem 0.65rem;
			}
			.point-of-sale-app .payment-container .totals-section > .totals .value {
				font-size: 1.35rem;
			}
			.point-of-sale-app .payment-container .submit-order-btn {
				margin-top: 0;
			}
			@media screen and (max-height: 820px) {
				.point-of-sale-app .payment-container .mode-of-payment {
					min-height: 3.35rem;
					padding: 0.7rem 0.95rem;
					font-size: 12px;
				}
				.point-of-sale-app .payment-container .mode-of-payment [class$="-amount"],
				.point-of-sale-app .payment-container .mode-of-payment .pay-amount {
					font-size: 1.1rem;
				}
				.point-of-sale-app .payment-container .mode-of-payment.border-primary [class$="-amount"],
				.point-of-sale-app .payment-container .mode-of-payment.border-primary .pay-amount {
					font-size: 1.2rem;
				}
				.point-of-sale-app .payment-container .payment-modes {
					gap: 0.4rem;
				}
				.point-of-sale-app .payment-container .kqs-payment-hint {
					margin-bottom: 0.3rem;
					font-size: 10px;
				}
				.point-of-sale-app .payment-container .totals-section > .totals {
					padding: 0.45rem 0.55rem;
				}
				.point-of-sale-app .payment-container .totals-section > .totals .value {
					font-size: 1.2rem;
				}
			}
		`;
		document.head.appendChild(style);
	}

	function normalize_payment_mode_rows($container) {
		$container.find(".mode-of-payment").each(function () {
			const $mode = $(this);
			if ($mode.find(".kqs-mop-label").length) return;

			const $amount = $mode.children("[class$='-amount'], .pay-amount").first();
			if (!$amount.length) return;

			let labelText = "";
			$mode.contents().each(function () {
				if (this.nodeType === 3) {
					const text = $.trim(this.nodeValue);
					if (text) labelText = labelText ? `${labelText} ${text}` : text;
				}
			});
			$mode.contents().filter(function () {
				return this.nodeType === 3;
			}).remove();

			if (labelText) {
				$amount.before(
					`<span class="kqs-mop-label">${frappe.utils.escape_html(labelText)}</span>`
				);
			}
		});
	}

	const MOP_THEME_CLASSES =
		"kqs-mop-loyalty kqs-mop-ecocash kqs-mop-mpesa kqs-mop-cash kqs-mop-card kqs-mop-account";

	const KQS_MOP_PALETTES = {
		loyalty: { base: "#f3f4f6", active: "#e5e7eb", text: "#374151" },
		ecocash: { base: "#2563eb", active: "#1d4ed8", text: "#ffffff" },
		mpesa: { base: "#dc2626", active: "#b91c1c", text: "#ffffff" },
		cash: { base: "#000000", active: "#1a1a1a", text: "#ffffff" },
		card: { base: "#007c7f", active: "#006668", text: "#ffffff" },
		account: {
			base: "#ffffff",
			active: "#ecfdf5",
			text: "#111827",
			border: "#16a34a",
			borderActive: "#15803d",
		},
	};

	function payment_mode_theme_key(modeKey, label) {
		const key = String(modeKey || "").toLowerCase();
		const text = String(label || "").toLowerCase();
		const combined = `${key} ${text}`;

		if (key === "loyalty-amount" || /redeem|loyalty/.test(combined)) {
			return "loyalty";
		}
		if (/eco[-_]?cash|ecocash/.test(combined)) {
			return "ecocash";
		}
		if (/m[-_]?pesa|mpesa/.test(combined)) {
			return "mpesa";
		}
		if (key === "cash" || /^cash$/i.test(text.trim())) {
			return "cash";
		}
		if (key === "bank" || key === "card" || /\bcard\b|bank/.test(combined)) {
			return "card";
		}
		if (
			/on[-_ ]?account/.test(combined) ||
			(/^account$/i.test(text.trim()) && !/balance|store credit/.test(combined))
		) {
			return "account";
		}
		return "";
	}

	function clear_payment_mode_theme_style($mode) {
		$mode.removeClass(MOP_THEME_CLASSES).css({
			backgroundColor: "",
			borderColor: "",
			color: "",
			boxShadow: "",
		});
		$mode.removeAttr("data-kqs-mop-state");
		$mode.find(".kqs-mop-label, [class$='-amount'], .pay-amount").css("color", "");
	}

	function apply_payment_mode_themes($container) {
		const $root = $container?.length ? $container : $(".payment-container:visible");
		if (!$root.length) return;

		$root.find(".mode-of-payment").each(function () {
			const $mode = $(this);
			const modeKey = $mode.attr("data-mode") || "";
			const label = (
				$mode.find(".kqs-mop-label").text() ||
				$mode
					.clone()
					.children()
					.remove()
					.end()
					.text() ||
				""
			).trim();
			const themeKey = payment_mode_theme_key(modeKey, label);
			if (!themeKey) {
				clear_payment_mode_theme_style($mode);
				$mode.removeAttr("data-kqs-mop-state");
				return;
			}

			const selected = $mode.hasClass("border-primary");
			const stateKey = `${themeKey}|${selected ? "1" : "0"}`;
			if ($mode.attr("data-kqs-mop-state") === stateKey) {
				return;
			}
			$mode.attr("data-kqs-mop-state", stateKey);

			const palette = KQS_MOP_PALETTES[themeKey];
			const bg = selected ? palette.active : palette.base;
			const border = selected
				? palette.borderActive || palette.border || bg
				: palette.border || bg;

			$mode.removeClass(MOP_THEME_CLASSES).addClass(`kqs-mop-${themeKey}`);
			$mode.css({
				backgroundColor: bg,
				borderColor: border,
				color: palette.text,
				boxShadow: "none",
			});
			$mode.find(".kqs-mop-label, [class$='-amount'], .pay-amount").css("color", palette.text);
		});
	}

	function sync_payment_mode_amount_labels(payment) {
		if (!payment?.$payment_modes?.length) return;
		const frm = payment.events?.get_frm?.();
		const doc = frm?.doc;
		if (!doc?.payments?.length) return;

		const currency = doc.currency;
		const selected_label = payment.selected_mode?.df?.label || payment.selected_mode?._label;

		doc.payments.forEach((p) => {
			const mode = payment.sanitize_mode_of_payment(p.mode_of_payment);
			const show_amount =
				p.mode_of_payment === selected_label || flt(p.amount) !== 0;
			const formatted = show_amount ? format_currency(p.amount, currency) : "";
			const $amount = payment.$payment_modes.find(`.${mode}-amount`);
			if ($amount.length && $amount.html() !== formatted) {
				$amount.html(formatted);
			}
		});
	}

	function update_account_sale_hint(payment, frm) {
		const $container = $(".payment-container:visible");
		if (!$container.length) return;

		const $hint = $container.find(".kqs-account-sale-hint");
		if (!frm || is_return_checkout(frm) || is_walk_in_customer(frm)) {
			$hint.remove();
			return;
		}

		const account_paid = get_account_payment_total(frm);
		if (account_paid > 0.01 && kqs_customer_account.allow_account_sales) {
			const html = frappe.utils.escape_html(
				__("On account: {0} will be added to amount owed.", [
					format_currency(account_paid, frm.doc.currency),
				])
			);
			if ($hint.length) {
				if ($hint.html() !== html) {
					$hint.html(html);
				}
			} else {
				$container.prepend(`<div class="kqs-account-sale-hint">${html}</div>`);
			}
			return;
		}
		$hint.remove();
	}

	function enhance_payment_method_panel() {
		const $container = $(".payment-container:visible");
		if (!$container.length) return;

		inject_pos_payment_styles();
		normalize_payment_mode_rows($container);
		apply_payment_mode_themes($container);

		const $modes = $container.find(".payment-modes").first();
		if ($modes.length && !$container.find(".kqs-payment-hint").length) {
			$(
				`<p class="kqs-payment-hint">${__(
					"Tap a payment method, enter the amount on the keypad, then tap another method for split payments."
				)}</p>`
			).insertBefore($modes);
		}
	}

	function ensure_pos_tools_menu() {
		const pos = window.cur_pos;
		if (!pos || !pos.page) return;
		if (typeof kqs_retail?.pos_tools_menu?.ensure_header_button === "function") {
			kqs_retail.pos_tools_menu.ensure_header_button(pos);
		}
	}

	function open_kqs_tools_menu(pos) {
		const target = pos || window.cur_pos;
		if (!target) {
			frappe.msgprint(__("Point of Sale is still loading. Try again in a moment."));
			return;
		}
		if (typeof kqs_retail?.pos_tools_menu?.open !== "function") {
			frappe.msgprint({
				title: __("POS menu not loaded"),
				indicator: "orange",
				message: __("Reload the page once (F5). Your browser cached an older POS script."),
			});
			return;
		}
		kqs_retail.pos_tools_menu.open(target);
	}

	function patch_pos_payment() {
		if (!window.erpnext?.PointOfSale?.Payment) return;
		wrap_payment_class();
		const Payment = erpnext.PointOfSale.Payment;
		if (Payment.prototype._kqs_payment_patched) return;

		// Cashier must enter tendered amounts â€” never auto-fill payment rows at checkout.
		Payment.prototype.auto_set_remaining_amount = function () {};
		Payment.prototype.focus_on_default_mop = function () {};
		patch_payment_mode_click_no_autofill(Payment);

		const orig_edit_cart = Payment.prototype.edit_cart;
		Payment.prototype.edit_cart = function () {
			orig_edit_cart.call(this);
			update_customer_account_banner(this);
		};

		// ERPNext re-renders all payment tiles on every paid_amount change (each numpad digit).
		Payment.prototype.bind_paid_amount_event = function (frm) {
			this.update_totals_section(frm.doc);
			sync_payment_mode_amount_labels(this);
			update_account_sale_hint(this, frm);
		};

		const orig_checkout = Payment.prototype.checkout;
		Payment.prototype.checkout = function () {
			this.set_gt_to_default_mop = false;
			const frm = this.events.get_frm();
			const payment = this;
			if (frm && !validate_store_credit_payments(frm)) {
				return;
			}
			const run_checkout = () => {
				if (frm) {
					lock_frm_auto_payment(frm);
					disable_auto_payment_fill(frm);
				}
				orig_checkout.call(payment);
				apply_payment_instance_guards(payment);
				if (frm) {
					lock_frm_auto_payment(frm);
				}
				if (frm && is_return_checkout(frm)) {
					sync_return_payments(frm)
						.then(() => {
							payment.render_payment_mode_dom();
							payment.after_render?.();
						})
						.catch((e) => {
							console.error(e);
							frappe.msgprint({
								title: __("Return payment error"),
								indicator: "red",
								message: __(
									"Could not prepare return payments. Do not enter positive payment amounts on a return."
								),
							});
						});
				}
			};
			run_checkout();
		};

		const orig_render_payment_mode_dom = Payment.prototype.render_payment_mode_dom;
		Payment.prototype.render_payment_mode_dom = function () {
			this.set_gt_to_default_mop = false;
			const frm = this.events.get_frm();
			const selected_label = this.selected_mode?.df?.label || this.selected_mode?._label;
			orig_render_payment_mode_dom.call(this);
			restore_selected_payment_mode(this, selected_label);
			apply_payment_instance_guards(this);
			enhance_payment_method_panel();
			if (frm) {
				fetch_customer_account_summary(frm).then(() => update_customer_account_banner(this));
			} else {
				update_customer_account_banner(this);
			}
		};

		Payment.prototype._kqs_payment_patched = true;
	}

	function prepare_closing_and_route(pos_opening_entry) {
		if (!pos_opening_entry) {
			frappe.msgprint(__("No open POS session found."));
			return;
		}
		frappe.call({
			method: "kqs_retail.api.pos_closing.prepare_closing_entry",
			args: { pos_opening_entry },
			freeze: true,
			freeze_message: __("Preparing POS closing..."),
			callback(r) {
				if (r.exc || !r.message?.name) {
					return;
				}
				frappe.set_route("Form", "POS Closing Entry", r.message.name);
			},
		});
	}

	function show_till_blocked_dialog(data) {
		const opening = data.opening || {};
		const who = opening.user || __("another user");
		const profile = opening.pos_profile || __("this till");
		const fields = [
			{
				fieldtype: "HTML",
				options: `<p>${__(
					"{0} is already open by {1}. Close that session before opening a new one.",
					[frappe.utils.escape_html(profile), frappe.utils.escape_html(who)]
				)}</p>`,
			},
		];
		const d = new frappe.ui.Dialog({
			title: __("Till already open"),
			fields,
			primary_action_label: data.can_close ? __("Close that session") : __("OK"),
			primary_action() {
				d.hide();
				if (data.can_close && opening.name) {
					prepare_closing_and_route(opening.name);
				}
			},
		});
		if (data.can_close) {
			d.set_secondary_action_label(__("Cancel"));
			d.set_secondary_action(() => d.hide());
		}
		d.show();
	}

	function patch_pos_opening_session_flow() {
		if (!window.erpnext?.PointOfSale?.Controller) return;
		const Controller = erpnext.PointOfSale.Controller;
		if (Controller.prototype._kqs_opening_flow_patched) return;

		Controller.prototype.check_opening_entry = function () {
			const me = this;
			frappe
				.call({
					method: "kqs_retail.api.pos.resolve_pos_opening_entry",
					args: { user: frappe.session.user },
				})
				.then((r) => {
					const data = r.message || {};
					if (data.action === "resume" && data.opening) {
						me.prepare_app_defaults(data.opening);
						return;
					}
					if (data.action === "close" && data.opening?.name) {
						frappe.show_alert(
							{
								message: __("Till was opened on a previous day — closing now."),
								indicator: "orange",
							},
							6
						);
						prepare_closing_and_route(data.opening.name);
						return;
					}
					if (data.action === "blocked" && data.opening) {
						show_till_blocked_dialog(data);
						return;
					}
					if (data.default_pos_profile) {
						me._kqs_default_pos_profile = data.default_pos_profile;
					}
					if (data.other_open_profiles?.length) {
						const names = data.other_open_profiles
							.map((row) => `${row.pos_profile} (${row.user})`)
							.join(", ");
						frappe.show_alert(
							{
								message: __("Other tills already open: {0}", [names]),
								indicator: "orange",
							},
							8
						);
					}
					me.create_opening_voucher();
					if (me._kqs_default_pos_profile) {
						frappe.after_ajax(() => {
							const dlg = cur_dialog;
							if (dlg?.fields_dict?.pos_profile) {
								dlg.set_value("pos_profile", me._kqs_default_pos_profile);
							}
						});
					}
				})
				.catch(() => {
					me.fetch_opening_entry().then((r) => {
						if (r.message?.length) {
							me.prepare_app_defaults(r.message[0]);
						} else {
							me.create_opening_voucher();
						}
					});
				});
		};

		Controller.prototype.check_outdated_pos_opening_entry = function () {
			if (
				!this.pos_opening_time ||
				!frappe.datetime.get_day_diff(
					frappe.datetime.get_today(),
					String(this.pos_opening_time).slice(0, 10)
				)
			) {
				return;
			}
			frappe.show_alert(
				{
					message: __("Till was opened on a previous day — closing now."),
					indicator: "orange",
				},
				6
			);
			prepare_closing_and_route(this.pos_opening);
		};

		Controller.prototype._kqs_opening_flow_patched = true;
	}

	function wrap_point_of_sale_page_load() {
		const page = frappe.pages?.["point-of-sale"];
		if (!page?.on_page_load || page._kqs_opening_page_wrapped) {
			return Boolean(page?._kqs_opening_page_wrapped);
		}
		page._kqs_opening_page_wrapped = true;
		const orig = page.on_page_load;
		page.on_page_load = function (wrapper) {
			// Register patches before ERPNext's require callback creates Controller.
			frappe.require("point-of-sale.bundle.js", () => {
				patch_pos_opening_session_flow();
				apply_all_kqs_pos_patches();
			});
			return orig.call(this, wrapper);
		};
		const orig_refresh = page.refresh;
		if (orig_refresh && !page._kqs_opening_refresh_wrapped) {
			page._kqs_opening_refresh_wrapped = true;
			page.refresh = function (wrapper) {
				patch_pos_opening_session_flow();
				return orig_refresh.call(this, wrapper);
			};
		}
		return true;
	}

	function patch_outdated_opening_prompt() {
		patch_pos_opening_session_flow();
		wrap_point_of_sale_page_load();
	}

	function patch_pos_controller() {
		if (!window.erpnext?.PointOfSale?.Controller) return;
		const Controller = erpnext.PointOfSale.Controller;
		if (Controller.prototype._kqs_checkout_patched) return;

		const orig_prepare_menu = Controller.prototype.prepare_menu;
		Controller.prototype.prepare_menu = function () {
			orig_prepare_menu.call(this);
			ensure_pos_tools_menu();
		};

		Controller.prototype.save_and_checkout = async function () {
			if (!this.frm?.doc) return;
			lock_frm_auto_payment(this.frm);
			disable_auto_payment_fill(this.frm);

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

		const orig_init_order_summary = Controller.prototype.init_order_summary;
		Controller.prototype.init_order_summary = function () {
			orig_init_order_summary.call(this);
			bind_kqs_return_button(this.order_summary);
		};

		const orig_make_return_invoice = Controller.prototype.make_return_invoice;
		Controller.prototype.make_return_invoice = async function (doc) {
			const result = await orig_make_return_invoice.call(this, doc);
			frappe.show_alert(
				{
					indicator: "blue",
					message: __(
						"Return loaded. Adjust quantities if needed, tap Checkout, then Complete Order. Do not enter payment amounts."
					),
				},
				8
			);
			update_return_mode_banner(this.cart);
			return result;
		};

		const orig_init_payments = Controller.prototype.init_payments;
		Controller.prototype.init_payments = function () {
			orig_init_payments.call(this);
			wrap_pos_submit_invoice(this);
		};

		Controller.prototype.close_pos = function () {
			// Allow close from outdated-opening dialog even if the cart UI is not visible.
			const pos_opening = this.pos_opening;
			if (!pos_opening) {
				frappe.msgprint(__("No open POS session found."));
				return;
			}
			frappe.call({
				method: "kqs_retail.api.pos_closing.prepare_closing_entry",
				args: { pos_opening_entry: pos_opening },
				freeze: true,
				freeze_message: __("Preparing POS closing..."),
				callback(r) {
					if (r.exc) return;
					frappe.set_route("Form", "POS Closing Entry", r.message.name);
				},
			});
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
			onload(frm) {
				lock_frm_auto_payment(frm);
				disable_auto_payment_fill(frm);
			},
			refresh(frm) {
				lock_frm_auto_payment(frm);
				disable_auto_payment_fill(frm);
			},
			customer(frm) {
				fetch_customer_account_summary(frm).then(() => {
					if (window.cur_pos?.payment) {
						update_customer_account_banner(window.cur_pos.payment);
					}
				});
			},
			after_payment_render(frm) {
				lock_frm_auto_payment(frm);
				disable_auto_payment_fill(frm);
				enhance_payment_method_panel();
				ensure_pos_manual_payment(window.cur_pos);
				fetch_customer_account_summary(frm).then(() => {
					if (window.cur_pos?.payment) {
						update_customer_account_banner(window.cur_pos.payment);
					}
				});
			},
		});
	});

	function apply_all_kqs_pos_patches() {
		wrap_payment_class();
		patch_pos_payment();
		patch_pos_opening_session_flow();
		patch_pos_controller();
		patch_pos_cart();
		patch_item_selector();
		patch_past_order_summary_return();
		ensure_kqs_pos_instance_patches(window.cur_pos);
	}

	function schedule_kqs_pos_patches() {
		wrap_point_of_sale_page_load();
		if (window.erpnext?.PointOfSale?.Controller) {
			apply_all_kqs_pos_patches();
			return;
		}
		frappe.require("point-of-sale.bundle.js", apply_all_kqs_pos_patches);
	}

	install_cur_pos_hook();
	schedule_kqs_pos_patches();

	$(window).on("hashchange load", () => {
		frappe.after_ajax(() => {
			if (frappe.get_route()[0] === "point-of-sale") {
				install_cur_pos_hook();
				schedule_kqs_pos_patches();
				ensure_pos_tools_menu();
				ensure_pos_manual_payment(window.cur_pos);
			}
		});
	});
})();
