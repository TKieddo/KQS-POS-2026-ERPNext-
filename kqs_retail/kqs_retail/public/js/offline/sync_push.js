/* Copyright (c) 2026, KQS — Outbox enqueue + drain. */
(() => {
	async function enqueue(event_type, payload) {
		const client_uuid = window.kqs_offline_db.uuid();
		const event = {
			client_uuid,
			event_type,
			payload: payload || {},
			status: "pending",
			created_at: Date.now(),
			error_message: null,
			linked_doctype: null,
			linked_name: null,
		};
		await window.kqs_offline_db.add_outbox(event);
		if (window.kqs_offline?.refresh_banner) {
			window.kqs_offline.refresh_banner();
		}
		return event;
	}

	async function drain_outbox() {
		if (!window.kqs_offline_network?.is_online()) {
			return { drained: 0, failed: 0 };
		}
		const pending = await window.kqs_offline_db.get_outbox_pending();
		const failed_uuids = pending.filter((e) => e.status === "failed").map((e) => e.client_uuid);
		if (failed_uuids.length) {
			try {
				await frappe.call({
					method: "kqs_retail.offline.api.retry_failed_offline_events",
					args: { client_uuids: JSON.stringify(failed_uuids) },
					freeze: false,
				});
				for (const uuid of failed_uuids) {
					await window.kqs_offline_db.update_outbox(uuid, {
						status: "pending",
						error_message: null,
					});
				}
			} catch (e) {
				console.warn("KQS offline retry clear failed:", e);
			}
		}

		const queue = await window.kqs_offline_db.get_outbox_pending();
		let drained = 0;
		let failed = 0;
		for (const event of queue) {
			try {
				const r = await frappe.call({
					method: "kqs_retail.offline.api.push_offline_event",
					args: {
						client_uuid: event.client_uuid,
						event_type: event.event_type,
						payload: JSON.stringify(event.payload || {}),
						force_retry: event.status === "failed" ? 1 : 0,
					},
					freeze: false,
				});
				const msg = r.message || {};
				if (msg.status === "Success") {
					await window.kqs_offline_db.update_outbox(event.client_uuid, {
						status: "synced",
						linked_doctype: msg.linked_doctype,
						linked_name: msg.linked_name,
						error_message: null,
					});
					drained += 1;
				} else {
					await window.kqs_offline_db.update_outbox(event.client_uuid, {
						status: "failed",
						error_message: msg.error_message || __("Sync failed"),
					});
					failed += 1;
				}
			} catch (e) {
				await window.kqs_offline_db.update_outbox(event.client_uuid, {
					status: "failed",
					error_message: String(e.message || e),
				});
				failed += 1;
				if (!window.kqs_offline_network?.is_online()) break;
			}
		}
		if (window.kqs_offline?.refresh_banner) {
			window.kqs_offline.refresh_banner();
		}
		return { drained, failed };
	}

	window.kqs_offline_outbox = { enqueue, drain_outbox };
})();
