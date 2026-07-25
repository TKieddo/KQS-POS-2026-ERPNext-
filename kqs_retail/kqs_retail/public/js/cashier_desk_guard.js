/* Copyright (c) 2026, KQS — Keep KQS Cashier on Point of Sale, not full Desk. */
(function () {
	const POS_PAGE_KEY = "_page:point-of-sale";
	const POS_SCRIPT_VERSION = "KQS_POS_PAGE_SCRIPT_VERSION = 50";

	function bust_stale_pos_page_cache() {
		try {
			const raw = localStorage.getItem(POS_PAGE_KEY);
			if (!raw) return;
			const page = JSON.parse(raw);
			const script = page?.script || "";
			// Drop cached page if version mismatch or old overpayment blocker is still present.
			if (
				script.includes(POS_SCRIPT_VERSION) &&
				!script.includes("exceeds sale total")
			) {
				return;
			}
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
			if (
				title.includes("Outdated POS Opening Entry") ||
				title.includes("POS Opening Entry Exists") ||
				title.includes("Cannot Assign Cashier")
			) {
				kqs_resolve_opening_conflict(title);
				return;
			}
			return orig_msgprint(opts, ...rest);
		};
	}

	function kqs_resolve_opening_conflict(title) {
		if (window._kqs_opening_conflict_busy) {
			return;
		}
		window._kqs_opening_conflict_busy = true;
		$(".modal").modal("hide");

		frappe.call({
			method: "kqs_retail.api.pos.resolve_pos_opening_entry",
			callback(r) {
				window._kqs_opening_conflict_busy = false;
				if (r.exc) {
					return;
				}
				const data = r.message || {};
				if (data.action === "resume" && data.opening?.name) {
					frappe.show_alert(
						{
							message: __("Resuming your open till…"),
							indicator: "blue",
						},
						4
					);
					frappe.set_route("point-of-sale");
					setTimeout(() => window.location.reload(), 200);
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
					kqs_prepare_and_open_closing(data.opening.name);
					return;
				}
				// Someone else still has this profile open (or no session for this user).
				if (String(title || "").includes("POS Opening Entry Exists")) {
					frappe.show_alert(
						{
							message: __(
								"This till is already open. Close the open session, then try again."
							),
							indicator: "orange",
						},
						6
					);
					kqs_open_pos_closing();
					return;
				}
				kqs_show_outdated_opening_dialog();
			},
			error() {
				window._kqs_opening_conflict_busy = false;
			},
		});
	}

	function kqs_prepare_and_open_closing(pos_opening_entry) {
		if (!pos_opening_entry) {
			frappe.msgprint(
				__(
					"No open POS session found. As a manager: Selling → POS Opening Entry → open the Open row → Close Session."
				)
			);
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

	function kqs_pick_open_session_then_close(sessions) {
		if (!sessions?.length) {
			kqs_prepare_and_open_closing(null);
			return;
		}
		if (sessions.length === 1) {
			kqs_prepare_and_open_closing(sessions[0].name);
			return;
		}
		const options = sessions.map((row) => ({
			label: `${row.name} — ${row.user} (${row.pos_profile || ""})`,
			value: row.name,
		}));
		const d = new frappe.ui.Dialog({
			title: __("Close open POS session"),
			fields: [
				{
					fieldtype: "Select",
					fieldname: "pos_opening_entry",
					label: __("Open session"),
					options: options.map((o) => o.value).join("\n"),
					reqd: 1,
					default: options[0].value,
				},
				{
					fieldtype: "HTML",
					options: `<p class="text-muted small">${__(
						"Managers can close any open till. Pick the session to close."
					)}</p>`,
				},
			],
			primary_action_label: __("Close selected"),
			primary_action(values) {
				d.hide();
				kqs_prepare_and_open_closing(values.pos_opening_entry);
			},
		});
		// Show user labels in the select (Frappe Select uses values; improve via HTML list)
		const $sel = d.fields_dict.pos_opening_entry.$input;
		$sel.empty();
		options.forEach((o) => {
			$sel.append(`<option value="${frappe.utils.escape_html(o.value)}">${frappe.utils.escape_html(
				o.label
			)}</option>`);
		});
		d.show();
	}

	function kqs_open_pos_closing() {
		// Do not call ERPNext close_pos() here — it no-ops when the POS cart is hidden
		// (common after the outdated-opening dialog), which left cashiers on a blank screen.
		const from_pos = window.cur_pos?.pos_opening;
		if (from_pos) {
			kqs_prepare_and_open_closing(from_pos);
			return;
		}
		frappe.call({
			method: "kqs_retail.api.pos_closing.list_open_pos_sessions",
			args: { limit: 20 },
			callback(r) {
				if (r.exc) return;
				kqs_pick_open_session_then_close(r.message || []);
			},
		});
	}

	function kqs_show_outdated_opening_dialog() {
		if (window._kqs_outdated_dialog_open) {
			return;
		}
		window._kqs_outdated_dialog_open = true;

		// Do not show the English ERPNext error modal — route cashiers straight to closing.
		frappe.show_alert(
			{
				message: __("Till was opened on a previous day — closing now."),
				indicator: "orange",
			},
			6
		);
		kqs_open_pos_closing();
		setTimeout(() => {
			window._kqs_outdated_dialog_open = false;
		}, 4000);
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

	function redirect_cashier_to_pos_home() {
		if (!is_cashier_pos_only()) {
			return;
		}
		const path = (window.location.pathname || "").replace(/\/+$/, "") || "/";
		const route = frappe.get_route_str?.() || "";
		const on_desk_home =
			path === "/desk" ||
			path === "/app" ||
			route === "" ||
			route === "Workspaces" ||
			route.startsWith("Workspaces/") ||
			route === "workspace" ||
			route.startsWith("workspace/");
		if (on_desk_home) {
			frappe.set_route("point-of-sale");
		}
	}

	function guard_route() {
		if (!is_cashier_pos_only()) {
			return;
		}
		const route = frappe.get_route();
		apply_cashier_desk_shell(route);
		redirect_cashier_to_pos_home();
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
