/* Copyright (c) 2026, KQS — Keep KQS Cashier on Point of Sale, not full Desk. */
(function () {
	const POS_PAGE_KEY = "_page:point-of-sale";
	const POS_SCRIPT_VERSION = "KQS_POS_PAGE_SCRIPT_VERSION = 35";

	function bust_stale_pos_page_cache() {
		try {
			const raw = localStorage.getItem(POS_PAGE_KEY);
			if (!raw) return;
			const page = JSON.parse(raw);
			if ((page?.script || "").includes(POS_SCRIPT_VERSION)) return;
			localStorage.removeItem(POS_PAGE_KEY);
			if (locals?.Page?.["point-of-sale"]) {
				delete locals.Page["point-of-sale"];
			}
			if (frappe.pages?.["point-of-sale"]) {
				delete frappe.pages["point-of-sale"];
			}
		} catch (e) {
			localStorage.removeItem(POS_PAGE_KEY);
		}
	}

	bust_stale_pos_page_cache();

	function install_outdated_opening_intercept() {
		if (window._kqs_outdated_opening_intercept || !window.frappe?.msgprint) {
			return;
		}
		window._kqs_outdated_opening_intercept = true;

		const orig_msgprint = frappe.msgprint.bind(frappe);
		frappe.msgprint = function (opts, ...rest) {
			let title = "";
			if (typeof opts === "string") {
				title = opts;
			} else if (opts?.title) {
				title = String(opts.title);
			}
			if (title.includes("Outdated POS Opening Entry")) {
				kqs_show_outdated_opening_dialog();
				return;
			}
			return orig_msgprint(opts, ...rest);
		};
	}

	function kqs_open_pos_closing() {
		const pos = window.cur_pos;
		if (pos && typeof pos.close_pos === "function") {
			pos.close_pos();
			return;
		}
		frappe.set_route("point-of-sale");
	}

	function kqs_show_outdated_opening_dialog() {
		if (window._kqs_outdated_dialog_open) {
			return;
		}
		window._kqs_outdated_dialog_open = true;

		const d = new frappe.ui.Dialog({
			title: __("Outdated POS Opening Entry"),
			size: "small",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "message",
					options: `<p style="margin:0">${__(
						"This register was opened on a previous day. Close it to start a fresh session."
					)}</p>`,
				},
			],
			primary_action_label: __("Close the POS"),
			primary_action() {
				d.hide();
				kqs_open_pos_closing();
			},
		});
		d.onhide = () => {
			window._kqs_outdated_dialog_open = false;
		};
		d.show();
	}

	install_outdated_opening_intercept();

	if (frappe.ready) {
		frappe.ready(install_outdated_opening_intercept);
	}

	function is_cashier_pos_only() {
		return frappe.boot?.kqs_cashier_pos_only === true;
	}

	function routes_match(route, allowed) {
		if (!route?.length || !allowed?.length) {
			return false;
		}
		if (allowed.length > route.length) {
			return false;
		}
		for (let i = 0; i < allowed.length; i += 1) {
			if (route[i] !== allowed[i]) {
				return false;
			}
		}
		return true;
	}

	function is_closing_entry_route(route) {
		if (!route?.length) {
			return false;
		}
		return (
			(route[0] === "Form" && route[1] === "POS Closing Entry") ||
			route[0] === "pos-closing-entry"
		);
	}

	function route_is_allowed(route) {
		if (!route?.length) {
			return true;
		}
		if (route[0] === "login") {
			return true;
		}
		const allowed = frappe.boot?.kqs_cashier_allowed_routes || [
			["point-of-sale"],
			["Form", "POS Closing Entry"],
			["pos-closing-entry"],
		];
		return allowed.some((prefix) => routes_match(route, prefix));
	}

	function inject_cashier_desk_styles() {
		if (document.getElementById("kqs-cashier-desk-guard-styles")) {
			return;
		}
		const style = document.createElement("style");
		style.id = "kqs-cashier-desk-guard-styles";
		style.textContent = `
			body.kqs-cashier-pos-only .layout-side-section,
			body.kqs-cashier-pos-only .desk-sidebar,
			body.kqs-cashier-pos-only .list-sidebar,
			body.kqs-cashier-pos-only .sidebar-toggle-btn,
			body.kqs-cashier-pos-only .navbar .dropdown-help,
			body.kqs-cashier-pos-only .sidebar-menu,
			body.kqs-cashier-pos-only .body-sidebar,
			body.kqs-cashier-pos-only .standard-sidebar {
				display: none !important;
			}
			body.kqs-cashier-closing-form .layout-main-section-wrapper {
				margin-left: 0 !important;
			}
		`;
		document.head.appendChild(style);
	}

	function apply_cashier_desk_shell(route) {
		if (!is_cashier_pos_only()) {
			document.body.classList.remove("kqs-cashier-pos-only", "kqs-cashier-closing-form");
			return;
		}
		inject_cashier_desk_styles();
		document.body.classList.add("kqs-cashier-pos-only");
		const active_route = route || frappe.get_route();
		document.body.classList.toggle(
			"kqs-cashier-closing-form",
			is_closing_entry_route(active_route)
		);
	}

	function guard_route() {
		if (!is_cashier_pos_only()) {
			return;
		}
		const route = frappe.get_route();
		apply_cashier_desk_shell(route);
		if (route_is_allowed(route)) {
			return;
		}
		frappe.show_alert(
			{
				message: __("Desk access is restricted. Returning to Point of Sale."),
				indicator: "orange",
			},
			4
		);
		frappe.set_route("point-of-sale");
	}

	function install_route_guard() {
		if (window._kqs_cashier_route_guard) {
			return;
		}
		window._kqs_cashier_route_guard = true;
		apply_cashier_desk_shell();
		frappe.router.on("change", () => {
			frappe.after_ajax(guard_route);
		});
		if (frappe.ready) {
			frappe.ready(() => frappe.after_ajax(guard_route));
		}
	}

	install_route_guard();
})();
