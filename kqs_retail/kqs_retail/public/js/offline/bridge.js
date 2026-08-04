/* Copyright (c) 2026, KQS — Offline POS banner + public bridge. */
(() => {
	function ensure_banner() {
		let el = document.getElementById("kqs-offline-banner");
		if (el) return el;
		el = document.createElement("div");
		el.id = "kqs-offline-banner";
		el.style.cssText =
			"display:none;position:fixed;top:0;left:0;right:0;z-index:9999;" +
			"padding:8px 12px;font-size:13px;font-weight:600;text-align:center;" +
			"font-family:inherit;";
		document.body.appendChild(el);
		return el;
	}

	async function refresh_banner() {
		const el = ensure_banner();
		const online = window.kqs_offline_network?.is_online() !== false;
		const pending = (await window.kqs_offline_db?.pending_count?.()) || 0;
		el.onclick = () => {
			if (window.kqs_offline_sync_ui?.show_sync_status_dialog) {
				window.kqs_offline_sync_ui.show_sync_status_dialog();
			}
		};
		el.style.cursor = pending > 0 || !online ? "pointer" : "default";
		if (online && pending === 0) {
			el.style.display = "none";
			return;
		}
		el.style.display = "block";
		if (!online) {
			el.style.background = "#b54708";
			el.style.color = "#fff";
			el.textContent =
				pending > 0
					? __("Offline — {0} pending sync. Tap for details. Cash / Card / M-Pesa OK.", [
							pending,
						])
					: __("Offline — using cached catalog. Cash / Card / M-Pesa still OK.");
		} else {
			el.style.background = "#175cd3";
			el.style.color = "#fff";
			el.textContent = __(
				"Online — {0} pending. Tap to view / retry sync.",
				[pending]
			);
		}
	}

	function payments_from_frm(frm) {
		return (frm.doc.payments || [])
			.filter((row) => flt(row.amount) > 0)
			.map((row) => ({
				mode_of_payment: row.mode_of_payment,
				amount: flt(row.amount),
				reference_no: row.reference_no || row.account || null,
			}));
	}

	function items_from_frm(frm) {
		return (frm.doc.items || []).map((row) => ({
			item_code: row.item_code,
			qty: flt(row.qty),
			rate: flt(row.rate),
			uom: row.uom,
		}));
	}

	async function queue_sale_from_frm(frm) {
		const meta = (await window.kqs_offline_db.get_meta("session"))?.value || {};
		const items = items_from_frm(frm);
		const payments = payments_from_frm(frm);
		const payload = {
			pos_profile: frm.doc.pos_profile || meta.pos_profile,
			warehouse: frm.doc.set_warehouse || meta.warehouse,
			company: frm.doc.company || meta.company,
			customer: frm.doc.customer,
			items,
			payments,
			posting_date: frm.doc.posting_date,
			local_total: flt(frm.doc.grand_total),
		};
		const event = await window.kqs_offline_outbox.enqueue("sale", payload);
		await window.kqs_offline_stock.apply_sale_items(items);
		await window.kqs_offline_db.put_receipt({
			name: "OFFLINE-" + event.client_uuid.slice(0, 8).toUpperCase(),
			customer: payload.customer,
			customer_name: frm.doc.customer_name,
			posting_date: payload.posting_date,
			grand_total: payload.local_total,
			outstanding_amount: 0,
			company: payload.company,
			pos_profile: payload.pos_profile,
			offline: 1,
			client_uuid: event.client_uuid,
			modified: new Date().toISOString(),
		});
		return event;
	}

	async function queue_event(event_type, payload, stock_fn) {
		const event = await window.kqs_offline_outbox.enqueue(event_type, payload);
		if (stock_fn) await stock_fn();
		return event;
	}

	async function refresh_offline_cache(pos_profile, warehouse) {
		if (!pos_profile || !window.kqs_offline_network?.is_online()) {
			await refresh_banner();
			return;
		}
		try {
			const meta = (await window.kqs_offline_db?.get_meta?.("session"))?.value || {};
			const pulled_at = meta.pulled_at ? new Date(meta.pulled_at).getTime() : 0;
			const age_ms = pulled_at ? Date.now() - pulled_at : Number.POSITIVE_INFINITY;
			const same_wh = !warehouse || meta.warehouse === warehouse;
			// Fresh cache (< 30 min): only drain outbox, skip heavy catalog pull.
			if (same_wh && age_ms >= 0 && age_ms < 30 * 60 * 1000) {
				await window.kqs_offline_outbox?.drain_outbox?.();
				await refresh_banner();
				return;
			}
			await window.kqs_offline_pull.pull_bundle(pos_profile, warehouse);
			await window.kqs_offline_outbox?.drain_outbox?.();
		} catch (e) {
			console.warn("KQS offline init:", e);
			frappe.show_alert({
				indicator: "orange",
				message: __(
					"Could not refresh offline cache. Using last cached catalog if available."
				),
			});
		}
		await refresh_banner();
	}

	function schedule_idle(fn, delay_ms = 2000) {
		const run = () => {
			try {
				fn();
			} catch (e) {
				console.warn("KQS offline schedule:", e);
			}
		};
		if (typeof requestIdleCallback === "function") {
			setTimeout(() => requestIdleCallback(run, { timeout: 5000 }), delay_ms);
		} else {
			setTimeout(run, delay_ms);
		}
	}

	async function init_for_pos(ctx) {
		const pos_profile = ctx.pos_profile;
		const warehouse = ctx.warehouse;
		if (!pos_profile) return;

		// Poll later so opening ping doesn't compete with get_items.
		if (window.kqs_offline_network?.start_polling) {
			window.kqs_offline_network.start_polling(45000, { immediate: false });
		}
		// Banner only — keep till interactive while cache refreshes in background.
		refresh_banner();
		schedule_idle(() => refresh_offline_cache(pos_profile, warehouse), 2500);
	}

	async function assert_can_close() {
		const pending = await window.kqs_offline_db.pending_count();
		if (pending > 0) {
			const online = window.kqs_offline_network?.is_online();
			if (online) {
				const result = await window.kqs_offline_outbox.drain_outbox();
				const still = await window.kqs_offline_db.pending_count();
				if (still > 0) {
					if (window.kqs_offline_sync_ui?.show_sync_status_dialog) {
						window.kqs_offline_sync_ui.show_sync_status_dialog();
					}
					frappe.throw(
						__(
							"Cannot close till: {0} offline transaction(s) failed to sync. Use Retry in the sync dialog.",
							[still]
						)
					);
				}
				return result;
			}
			frappe.throw(
				__(
					"Cannot close till while offline with {0} pending transaction(s). Reconnect and sync first.",
					[pending]
				)
			);
		}
	}

	window.kqs_offline = {
		refresh_banner,
		drain_outbox: () => window.kqs_offline_outbox.drain_outbox(),
		init_for_pos,
		queue_sale_from_frm,
		queue_event,
		assert_can_close,
		is_online: () => window.kqs_offline_network?.is_online() !== false,
		async pending_count() {
			return window.kqs_offline_db.pending_count();
		},
		payments_from_frm,
		items_from_frm,
	};
})();
