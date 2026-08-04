/* Copyright (c) 2026, KQS — Online/offline detection for POS (store Wi‑Fi friendly). */
(() => {
	// Assume online until proven otherwise — never flip offline on one blip.
	let online = true;
	let listeners = [];
	let ping_timer = null;
	let fail_streak = 0;
	let ping_in_flight = false;

	// Store Wi‑Fi / cellular often drops briefly; require sustained failure.
	const FAIL_BEFORE_OFFLINE = 3;
	const PING_TIMEOUT_MS = 12000;
	const DEFAULT_POLL_MS = 45000;
	const OFFLINE_EVENT_DEBOUNCE_MS = 8000;

	let offline_event_timer = null;

	function notify() {
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

	function set_online(next) {
		if (online === next) return;
		online = next;
		if (online) {
			fail_streak = 0;
		}
		notify();
	}

	function mark_ping_ok() {
		fail_streak = 0;
		set_online(true);
	}

	function mark_ping_fail() {
		fail_streak += 1;
		if (fail_streak >= FAIL_BEFORE_OFFLINE) {
			set_online(false);
		}
		// While streak < threshold, stay "online" so POS keeps using the server.
	}

	function call_with_timeout(opts, timeout_ms) {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(new Error("ping timeout"));
			}, timeout_ms);
			frappe
				.call(opts)
				.then((r) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolve(r);
				})
				.catch((e) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					reject(e);
				});
		});
	}

	async function ping() {
		if (ping_in_flight) {
			return online;
		}
		ping_in_flight = true;
		try {
			// navigator.onLine is unreliable on Windows/tablets — do not trust alone.
			await call_with_timeout(
				{
					method: "kqs_retail.offline.api.ping_offline",
					freeze: false,
				},
				PING_TIMEOUT_MS
			);
			mark_ping_ok();
			return true;
		} catch (e) {
			mark_ping_fail();
			return online;
		} finally {
			ping_in_flight = false;
		}
	}

	window.addEventListener("online", () => {
		if (offline_event_timer) {
			clearTimeout(offline_event_timer);
			offline_event_timer = null;
		}
		// Confirm with a ping; don't wait for the poll interval.
		ping();
	});

	window.addEventListener("offline", () => {
		// Browser fires this on tiny drops — debounce, then confirm with ping.
		if (offline_event_timer) {
			clearTimeout(offline_event_timer);
		}
		offline_event_timer = setTimeout(() => {
			offline_event_timer = null;
			ping();
		}, OFFLINE_EVENT_DEBOUNCE_MS);
	});

	window.kqs_offline_network = {
		is_online() {
			return online;
		},
		on_change(fn) {
			listeners.push(fn);
		},
		ping,
		start_polling(ms = DEFAULT_POLL_MS, opts = {}) {
			if (ping_timer) clearInterval(ping_timer);
			const immediate = opts.immediate !== false;
			if (immediate) {
				ping();
			} else {
				// Let POS paint / get_items finish before first connectivity check.
				setTimeout(ping, 8000);
			}
			ping_timer = setInterval(ping, ms);
		},
	};
})();
