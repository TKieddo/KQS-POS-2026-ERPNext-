/* Copyright (c) 2026, KQS — Local sellable qty adjustments while offline. */
(() => {
	window.kqs_offline_stock = {
		async reset_from_catalog(catalog) {
			const map = {};
			(catalog || []).forEach((row) => {
				map[row.item_code] = Number(row.qty) || 0;
			});
			await window.kqs_offline_db.set_local_stock_map(map);
		},
		async get_qty(item_code) {
			return window.kqs_offline_db.get_local_stock(item_code);
		},
		async apply_sale_items(items) {
			for (const line of items || []) {
				const qty = Number(line.qty) || 0;
				if (!line.item_code || qty <= 0) continue;
				await window.kqs_offline_db.adjust_local_stock(line.item_code, -qty);
			}
		},
		async apply_layby_reserve(items) {
			// Same as sale for local sellable: reserved qty leaves the sellable pool.
			return this.apply_sale_items(items);
		},
		async release_layby_items(items) {
			for (const line of items || []) {
				const qty = Number(line.qty) || 0;
				if (!line.item_code || qty <= 0) continue;
				await window.kqs_offline_db.adjust_local_stock(line.item_code, qty);
			}
		},
	};
})();
