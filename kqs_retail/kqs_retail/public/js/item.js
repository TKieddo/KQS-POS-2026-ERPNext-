/* Copyright (c) 2026, KQS — Item list/form delete (variants + linked docs) */
frappe.provide("kqs_retail.item");

(function () {
	const API = "kqs_retail.api.product_setup.delete_items";

	function preview_labels(codes) {
		return codes
			.slice(0, 5)
			.map((code) => frappe.utils.escape_html(code))
			.join(", ");
	}

	function show_delete_result(msg, ondone) {
		const parts = [];
		if (msg.deleted_count) {
			parts.push(__("{0} deleted", [msg.deleted_count]));
		}
		if (msg.archived_count || msg.disabled_count) {
			parts.push(
				__("{0} archived (history kept; SKU free to recreate)", [
					msg.archived_count || msg.disabled_count,
				])
			);
		}
		if (msg.failed_count) {
			parts.push(__("{0} could not be removed", [msg.failed_count]));
		}
		if (!parts.length) {
			frappe.msgprint(__("Nothing was changed."));
			if (ondone) ondone(msg);
			return;
		}
		frappe.show_alert({
			message: parts.join(". "),
			indicator: msg.failed_count ? "orange" : "green",
		});

		const detail_rows = []
			.concat(msg.archived || msg.disabled || [])
			.concat(msg.failed || []);
		if (detail_rows.length) {
			frappe.msgprint({
				title: __("Delete result"),
				message: detail_rows
					.map((row) => {
						const code = frappe.utils.escape_html(row.item_code || "");
						const note = frappe.utils.escape_html(row.message || row.archived_as || "");
						return `${code}: ${note}`;
					})
					.join("<br>"),
				indicator: msg.failed_count ? "orange" : "blue",
			});
		}
		if (ondone) ondone(msg);
	}

	kqs_retail.item.delete_items = function (item_codes, ondone) {
		const codes = (item_codes || []).map((c) => String(c || "").trim()).filter(Boolean);
		if (!codes.length) {
			frappe.msgprint(__("Select at least one Item."));
			return;
		}
		let preview = preview_labels(codes);
		if (codes.length > 5) {
			preview += ` ${__("…and {0} more", [codes.length - 5])}`;
		}
		frappe.confirm(
			__(
				"Delete {0} item(s) from the <b>entire catalog</b> (all branches)?<br><br>{1}<br><br>"
				"This zeros stock at every warehouse and removes the SKU from POS everywhere. "
				"If the item has sales history it is archived as DEL-… so you can recreate the same "
				"style with <b>empty</b> stock — it does not hide-and-resurface old quantities. "
				"Submitted invoices are not cancelled.<br><br>"
				"To clear stock at one store only, use <b>Edit Product → Remove from branch</b> "
				"(transfers sellable qty back to Central).",
				[codes.length, preview]
			),
			() => {
				frappe.call({
					method: API,
					args: { item_codes: JSON.stringify(codes) },
					freeze: true,
					freeze_message: __("Deleting products and clearing stock…"),
					callback(r) {
						if (r.exc) return;
						show_delete_result(r.message || {}, ondone);
					},
				});
			}
		);
	};

	frappe.ui.form.on("Item", {
		refresh(frm) {
			if (frm.is_new() || frm.doc.__islocal) return;
			if (!frappe.perm.has_perm("Item", "delete")) return;

			frm.add_custom_button(
				__("Delete"),
				() => {
					kqs_retail.item.delete_items([frm.doc.name], () => {
						frappe.set_route("List", "Item");
					});
				},
				__("Actions")
			);
		},
	});
})();
