/* Copyright (c) 2026, KQS — Keep KQS Cashier on Point of Sale, not full Desk. */
(function () {
	const POS_PAGE_KEY = "_page:point-of-sale";
	const POS_SCRIPT_VERSION = "KQS_POS_PAGE_SCRIPT_VERSION = 54";
	const POS_HOME = "/app/point-of-sale";

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
				const title_s = String(title || "");
				// Same cashier, second phone/tablet: jump into the live till.
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
				// Profile already open (often same shared cashier after a race) → close or pick.
				if (
					title_s.includes("POS Opening Entry Exists") ||
					title_s.includes("Cannot Assign Cashier")
				) {
					frappe.show_alert(
						{
							message: __(
								"This till is already open. Opening the close session screen…"
							),
							indicator: "orange",
						},
						6
					);
					if (data.opening?.name) {
						kqs_prepare_and_open_closing(data.opening.name);
					} else {
						kqs_open_pos_closing();
					}
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

	function is_pos_route(route) {
		if (route?.length && route[0] === "point-of-sale") {
			return true;
		}
		const str = frappe.get_route_str?.() || "";
		if (str === "point-of-sale" || str.startsWith("point-of-sale/")) {
			return true;
		}
		const path = window.location.pathname || "";
		return path.includes("/point-of-sale");
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

	function inject_pos_shell_styles() {
		if (document.getElementById("kqs-cashier-desk-guard-styles")) {
			return;
		}
		const style = document.createElement("style");
		style.id = "kqs-cashier-desk-guard-styles";
		// data-route rules work even if JS class toggle is late; class rules cover Close Till.
		style.textContent = `
			body[data-route="point-of-sale"] .body-sidebar-container,
			body[data-route="point-of-sale"] .body-sidebar,
			body[data-route="point-of-sale"] .body-sidebar-placeholder,
			body[data-route="point-of-sale"] .sidebar-toggle-btn,
			body.kqs-pos-fullscreen .body-sidebar-container,
			body.kqs-pos-fullscreen .body-sidebar,
			body.kqs-pos-fullscreen .body-sidebar-placeholder,
			body.kqs-pos-fullscreen .sidebar-toggle-btn,
			body.kqs-pos-fullscreen .layout-side-section,
			body.kqs-pos-fullscreen .desk-sidebar,
			body.kqs-pos-fullscreen .list-sidebar,
			body.kqs-pos-fullscreen .sidebar-menu,
			body.kqs-pos-fullscreen .standard-sidebar,
			body.kqs-cashier-pos-only .body-sidebar-container,
			body.kqs-cashier-pos-only .body-sidebar,
			body.kqs-cashier-pos-only .body-sidebar-placeholder,
			body.kqs-cashier-pos-only .layout-side-section,
			body.kqs-cashier-pos-only .desk-sidebar,
			body.kqs-cashier-pos-only .list-sidebar,
			body.kqs-cashier-pos-only .sidebar-toggle-btn,
			body.kqs-cashier-pos-only .navbar .dropdown-help,
			body.kqs-cashier-pos-only .sidebar-menu,
			body.kqs-cashier-pos-only .standard-sidebar {
				display: none !important;
				width: 0 !important;
				min-width: 0 !important;
				max-width: 0 !important;
				padding: 0 !important;
				margin: 0 !important;
				border: none !important;
				overflow: hidden !important;
				visibility: hidden !important;
				pointer-events: none !important;
			}
			body[data-route="point-of-sale"] .main-section,
			body[data-route="point-of-sale"] .layout-main-section-wrapper,
			body[data-route="point-of-sale"] .page-container,
			body.kqs-pos-fullscreen .main-section,
			body.kqs-pos-fullscreen .layout-main-section-wrapper,
			body.kqs-pos-fullscreen .page-container,
			body.kqs-cashier-pos-only .main-section,
			body.kqs-cashier-pos-only .page-container,
			body.kqs-cashier-closing-form .layout-main-section-wrapper {
				width: 100% !important;
				max-width: 100% !important;
				margin-left: 0 !important;
				flex: 1 1 100% !important;
			}
		`;
		document.head.appendChild(style);
	}

	function hide_sidebar_dom() {
		document
			.querySelectorAll(
				".body-sidebar-container, .body-sidebar, .body-sidebar-placeholder"
			)
			.forEach((el) => {
				el.style.setProperty("display", "none", "important");
				el.style.setProperty("width", "0", "important");
				el.style.setProperty("visibility", "hidden", "important");
				el.style.setProperty("pointer-events", "none", "important");
			});
	}

	function should_hide_desk_sidebar(route) {
		const active_route = route || frappe.get_route();
		if (is_pos_route(active_route)) {
			return true;
		}
		if (is_cashier_pos_only()) {
			// Cashiers never get Desk chrome — including Close Till / cash-up form.
			return true;
		}
		return false;
	}

	function hide_desk_sidebar_native(route) {
		inject_pos_shell_styles();
		if (!should_hide_desk_sidebar(route)) {
			return;
		}
		const page = frappe.container?.page?.page;
		if (page) {
			page.hide_sidebar = true;
		}
		try {
			frappe.app?.sidebar?.toggle(true);
		} catch (e) {
			/* ignore */
		}
		hide_sidebar_dom();
	}

	function apply_pos_fullscreen_shell(route) {
		inject_pos_shell_styles();
		const active_route = route || frappe.get_route();
		const on_pos = is_pos_route(active_route);
		const cashier = is_cashier_pos_only();
		const on_closing = is_closing_entry_route(active_route);

		document.body.classList.toggle("kqs-pos-fullscreen", on_pos);
		if (cashier) {
			document.body.classList.add("kqs-cashier-pos-only");
			document.body.classList.toggle("kqs-cashier-closing-form", on_closing);
		} else {
			document.body.classList.remove("kqs-cashier-pos-only", "kqs-cashier-closing-form");
		}
		hide_desk_sidebar_native(active_route);
	}

	function patch_frappe_sidebar_visibility() {
		if (window._kqs_sidebar_visibility_patched) {
			return;
		}
		const sidebar = frappe.app?.sidebar;
		if (!sidebar) {
			return;
		}
		window._kqs_sidebar_visibility_patched = true;

		const orig_refresh = sidebar.refresh?.bind(sidebar);
		const orig_toggle = sidebar.toggle?.bind(sidebar);

		if (orig_refresh) {
			sidebar.refresh = function () {
				if (should_hide_desk_sidebar()) {
					this.wrapper?.hide?.();
					hide_sidebar_dom();
					return;
				}
				return orig_refresh();
			};
		}
		if (orig_toggle) {
			sidebar.toggle = function (hide) {
				if (should_hide_desk_sidebar()) {
					return orig_toggle(true);
				}
				return orig_toggle(hide);
			};
		}

		$(document).on("page-change.kqs_sidebar", () => {
			hide_desk_sidebar_native();
		});
	}

	function path_is_allowed_for_cashier(pathname) {
		const path = (pathname || window.location.pathname || "").replace(/\/+$/, "") || "/";
		if (path === "/app/point-of-sale" || path.startsWith("/app/point-of-sale/")) {
			return true;
		}
		if (path === "/app/pos-closing-entry" || path.startsWith("/app/pos-closing-entry/")) {
			return true;
		}
		// Login / assets / printview / API are not Desk browse targets.
		if (
			path === "/login" ||
			path.startsWith("/api/") ||
			path.startsWith("/assets/") ||
			path.startsWith("/files/") ||
			path.startsWith("/private/") ||
			path.startsWith("/printview") ||
			path.startsWith("/print")
		) {
			return true;
		}
		return false;
	}

	function hard_redirect_cashier_to_pos() {
		if (!is_cashier_pos_only()) {
			return false;
		}
		const path = (window.location.pathname || "").replace(/\/+$/, "") || "/";
		if (path_is_allowed_for_cashier(path)) {
			return false;
		}
		// Full navigation — no permission modal, no forbidden page flash.
		window.location.replace(POS_HOME);
		return true;
	}

	function soft_redirect_cashier_to_pos() {
		if (!is_cashier_pos_only()) {
			return;
		}
		if (frappe.set_route) {
			const orig = window._kqs_orig_set_route || frappe.set_route.bind(frappe);
			orig("point-of-sale");
		} else {
			window.location.replace(POS_HOME);
		}
	}

	function install_cashier_set_route_guard() {
		if (!is_cashier_pos_only() || window._kqs_cashier_set_route_guard || !frappe.set_route) {
			return;
		}
		window._kqs_cashier_set_route_guard = true;
		const orig_set_route = frappe.set_route.bind(frappe);
		window._kqs_orig_set_route = orig_set_route;
		frappe.set_route = function (...args) {
			let route = args;
			if (args.length === 1 && Array.isArray(args[0])) {
				route = args[0];
			} else if (args.length === 1 && typeof args[0] === "string") {
				route = String(args[0])
					.replace(/^\//, "")
					.split("/")
					.filter(Boolean);
			}
			if (route?.length && !route_is_allowed(route) && route[0] !== "login") {
				return orig_set_route("point-of-sale");
			}
			return orig_set_route(...args);
		};
	}

	function install_cashier_sidebar_click_block() {
		if (!is_cashier_pos_only() || window._kqs_cashier_sidebar_click_block) {
			return;
		}
		window._kqs_cashier_sidebar_click_block = true;
		document.addEventListener(
			"click",
			(event) => {
				if (!is_cashier_pos_only()) {
					return;
				}
				const link = event.target?.closest?.(
					".body-sidebar a, .body-sidebar-container a, .desk-sidebar a, a[href^='/app/']"
				);
				if (!link) {
					return;
				}
				const href = link.getAttribute("href") || "";
				if (!href || href === "#" || href.startsWith("javascript:")) {
					// Sidebar items often use click handlers without href — always block sidebar.
					if (link.closest(".body-sidebar, .body-sidebar-container, .desk-sidebar")) {
						event.preventDefault();
						event.stopPropagation();
						soft_redirect_cashier_to_pos();
					}
					return;
				}
				try {
					const url = new URL(href, window.location.origin);
					if (!path_is_allowed_for_cashier(url.pathname)) {
						event.preventDefault();
						event.stopPropagation();
						soft_redirect_cashier_to_pos();
					}
				} catch (e) {
					/* ignore bad href */
				}
			},
			true
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
			soft_redirect_cashier_to_pos();
		}
	}

	function guard_route() {
		if (hard_redirect_cashier_to_pos()) {
			return;
		}
		const route = frappe.get_route();
		patch_frappe_sidebar_visibility();
		install_cashier_set_route_guard();
		install_cashier_sidebar_click_block();
		apply_pos_fullscreen_shell(route);

		if (!is_cashier_pos_only()) {
			return;
		}
		redirect_cashier_to_pos_home();
		if (route_is_allowed(route)) {
			return;
		}
		// In-app route change to a forbidden Desk page — bounce with no modal.
		soft_redirect_cashier_to_pos();
	}

	function install_route_guard() {
		if (window._kqs_cashier_route_guard) {
			return;
		}
		window._kqs_cashier_route_guard = true;
		// Run before paint when possible — pasted /app/item URLs never show content.
		if (hard_redirect_cashier_to_pos()) {
			return;
		}
		inject_pos_shell_styles();
		apply_pos_fullscreen_shell();
		frappe.router.on("change", () => {
			guard_route();
			frappe.after_ajax(guard_route);
		});
		if (frappe.ready) {
			frappe.ready(() => {
				patch_frappe_sidebar_visibility();
				guard_route();
				frappe.after_ajax(guard_route);
				setTimeout(guard_route, 50);
				setTimeout(guard_route, 200);
				setTimeout(guard_route, 800);
			});
		} else {
			setTimeout(guard_route, 50);
			setTimeout(guard_route, 200);
			setTimeout(guard_route, 800);
		}
	}

	install_route_guard();
})();
