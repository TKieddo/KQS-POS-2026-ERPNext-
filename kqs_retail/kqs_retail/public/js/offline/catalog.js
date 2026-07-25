/* Copyright (c) 2026, KQS — Map IndexedDB catalog → ERPNext POS item shape. */
(() => {
	function row_to_pos_item(row, local_qty) {
		const qty =
			local_qty != null && !Number.isNaN(Number(local_qty))
				? Number(local_qty)
				: Number(row.qty) || 0;
		return {
			item_code: row.item_code,
			item_name: row.item_name || row.item_code,
			description: row.item_name || row.item_code,
			stock_uom: row.stock_uom || "Nos",
			item_image: row.image || null,
			is_stock_item: 1,
			actual_qty: qty,
			uom: row.stock_uom || "Nos",
			price_list_rate: Number(row.rate) || 0,
			currency: row.currency || null,
			batch_no: null,
			item_group: row.item_group || null,
		};
	}

	async function get_items_from_cache({ start = 0, page_length = 40, search_term = "" } = {}) {
		const term = (search_term || "").trim();
		let rows = term
			? await window.kqs_offline_db.search_catalog(term, 500)
			: await window.kqs_offline_db.get_catalog();

		const meta = (await window.kqs_offline_db.get_meta("session"))?.value || {};
		const item_group = null; // group filter applied client-side if needed by caller

		const mapped = [];
		for (const row of rows || []) {
			if (item_group && row.item_group && row.item_group !== item_group) continue;
			const local_qty = await window.kqs_offline_db.get_local_stock(row.item_code);
			mapped.push(row_to_pos_item(row, local_qty));
		}

		const slice = mapped.slice(start, start + page_length);
		return { items: slice };
	}

	async function filter_laybys(query, warehouse, customer) {
		let rows = await window.kqs_offline_db.get_laybys();
		const q = (query || "").toLowerCase().trim();
		if (warehouse) {
			rows = rows.filter((r) => !r.warehouse || r.warehouse === warehouse);
		}
		if (customer) {
			rows = rows.filter((r) => r.customer === customer);
		}
		if (q) {
			rows = rows.filter(
				(r) =>
					(r.name || "").toLowerCase().includes(q) ||
					(r.customer_name || "").toLowerCase().includes(q) ||
					(r.customer || "").toLowerCase().includes(q)
			);
		}
		return rows
			.filter((r) => ["Active", "Draft"].includes(r.status) || !r.status)
			.slice(0, 40);
	}

	async function filter_receipts(term) {
		let rows = await window.kqs_offline_db.get_receipts();
		const q = (term || "").toLowerCase().trim();
		if (q) {
			rows = rows.filter(
				(r) =>
					(r.name || "").toLowerCase().includes(q) ||
					(r.customer_name || "").toLowerCase().includes(q) ||
					(r.customer || "").toLowerCase().includes(q)
			);
		}
		return rows
			.filter((r) => !String(r.name || "").startsWith("OFFLINE-"))
			.slice(0, 50)
			.map((r) => ({
				doctype: r.doctype || "Sales Invoice",
				name: r.name,
				customer: r.customer,
				customer_name: r.customer_name,
				posting_date: r.posting_date,
				grand_total: r.grand_total,
				currency: r.currency,
				cashier: r.cashier || "",
				modified: r.modified,
				items: r.items || [],
			}));
	}

	window.kqs_offline_catalog = {
		get_items_from_cache,
		filter_laybys,
		filter_receipts,
		row_to_pos_item,
	};
})();
