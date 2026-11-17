/* Copyright (c) 2026, KQS — Item list delete + branch stock switcher */
frappe.provide("kqs_retail.item");

const KQS_ITEM_LIST_BRANCH_KEY = "kqs_item_list_branch";
let kqs_branch_options_cache = null;

function kqs_get_selected_item_codes(listview) {
	return (listview.get_checked_items(true) || [])
		.map((row) => (typeof row === "string" ? row : row.name || row.item_code))
		.filter(Boolean);
}

function kqs_run_item_delete(listview) {
	const codes = kqs_get_selected_item_codes(listview);
	if (!codes.length) {
		frappe.msgprint(__("Select at least one Item."));
		return;
	}
	if (!kqs_retail.item || typeof kqs_retail.item.delete_items !== "function") {
		frappe.msgprint(__("Delete handler failed to load. Hard-refresh the page (Ctrl+Shift+R)."));
		return;
	}
	kqs_retail.item.delete_items(codes, () => {
		if (listview.clear_checked_items) {
			listview.clear_checked_items();
		}
		listview.refresh();
	});
}

function kqs_clear_branch_name_filter(listview) {
	if (!listview.filter_area) return;
	const filters = listview.filter_area.get() || [];
	const keep = filters.filter((f) => !(f[0] === "Item" && f[1] === "name" && f[2] === "in"));
	listview.filter_area.clear();
	keep.forEach((f) => listview.filter_area.add(f));
}

function kqs_set_branch_indicator(listview, warehouse, label, count) {
	if (!listview.page || !listview.page.set_indicator) return;
	if (!warehouse) {
		listview.page.set_indicator(__("All branches (catalog)"), "blue");
		return;
	}
	listview.page.set_indicator(
		__("Stock at {0} ({1})", [label || warehouse, count != null ? count : "…"]),
		"green"
	);
}

function kqs_mark_active_branch_select($wrap, warehouse, label) {
	warehouse = String(warehouse || "");
	const $value = $wrap.find(".kqs-branch-value");
	let display = label || "";
	if (!display) {
		const $match = $wrap.find(".kqs-branch-option").filter(function () {
			return String($(this).attr("data-wh") || "") === warehouse;
		});
		display = $match.attr("data-label") || (warehouse ? warehouse : __("All catalog"));
	}
	if ($value.length) {
		$value.text(display);
	}
	$wrap.find(".kqs-branch-option").removeClass("is-active");
	$wrap
		.find(".kqs-branch-option")
		.filter(function () {
			return String($(this).attr("data-wh") || "") === warehouse;
		})
		.addClass("is-active");
	$wrap.attr("data-current-wh", warehouse);
}

function kqs_apply_branch_stock_filter(listview, warehouse, label) {
	warehouse = String(warehouse || "").trim();
	listview.kqs_branch_warehouse = warehouse;
	try {
		localStorage.setItem(KQS_ITEM_LIST_BRANCH_KEY, warehouse);
	} catch (e) {
		/* ignore */
	}

	const $wrap = listview.$kqs_branch_switcher;
	if ($wrap && $wrap.length) {
		kqs_mark_active_branch_select($wrap, warehouse, label);
	}

	if (!warehouse) {
		kqs_clear_branch_name_filter(listview);
		kqs_set_branch_indicator(listview, "", "", null);
		listview.refresh();
		return;
	}

	frappe.call({
		method: "kqs_retail.api.stock_transfer.list_item_names_with_stock",
		args: { warehouse },
		freeze: true,
		freeze_message: __("Loading stock at branch…"),
		callback(r) {
			if (r.exc) return;
			const names = (r.message && r.message.item_names) || [];
			const count = (r.message && r.message.count) || names.length;

			kqs_clear_branch_name_filter(listview);

			if (!names.length) {
				frappe.show_alert({
					message: __("No stock at {0}. Showing empty list.", [label || warehouse]),
					indicator: "orange",
				});
				listview.filter_area.add([["Item", "name", "in", ["__kqs_no_stock__"]]]);
			} else {
				listview.filter_area.add([["Item", "name", "in", names]]);
			}

			kqs_set_branch_indicator(listview, warehouse, label || warehouse, count);
			listview.refresh();
		},
	});
}

