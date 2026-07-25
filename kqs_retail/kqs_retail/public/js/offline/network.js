/* Copyright (c) 2026, KQS — Online/offline detection for POS. */
(() => {
	let online = navigator.onLine !== false;
	let listeners = [];
	let ping_timer = null;

	function set_online(next) {
		if (online === next) return;
		online = next;
		listeners.forEach((fn) => {
			try {
				fn(online);
			} catch (e) {
				console.error(e);
			}
		});
		if (window.kqs_offline?.refresh_banner) {
			window.kqs_offline.refresh_banner();
		}
		if (online && window.kqs_offline?.drain_outbox) {
			window.kqs_offline.drain_outbox();
		}
	}

	async function ping() {
		if (!navigator.onLine) {
			set_online(false);
			return false;
		}
		try {
			await frappe.call({
				method: "kqs_retail.offline.api.ping_offline",
				freeze: false,
			});
			set_online(true);
			return true;
		} catch (e) {
			set_online(false);
			return false;
		}
	}

	window.addEventListener("online", () => ping());
	window.addEventListener("offline", () => set_online(false));

	window.kqs_offline_network = {
		is_online() {
			return online;
		},
		on_change(fn) {
			listeners.push(fn);
		},
		ping,
		start_polling(ms = 20000) {
			if (ping_timer) clearInterval(ping_timer);
			ping();
			ping_timer = setInterval(ping, ms);
		},
	};
})();
