/* Copyright (c) 2026, KQS — IndexedDB store for offline POS (single till). */
(() => {
	const DB_NAME = "kqs_offline_pos";
	const DB_VERSION = 1;

	function open_db() {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains("meta")) {
					db.createObjectStore("meta", { keyPath: "key" });
				}
				if (!db.objectStoreNames.contains("catalog")) {
					db.createObjectStore("catalog", { keyPath: "item_code" });
				}
				if (!db.objectStoreNames.contains("laybys")) {
					db.createObjectStore("laybys", { keyPath: "name" });
				}
				if (!db.objectStoreNames.contains("receipts")) {
					db.createObjectStore("receipts", { keyPath: "name" });
				}
				if (!db.objectStoreNames.contains("outbox")) {
					const outbox = db.createObjectStore("outbox", { keyPath: "client_uuid" });
					outbox.createIndex("created_at", "created_at", { unique: false });
					outbox.createIndex("status", "status", { unique: false });
				}
				if (!db.objectStoreNames.contains("local_stock")) {
					db.createObjectStore("local_stock", { keyPath: "item_code" });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	function tx_done(tx) {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error || new Error("aborted"));
		});
	}

	async function with_store(store_name, mode, fn) {
		const db = await open_db();
		const tx = db.transaction(store_name, mode);
		const store = tx.objectStore(store_name);
		const result = await fn(store, tx);
		await tx_done(tx);
		db.close();
		return result;
	}

	function req_to_promise(req) {
		return new Promise((resolve, reject) => {
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	window.kqs_offline_db = {
		async get_meta(key) {
			return with_store("meta", "readonly", (store) => req_to_promise(store.get(key)));
		},
		async set_meta(key, value) {
			return with_store("meta", "readwrite", (store) => {
				store.put({ key, value, updated_at: Date.now() });
			});
		},
		async clear_catalog() {
			return with_store("catalog", "readwrite", (store) => store.clear());
		},
		async put_catalog(rows) {
			const db = await open_db();
			const tx = db.transaction("catalog", "readwrite");
			const store = tx.objectStore("catalog");
			for (const row of rows || []) {
				store.put(row);
			}
			await tx_done(tx);
			db.close();
		},
		async get_catalog() {
			return with_store("catalog", "readonly", (store) => req_to_promise(store.getAll()));
		},
		async search_catalog(term, limit = 50) {
			const all = await this.get_catalog();
			const q = (term || "").toLowerCase().trim();
			if (!q) return all.slice(0, limit);
			return all
				.filter(
					(r) =>
						(r.item_code || "").toLowerCase().includes(q) ||
						(r.item_name || "").toLowerCase().includes(q)
				)
				.slice(0, limit);
		},
		async put_laybys(rows) {
			const db = await open_db();
			const tx = db.transaction("laybys", "readwrite");
			const store = tx.objectStore("laybys");
			store.clear();
			for (const row of rows || []) {
				store.put(row);
			}
			await tx_done(tx);
			db.close();
		},
		async get_laybys() {
			return with_store("laybys", "readonly", (store) => req_to_promise(store.getAll()));
		},
		async get_layby(name) {
			return with_store("laybys", "readonly", (store) => req_to_promise(store.get(name)));
		},
		async put_layby(row) {
			return with_store("laybys", "readwrite", (store) => store.put(row));
		},
		async put_receipts(rows) {
			const db = await open_db();
			const tx = db.transaction("receipts", "readwrite");
			const store = tx.objectStore("receipts");
			store.clear();
			for (const row of rows || []) {
				store.put(row);
			}
			await tx_done(tx);
			db.close();
		},
		async get_receipts() {
			return with_store("receipts", "readonly", (store) => req_to_promise(store.getAll()));
		},
		async put_receipt(row) {
			return with_store("receipts", "readwrite", (store) => store.put(row));
		},
		async add_outbox(event) {
			return with_store("outbox", "readwrite", (store) => store.put(event));
		},
		async get_outbox_pending() {
			const all = await with_store("outbox", "readonly", (store) =>
				req_to_promise(store.getAll())
			);
			return (all || [])
				.filter((e) => e.status === "pending" || e.status === "failed")
				.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
		},
		async get_outbox_all() {
			return with_store("outbox", "readonly", (store) => req_to_promise(store.getAll()));
		},
		async update_outbox(client_uuid, patch) {
			return with_store("outbox", "readwrite", async (store) => {
				const row = await req_to_promise(store.get(client_uuid));
				if (!row) return;
				Object.assign(row, patch);
				store.put(row);
			});
		},
		async pending_count() {
			const pending = await this.get_outbox_pending();
			return pending.length;
		},
		async set_local_stock_map(map) {
			const db = await open_db();
			const tx = db.transaction("local_stock", "readwrite");
			const store = tx.objectStore("local_stock");
			store.clear();
			for (const [item_code, qty] of Object.entries(map || {})) {
				store.put({ item_code, qty: Number(qty) || 0 });
			}
			await tx_done(tx);
			db.close();
		},
		async get_local_stock(item_code) {
			const row = await with_store("local_stock", "readonly", (store) =>
				req_to_promise(store.get(item_code))
			);
			return row ? Number(row.qty) || 0 : 0;
		},
		async adjust_local_stock(item_code, delta) {
			return with_store("local_stock", "readwrite", async (store) => {
				const row = (await req_to_promise(store.get(item_code))) || {
					item_code,
					qty: 0,
				};
				row.qty = (Number(row.qty) || 0) + Number(delta);
				store.put(row);
				return row.qty;
			});
		},
		uuid() {
			if (window.crypto?.randomUUID) return crypto.randomUUID();
			return "kqs-" + Date.now() + "-" + Math.random().toString(16).slice(2);
		},
	};
})();
