/* Copyright (c) 2026, KQS — Item list delete (Frappe v16 Actions menu + toolbar) */
frappe.provide("kqs_retail.item");

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

function kqs_patch_item_listview(listview) {
	if (listview.__kqs_delete_patched) {
		return;
	}
	listview.__kqs_delete_patched = true;

	listview.delete_items = function () {
		kqs_run_item_delete(listview);
	};

	// Frappe v16: Actions menu uses get_actions_menu_items + add_actions_menu_item
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

	// Always-visible toolbar button (select rows first, then click)
	listview.page.add_button(
		__("Delete selected"),
		() => kqs_run_item_delete(listview),
		{ btn_class: "btn-default btn-sm" }
	);
}

(function register_kqs_item_list_delete() {
	const settings = frappe.listview_settings["Item"] || {};
	const previous_onload = settings.onload;

	settings.onload = function (listview) {
		if (typeof previous_onload === "function") {
			previous_onload.call(this, listview);
		}
		kqs_patch_item_listview(listview);
	};

	frappe.listview_settings["Item"] = settings;
})();