function kqs_ensure_branch_styles() {
	$("#kqs-item-list-branch-style").remove();
	$("head").append(`<style id="kqs-item-list-branch-style">
		.kqs-branch-switcher {
			position: relative;
			display: inline-flex;
			align-items: center;
			align-self: center;
			margin: 0 10px 0 0;
			padding: 0;
			vertical-align: middle;
			flex: 0 0 auto;
			z-index: 20;
		}
		.kqs-branch-switcher.kqs-branch-switcher--body {
			display: flex;
			width: 100%;
			margin: 0 0 12px 0;
		}
		.kqs-branch-pill {
			position: relative;
			display: inline-flex;
			align-items: center;
			gap: 8px;
			min-height: 34px;
			padding: 4px 10px 4px 8px;
			border-radius: 999px;
			border: 1px solid rgba(20, 28, 36, 0.12);
			background: linear-gradient(180deg, #ffffff 0%, #f4f6f8 100%);
			box-shadow:
				0 1px 0 rgba(255,255,255,0.85) inset,
				0 1px 2px rgba(16, 24, 40, 0.06),
				0 0 0 1px rgba(196, 149, 58, 0.18);
			transition: box-shadow 0.15s ease, border-color 0.15s ease;
			cursor: pointer;
			user-select: none;
		}
		.kqs-branch-pill:hover,
		.kqs-branch-switcher.is-open .kqs-branch-pill {
			border-color: rgba(196, 149, 58, 0.55);
			box-shadow:
				0 1px 0 rgba(255,255,255,0.9) inset,
				0 4px 12px rgba(16, 24, 40, 0.08),
				0 0 0 1px rgba(196, 149, 58, 0.35);
		}
		.kqs-branch-icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 26px;
			height: 26px;
			border-radius: 50%;
			flex: 0 0 auto;
			background: linear-gradient(145deg, #1f2933 0%, #111827 100%);
			color: #f0d78c;
			font-size: 12px;
			box-shadow: 0 1px 2px rgba(0,0,0,0.25);
		}
		.kqs-branch-fields {
			display: flex;
			flex-direction: column;
			justify-content: center;
			min-width: 0;
			line-height: 1.1;
			gap: 1px;
			text-align: left;
		}
		.kqs-branch-eyebrow {
			font-size: 9px;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: #8a7350;
			white-space: nowrap;
		}
		.kqs-branch-value {
			min-width: 118px;
			max-width: 168px;
			font-size: 13px;
			font-weight: 650;
			line-height: 1.2;
			color: #111827;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.kqs-branch-chevron {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			color: #8a7350;
			font-size: 10px;
			margin-left: 2px;
			opacity: 0.9;
			transition: transform 0.15s ease;
		}
		.kqs-branch-switcher.is-open .kqs-branch-chevron {
			transform: rotate(180deg);
		}
		.kqs-branch-menu {
			display: none;
			position: absolute;
			top: calc(100% + 8px);
			left: 0;
			min-width: 220px;
			max-width: min(320px, 90vw);
			max-height: min(320px, 50vh);
			overflow: auto;
			padding: 8px;
			border-radius: 14px;
			border: 1px solid rgba(20, 28, 36, 0.1);
			background: #fff;
			box-shadow:
				0 18px 40px rgba(16, 24, 40, 0.16),
				0 2px 6px rgba(16, 24, 40, 0.06);
			z-index: 1000;
		}
		.kqs-branch-switcher.is-open .kqs-branch-menu {
			display: block;
		}
		.kqs-branch-menu-title {
			padding: 8px 12px 6px;
			font-size: 10px;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: #8a7350;
		}
		.kqs-branch-option {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			width: 100%;
			margin: 0 0 4px;
			padding: 10px 12px;
			border: 0;
			border-radius: 10px;
			background: transparent;
			color: #111827;
			font-size: 13px;
			font-weight: 600;
			text-align: left;
			cursor: pointer;
			transition: background 0.12s ease, color 0.12s ease;
		}
		.kqs-branch-option:last-child {
			margin-bottom: 0;
		}
		.kqs-branch-option:hover {
			background: #f6f1e7;
			color: #1f2933;
		}
		.kqs-branch-option.is-active {
			background: linear-gradient(135deg, #1f2933 0%, #111827 100%);
			color: #f8f1dc;
		}
		.kqs-branch-option.is-active .kqs-branch-option-check {
			opacity: 1;
		}
		.kqs-branch-option-check {
			opacity: 0;
			color: #f0d78c;
			font-size: 11px;
		}
		.page-actions .kqs-branch-switcher,
		.standard-actions .kqs-branch-switcher {
			height: 34px;
		}
		@media (max-width: 768px) {
			.kqs-branch-pill { padding: 3px 8px 3px 6px; min-height: 32px; }
			.kqs-branch-value { min-width: 96px; max-width: 128px; font-size: 12px; }
			.kqs-branch-menu { min-width: 200px; }
			.kqs-branch-option { padding: 11px 12px; }
			.kqs-branch-icon { width: 24px; height: 24px; font-size: 11px; }
		}
	</style>`);
}

