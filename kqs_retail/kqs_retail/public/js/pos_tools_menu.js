/* Copyright (c) 2026, KQS — Tile-based POS tools menu for ERPNext Point of Sale
 * After editing this file, run: python scripts/merge_pos_tools_menu.py
 */

const KQS_POS_TOOLS_MENU_VERSION = 6;

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

	function icon_logout() {
		return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 3.75a.75.75 0 0 1 .75-.75h6A2.25 2.25 0 0 1 19.5 5.25v13.5A2.25 2.25 0 0 1 17.25 21h-6a.75.75 0 0 1 0-1.5h6a.75.75 0 0 0 .75-.75V5.25a.75.75 0 0 0-.75-.75h-6a.75.75 0 0 1-.75-.75z"/><path d="M3.22 11.47a.75.75 0 0 0 0 1.06l3.75 3.75a.75.75 0 1 0 1.06-1.06L5.81 12.75H14a.75.75 0 0 0 0-1.5H5.81l2.22-2.22a.75.75 0 0 0-1.06-1.06l-3.75 3.5z"/></svg>`;
	}

	function confirm_logout(on_confirm) {
		frappe.confirm(
			__(
				"Log out of this account?<br><br><b>Your till stays open</b> until you use Close POS. You can sign back in later and resume the same session."
			),
			() => on_confirm?.(),
			() => {}
		);
	}

	function do_logout() {
		// Call logout API directly so we only show our Menu confirmation (not a second dialog).
		frappe.call({
			method: "logout",
			callback(r) {
				if (r.exc) {
					return;
				}
				try {
					frappe.app?.clear_session?.();
				} catch (e) {
					/* ignore */
				}
				window.location.href = "/login";
			},
		});
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
			},
			{
				id: "logout",
				title: __("Log Out"),
				desc: __("Sign out of this login. Till stays open until Close POS."),
				gradient: "linear-gradient(145deg, #FF6B6B 0%, #C62828 100%)",
				icon: icon_logout(),
				confirm_before: confirm_logout,
				action() {
					do_logout();
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
			const run = () => {
				close({ restore_pos: false });
				frappe.after_ajax(() => tile.action(target_pos));
			};
			// Confirm first while Menu is still visible — cancel must leave the till usable.
			if (typeof tile.confirm_before === "function") {
				tile.confirm_before(run);
				return;
			}
			run();
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
