/* Copyright (c) 2026, KQS — Full-screen Layby Lookup & Ops inside Point of Sale
 * Bundled into point_of_sale.js (Frappe page_js accepts one file per page).
 * After editing this file, run: python scripts/_merge_layby_hub.py
 */
const KQS_LAYBY_HUB_VERSION = 1;

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