function kqs_find_switcher_host(listview) {
	const $wrapper = $(listview.page && listview.page.wrapper);
	// Prefer the page-head actions row (same strip as List View / Saved Filters).
	const headCandidates = [
		$wrapper.find(".page-head .page-head-right").first(),
		$wrapper.find(".page-head .page-actions").first(),
		$wrapper.find(".page-actions").first(),
		$wrapper.find(".standard-actions").first(),
	];
	for (const $el of headCandidates) {
		if ($el && $el.length) return { $el, mode: "head" };
	}
	const bodyCandidates = [
		$wrapper.find(".layout-main-section").first(),
		$wrapper.find(".layout-main-section-wrapper").first(),
		listview.$frappe_list && listview.$frappe_list.parent(),
		listview.page && listview.page.main,
		$wrapper.find(".page-body").first(),
	];
	for (const $el of bodyCandidates) {
		if ($el && $el.length) return { $el, mode: "body" };
	}
	return { $el: $wrapper, mode: "body" };
}

function kqs_mount_branch_switcher(listview) {
	if (!listview || listview.doctype !== "Item") return;

	// Page head can re-render after onload and wipe the bar — remount if missing.
	if (listview.$kqs_branch_switcher && listview.$kqs_branch_switcher.length) {
		const el = listview.$kqs_branch_switcher[0];
		const still_valid =
			document.body.contains(el) &&
			listview.$kqs_branch_switcher.find(".kqs-branch-pill").length &&
			listview.$kqs_branch_switcher.find(".kqs-branch-menu").length;
		if (still_valid) {
			return;
		}
		listview.$kqs_branch_switcher.remove();
		listview.$kqs_branch_switcher = null;
	}

	kqs_ensure_branch_styles();

	const $wrap = $(`<div class="kqs-branch-switcher" data-kqs-branch-switcher="1">
		<button type="button" class="kqs-branch-pill" title="${__(
			"Filter items by store stock"
		)}" aria-haspopup="listbox" aria-expanded="false">
			<span class="kqs-branch-icon" aria-hidden="true"><i class="fa fa-map-marker"></i></span>
			<span class="kqs-branch-fields">
				<span class="kqs-branch-eyebrow">${__("Store")}</span>
				<span class="kqs-branch-value">${__("Loading…")}</span>
			</span>
			<span class="kqs-branch-chevron" aria-hidden="true"><i class="fa fa-chevron-down"></i></span>
		</button>
		<div class="kqs-branch-menu" role="listbox" hidden>
			<div class="kqs-branch-menu-title">${__("Choose branch")}</div>
			<div class="kqs-branch-menu-list">
				<span class="text-muted small" style="display:block;padding:10px 12px;">${__(
					"Loading…"
				)}</span>
			</div>
		</div>
	</div>`);
	listview.$kqs_branch_switcher = $wrap;

	const host = kqs_find_switcher_host(listview);
	if (host.mode === "body") {
		$wrap.addClass("kqs-branch-switcher--body");
		host.$el.prepend($wrap);
	} else {
		host.$el.prepend($wrap);
	}

	host.$el.css({ display: "flex", "align-items": "center", "flex-wrap": "wrap" });

	function close_menu() {
		$wrap.removeClass("is-open");
		$wrap.find(".kqs-branch-pill").attr("aria-expanded", "false");
		$wrap.find(".kqs-branch-menu").attr("hidden", true);
	}

	function open_menu() {
		$wrap.addClass("is-open");
		$wrap.find(".kqs-branch-pill").attr("aria-expanded", "true");
		$wrap.find(".kqs-branch-menu").removeAttr("hidden");
	}

	$wrap
		.find(".kqs-branch-pill")
		.off("click.kqsBranch")
		.on("click.kqsBranch", function (e) {
			e.preventDefault();
			e.stopPropagation();
			if ($wrap.hasClass("is-open")) close_menu();
			else open_menu();
		});

	$(document)
		.off("click.kqsBranchOutside")
		.on("click.kqsBranchOutside", function (e) {
			if (!$(e.target).closest(".kqs-branch-switcher").length) {
				$(".kqs-branch-switcher").removeClass("is-open");
				$(".kqs-branch-switcher .kqs-branch-pill").attr("aria-expanded", "false");
				$(".kqs-branch-switcher .kqs-branch-menu").attr("hidden", true);
			}
		});

	function fill_branch_menu(branches) {
		const rows = [
			{
				name: "",
				label: __("All catalog"),
			},
		].concat(
			branches.map((b) => ({
				name: String(b.name || ""),
				label: String(b.label || b.name || ""),
			}))
		);

		const html = rows
			.map(
				(row) => `<button type="button" class="kqs-branch-option" role="option"
					data-wh="${frappe.utils.escape_html(row.name)}"
					data-label="${frappe.utils.escape_html(row.label)}">
					<span>${frappe.utils.escape_html(row.label)}</span>
					<span class="kqs-branch-option-check" aria-hidden="true"><i class="fa fa-check"></i></span>
				</button>`
			)
			.join("");
		$wrap.find(".kqs-branch-menu-list").html(html);

		$wrap
			.off("click.kqsBranchOpt", ".kqs-branch-option")
			.on("click.kqsBranchOpt", ".kqs-branch-option", function (e) {
				e.preventDefault();
				e.stopPropagation();
				const wh = String($(this).attr("data-wh") || "");
				const label = String($(this).attr("data-label") || wh || __("All catalog"));
				close_menu();
				kqs_apply_branch_stock_filter(listview, wh, label);
			});

		const current = String(listview.kqs_branch_warehouse || "");
		kqs_mark_active_branch_select($wrap, current);

		if (!listview.__kqs_branch_filter_applied) {
			listview.__kqs_branch_filter_applied = true;
			let saved = "";
			try {
				saved = String(localStorage.getItem(KQS_ITEM_LIST_BRANCH_KEY) || "");
			} catch (e) {
				saved = "";
			}
			const valid = !saved || branches.some((b) => String(b.name) === saved) ? saved : "";
			const match = branches.find((b) => String(b.name) === valid);
			kqs_apply_branch_stock_filter(listview, valid, (match && match.label) || "");
		}
	}

	if (kqs_branch_options_cache) {
		fill_branch_menu(kqs_branch_options_cache);
		return;
	}

	frappe.call({
		method: "kqs_retail.api.stock_transfer.list_branch_filter_options",
		callback(r) {
			if (r.exc) {
				$wrap.find(".kqs-branch-value").text(__("Unavailable"));
				$wrap.find(".kqs-branch-menu-list").html(
					`<span class="text-danger small" style="display:block;padding:10px 12px;">${__(
						"Could not load branches."
					)}</span>`
				);
				return;
			}
			kqs_branch_options_cache = (r.message && r.message.branches) || [];
			fill_branch_menu(kqs_branch_options_cache);
		},
	});
}

