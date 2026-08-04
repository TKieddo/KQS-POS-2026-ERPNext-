/* Copyright (c) 2026, KQS — Pull offline bundle into IndexedDB. */
(() => {
	async function pull_bundle(pos_profile, warehouse) {
		const r = await frappe.call({
			method: "kqs_retail.offline.api.pull_offline_bundle",
			args: { pos_profile, warehouse: warehouse || "" },
			// Background cache — never block the till UI while cashiers start selling.
			freeze: false,
		});
		const bundle = r.message || {};
		await window.kqs_offline_db.put_catalog(bundle.catalog || []);
		await window.kqs_offline_db.put_laybys(bundle.laybys || []);
		await window.kqs_offline_db.put_receipts(bundle.receipts || []);
		await window.kqs_offline_stock.reset_from_catalog(bundle.catalog || []);
		await window.kqs_offline_db.set_meta("session", {
			warehouse: bundle.warehouse,
			pos_profile: bundle.pos_profile,
			company: bundle.company,
			payment_modes: bundle.payment_modes || [],
			settings: bundle.settings || {},
			pulled_at: bundle.pulled_at,
			lease: bundle.lease,
		});
		return bundle;
	}

	async function acquire_lease(pos_profile, warehouse, opening_entry) {
		// Non-blocking: records last till for ops; never shows a Desk Message.
		try {
			const r = await frappe.call({
				method: "kqs_retail.offline.api.acquire_offline_lease",
				args: {
					pos_profile,
					warehouse: warehouse || "",
					opening_entry: opening_entry || "",
				},
				// Avoid freeze overlay on every POS open.
				freeze: false,
			});
			return r.message;
		} catch (e) {
			console.warn("KQS offline lease (ignored):", e);
			return null;
		}
	}

	async function release_lease(pos_profile, warehouse) {
		const r = await frappe.call({
			method: "kqs_retail.offline.api.release_offline_lease",
			args: { pos_profile, warehouse: warehouse || "" },
		});
		return r.message;
	}

	window.kqs_offline_pull = { pull_bundle, acquire_lease, release_lease };
})();
