/* Copyright (c) 2026, KQS — Failed offline sync retry dialog. */
(() => {
	async function list_failed() {
		const all = (await window.kqs_offline_db.get_outbox_all()) || [];
		return all.filter((e) => e.status === "failed" || e.status === "pending");
	}

	async function reset_failed_for_retry() {
		const failed = (await window.kqs_offline_db.get_outbox_all()) || [];
		for (const row of failed) {
			if (row.status === "failed") {
				await window.kqs_offline_db.update_outbox(row.client_uuid, {
					status: "pending",
					error_message: null,
				});
			}
		}
	}

	async function show_sync_status_dialog() {
		const rows = await list_failed();
		if (!rows.length) {
			frappe.msgprint(__("No pending or failed offline transactions."));
			return;
		}
		const body = rows
			.map(
				(r) =>
					`<tr>
						<td><code>${frappe.utils.escape_html(r.event_type)}</code></td>
						<td>${frappe.utils.escape_html(r.status)}</td>
						<td class="small">${frappe.utils.escape_html(r.error_message || r.client_uuid)}</td>
					</tr>`
			)
			.join("");
		const d = new frappe.ui.Dialog({
			title: __("Offline sync queue"),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					options: `
						<p class="text-muted">${__(
							"Failed events can be retried when the network is back. Fix stock or data issues if retry keeps failing."
						)}</p>
						<table class="table table-bordered table-sm">
							<thead><tr><th>${__("Type")}</th><th>${__("Status")}</th><th>${__("Detail")}</th></tr></thead>
							<tbody>${body}</tbody>
						</table>`,
				},
			],
			primary_action_label: __("Retry sync now"),
			async primary_action() {
				d.hide();
				if (!window.kqs_offline_network?.is_online()) {
					frappe.msgprint(__("Still offline. Reconnect first."));
					return;
				}
				await reset_failed_for_retry();
				const result = await frappe.call({
					method: "kqs_retail.offline.api.retry_failed_offline_events",
					args: {
						client_uuids: JSON.stringify(rows.map((r) => r.client_uuid)),
					},
					freeze: true,
					freeze_message: __("Retrying offline sync…"),
				});
				// Clear server Failed logs so push can re-apply; then drain.
				void result;
				const drain = await window.kqs_offline_outbox.drain_outbox();
				frappe.show_alert({
					indicator: drain.failed ? "orange" : "green",
					message: __(
						"Synced {0}, failed {1}.",
						[drain.drained || 0, drain.failed || 0]
					),
				});
				if (window.kqs_offline?.refresh_banner) {
					window.kqs_offline.refresh_banner();
				}
			},
		});
		d.set_secondary_action_label(__("Close"));
		d.set_secondary_action(() => d.hide());
		d.show();
	}

	window.kqs_offline_sync_ui = {
		show_sync_status_dialog,
		reset_failed_for_retry,
		list_failed,
	};
})();