function kqs_patch_item_listview(listview) {
	if (!listview || listview.doctype !== "Item") return;

	const mount_now_and_later = () => {
		try {
			kqs_mount_branch_switcher(listview);
		} catch (e) {
			console.error("kqs branch switcher mount failed", e);
		}
	};
	mount_now_and_later();
	// Head actions render after onload in some Desk builds — remount shortly after.
	setTimeout(mount_now_and_later, 100);
	setTimeout(mount_now_and_later, 500);

	if (listview.__kqs_delete_patched) {
		return;
	}
	listview.__kqs_delete_patched = true;

	listview.delete_items = function () {
		kqs_run_item_delete(listview);
	};

	try {
		const orig_get_actions = listview.get_actions_menu_items.bind(listview);
		listview.get_actions_menu_items = function () {
			const items = orig_get_actions();
			const delete_labels = new Set([
				__("Delete"),
				__("Delete", null, "Button in list view actions menu"),
			]);
			const filtered = items.filter((item) => !delete_labels.has(item.label));
			filtered.push({
				label: __("Delete", null, "Button in list view actions menu"),
				action: () => kqs_run_item_delete(listview),
				standard: true,
			});
			return filtered;
		};
		if (typeof listview.set_actions_menu_items === "function") {
			listview.set_actions_menu_items();
		}
	} catch (e) {
		console.error("kqs item delete menu patch failed", e);
	}

	try {
		listview.page.add_button(
			__("Delete selected"),
			() => kqs_run_item_delete(listview),
			{ btn_class: "btn-default btn-sm" }
		);
	} catch (e) {
		console.error("kqs delete button failed", e);
	}

	if (!listview.__kqs_refresh_remount) {
		listview.__kqs_refresh_remount = true;
		const orig_refresh = listview.refresh.bind(listview);
		listview.refresh = function () {
			const ret = orig_refresh.apply(this, arguments);
			setTimeout(mount_now_and_later, 50);
			return ret;
		};
	}
}

function kqs_hook_item_listview_settings() {
	const settings = frappe.listview_settings["Item"] || {};
	if (settings.__kqs_branch_hooked) {
		return;
	}
	settings.__kqs_branch_hooked = true;
	const previous_onload = settings.onload;
	settings.onload = function (listview) {
		if (typeof previous_onload === "function") {
			previous_onload.call(this, listview);
		}
		kqs_patch_item_listview(listview);
	};
	frappe.listview_settings["Item"] = settings;
}

function kqs_try_patch_current_item_list() {
	const route = frappe.get_route ? frappe.get_route() : [];
	if (!(route[0] === "List" && route[1] === "Item")) return;
	const list = window.cur_list;
	if (list && list.doctype === "Item") {
		kqs_patch_item_listview(list);
	}
}

(function register_kqs_item_list_branch_switcher() {
	kqs_hook_item_listview_settings();

	// Re-hook if ERPNext replaces listview_settings after our first run.
	$(document).on("app_ready", () => kqs_hook_item_listview_settings());
	$(document).on("page-change", () => {
		kqs_hook_item_listview_settings();
		setTimeout(kqs_try_patch_current_item_list, 50);
		setTimeout(kqs_try_patch_current_item_list, 400);
	});
})();
