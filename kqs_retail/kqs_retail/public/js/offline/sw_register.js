/* Copyright (c) 2026, KQS — Register service worker for kqs_retail asset cache. */
(() => {
	if (!("serviceWorker" in navigator)) return;
	const sw_url = "/assets/kqs_retail/js/kqs_offline_sw.js";
	window.addEventListener("load", () => {
		navigator.serviceWorker.register(sw_url, { scope: "/assets/kqs_retail/" }).catch((err) => {
			console.warn("KQS offline SW register failed:", err);
		});
	});
})();
