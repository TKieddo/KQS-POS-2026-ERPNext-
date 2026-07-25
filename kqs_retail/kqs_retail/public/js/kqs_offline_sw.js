/* Copyright (c) 2026, KQS — Cache kqs_retail static assets for short offline outages. */
const CACHE = "kqs-retail-assets-v1";
const PRECACHE = [
	"/assets/kqs_retail/js/offline/db.js",
	"/assets/kqs_retail/js/offline/network.js",
	"/assets/kqs_retail/js/offline/stock_local.js",
	"/assets/kqs_retail/js/offline/catalog.js",
	"/assets/kqs_retail/js/offline/sync_pull.js",
	"/assets/kqs_retail/js/offline/sync_push.js",
	"/assets/kqs_retail/js/offline/sync_ui.js",
	"/assets/kqs_retail/js/offline/bridge.js",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
		)
	);
	self.clients.claim();
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (!url.pathname.startsWith("/assets/kqs_retail/")) return;
	event.respondWith(
		caches.match(event.request).then((cached) => {
			const fetched = fetch(event.request)
				.then((response) => {
					if (response && response.ok) {
						const clone = response.clone();
						caches.open(CACHE).then((cache) => cache.put(event.request, clone));
					}
					return response;
				})
				.catch(() => cached);
			return cached || fetched;
		})
	);
});
