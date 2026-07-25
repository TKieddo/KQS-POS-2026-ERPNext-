/* Copyright (c) 2026, KQS — QZ Tray silent print with browser fallback for POS receipts. */
frappe.provide("kqs_retail.silent_print");

(function () {
	const STORAGE_KEY = "kqs_qz_printer_name";
	/**
	 * Match content width — do NOT oversize then scale (that clips both sides).
	 * Content CSS is 60mm; page a hair wider for printer gutters.
	 */
	const PAGE_WIDTH_MM = 64;
	const LOGO_ASSET = "/assets/kqs_retail/images/kqs-logo.png";
	let print_queue = Promise.resolve();
	let qz_security_ready = null;
	let unsigned_hint_shown = false;

	/** Extra CSS forced into QZ HTML — thermal + pixel raster need heavy black type. */
	const QZ_PRINT_BOOST_CSS = `
		html, body {
			margin: 0 !important;
			padding: 0 !important;
			width: ${PAGE_WIDTH_MM}mm !important;
			max-width: ${PAGE_WIDTH_MM}mm !important;
			overflow: hidden !important;
			background: #fff !important;
			color: #000 !important;
			-webkit-print-color-adjust: exact !important;
			print-color-adjust: exact !important;
			-webkit-font-smoothing: none !important;
			font-smooth: never !important;
		}
		.print-format, .print-format-gutter, .page-break {
			margin: 0 auto !important;
			padding: 0 !important;
			width: 60mm !important;
			max-width: 60mm !important;
			overflow: hidden !important;
		}
		.kqs-rcpt {
			width: 60mm !important;
			max-width: 60mm !important;
			margin: 0 auto !important;
			padding: 1.5mm 2mm 4mm !important;
			overflow: hidden !important;
			font-family: Arial, Helvetica, sans-serif !important;
			color: #000 !important;
		}
		.kqs-rcpt, .kqs-rcpt * {
			color: #000 !important;
			opacity: 1 !important;
			font-family: Arial, Helvetica, sans-serif !important;
			max-width: 100% !important;
		}
		.kqs-logo {
			display: block !important;
			width: auto !important;
			max-width: 36mm !important;
			max-height: 14mm !important;
			height: auto !important;
			margin: 0 auto 2mm !important;
			object-fit: contain !important;
		}
		.kqs-muted-line,
		.kqs-policy,
		.kqs-policy-title,
		.kqs-item-sub,
		.kqs-thanks,
		.kqs-social-line,
		.kqs-footer-line {
			font-weight: 900 !important;
			color: #000 !important;
			opacity: 1 !important;
			-webkit-text-stroke: 0.25px #000;
		}
		.kqs-muted-line { font-size: 9pt !important; }
		.kqs-policy { font-size: 8.5pt !important; line-height: 1.35 !important; }
		.kqs-cols-head, .kqs-cols-row {
			grid-template-columns: 7mm minmax(0, 1fr) 18mm !important;
			width: 100% !important;
		}
		.kqs-cols-head .qty, .kqs-cols-row .qty { text-align: left !important; }
		.kqs-cols-row .price, .kqs-cols-head .price,
		.kqs-row > span:last-child {
			white-space: nowrap !important;
		}
	`;

	function get_settings() {
		return frappe.boot?.kqs_retail_settings || {};
	}

	function is_qz_enabled() {
		const raw = get_settings().enable_qz_silent_print;
		if (raw === undefined || raw === null || raw === "") {
			return true;
		}
		return cint(raw) === 1;
	}

	function resolve_printer_name() {
		const from_settings = cstr(get_settings().qz_printer_name || "").trim();
		if (from_settings) {
			return from_settings;
		}
		try {
			return cstr(localStorage.getItem(STORAGE_KEY) || "").trim();
		} catch (e) {
			return "";
		}
	}

	function remember_printer(name) {
		if (!name) return;
		try {
			localStorage.setItem(STORAGE_KEY, name);
		} catch (e) {
			/* ignore quota / private mode */
		}
	}

	function browser_print(doctype, docname, print_format, letterhead) {
		frappe.utils.print(
			doctype,
			docname,
			print_format,
			letterhead || "",
			frappe.boot.lang
		);
	}

	function blob_to_data_url(blob) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	}

	async function inline_images_for_qz(html) {
		const origin = window.location.origin;
		// Relative site paths → absolute (QZ headless browser has no page origin).
		html = html.replace(/src=(["'])(\/[^"']+)\1/gi, (match, q, path) => {
			return `src=${q}${origin}${path}${q}`;
		});

		const candidates = new Set([
			`${origin}${LOGO_ASSET}`,
			LOGO_ASSET,
		]);
		const absMatches = html.match(/src=["'](https?:\/\/[^"']+\.(?:png|jpe?g|gif|svg|webp))["']/gi) || [];
		absMatches.forEach((m) => {
			const url = m.replace(/^src=["']/i, "").replace(/["']$/, "");
			if (url.includes("kqs") || url.includes("/assets/kqs_retail/")) {
				candidates.add(url);
			}
		});

		for (const url of candidates) {
			try {
				const resp = await fetch(url, { credentials: "same-origin" });
				if (!resp.ok) continue;
				const data_url = await blob_to_data_url(await resp.blob());
				const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				html = html.replace(new RegExp(escaped, "g"), data_url);
			} catch (e) {
				/* keep absolute URL fallback */
			}
		}
		return html;
	}

	function fetch_print_html(doctype, docname, print_format, letterhead) {
		const has_letterhead = Boolean(letterhead);
		return frappe
			.call({
				method: "frappe.www.printview.get_html_and_style",
				args: {
					doc: doctype,
					name: docname,
					print_format,
					no_letterhead: has_letterhead ? 0 : 1,
					letterhead: letterhead || null,
				},
			})
			.then(async (r) => {
				const body = r.message?.html;
				const style = r.message?.style || "";
				if (!body) {
					throw new Error("Empty print HTML");
				}
				const with_images = await inline_images_for_qz(body);
				return (
					"<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
					`<style>${style}\n${QZ_PRINT_BOOST_CSS}</style></head>` +
					`<body>${with_images}</body></html>`
				);
			});
	}

	function ensure_qz_security() {
		if (qz_security_ready) {
			return qz_security_ready;
		}
		qz_security_ready = frappe.ui.form.qz_init().then(() => {
			if (typeof qz === "undefined" || !qz.security) {
				return false;
			}
			qz.security.setCertificatePromise((resolve) => {
				frappe
					.call({
						method: "kqs_retail.api.qz_sign.get_certificate",
						freeze: false,
					})
					.then((r) => {
						const cert = cstr(r.message || "").trim();
						resolve(cert || "");
					})
					.catch(() => resolve(""));
			});
			qz.security.setSignatureAlgorithm("SHA512");
			qz.security.setSignaturePromise((toSign) => {
				return (resolve, reject) => {
					frappe
						.call({
							method: "kqs_retail.api.qz_sign.sign_message",
							args: { request: toSign },
							freeze: false,
						})
						.then((r) => {
							const sig = cstr(r.message || "").trim();
							if (sig) {
								resolve(sig);
							} else {
								reject("empty signature");
							}
						})
						.catch(() => reject("sign failed"));
				};
			});
			return frappe
				.call({
					method: "kqs_retail.api.qz_sign.is_signing_configured",
					freeze: false,
				})
				.then((r) => Boolean(r.message?.configured))
				.catch(() => false);
		});
		return qz_security_ready;
	}

	function hint_remember_allow() {
		if (unsigned_hint_shown) return;
		unsigned_hint_shown = true;
		frappe.show_alert(
			{
				message: __(
					"QZ Tray: tick “Remember this decision” on the Allow dialog so it stops asking on every print."
				),
				indicator: "orange",
			},
			12
		);
	}

	async function resolve_qz_printer() {
		const configured = resolve_printer_name();
		if (configured) {
			return configured;
		}
		if (typeof qz === "undefined" || !qz.printers?.getDefault) {
			return null;
		}
		try {
			return await qz.printers.getDefault();
		} catch (e) {
			return null;
		}
	}

	async function print_via_qz(doctype, docname, print_format, letterhead) {
		if (!frappe.ui?.form?.qz_connect) {
			throw new Error("QZ helpers not available");
		}
		const signing_ok = await ensure_qz_security();
		await frappe.ui.form.qz_connect();
		if (typeof qz === "undefined" || !qz.print || !qz.configs?.create) {
			throw new Error("QZ Tray API not ready");
		}
		if (!signing_ok) {
			hint_remember_allow();
		}

		const html = await fetch_print_html(doctype, docname, print_format, letterhead);
		const printer = await resolve_qz_printer();
		// Avoid colorType blackwhite — it thresholds antialiased text and washes
		// out address/policy lines on thermal heads.
		const config = qz.configs.create(printer || null, {
			units: "mm",
			size: { width: PAGE_WIDTH_MM },
			margins: { top: 0, right: 0, bottom: 0, left: 0 },
			// false: HTML already sized to paper — scaling was clipping both sides.
			scaleContent: false,
			rasterize: true,
			interpolation: "nearest-neighbor",
			density: "203dpi",
		});
		const data = [
			{
				type: "pixel",
				format: "html",
				flavor: "plain",
				data: html,
				options: {
					pageWidth: PAGE_WIDTH_MM,
					units: "mm",
					scaleContent: false,
				},
			},
		];
		await qz.print(config, data);
		if (printer) {
			remember_printer(printer);
		}
	}

	/**
	 * Print a document: try QZ silent HTML, then browser printview
	 * (silent under Chrome --kiosk-printing). Jobs run in a serial queue
	 * so layby's two slips do not race.
	 */
	function kqs_print(doctype, docname, print_format, letterhead) {
		if (!print_format || !docname) {
			return Promise.resolve(false);
		}

		const job = print_queue.then(async () => {
			if (is_qz_enabled()) {
				try {
					await print_via_qz(doctype, docname, print_format, letterhead);
					return "qz";
				} catch (err) {
					console.warn("KQS QZ print failed; falling back to browser.", err);
				}
			}
			try {
				browser_print(doctype, docname, print_format, letterhead);
				return "browser";
			} catch (err) {
				console.error("KQS browser print failed.", err);
				frappe.show_alert({
					message: __(
						"Could not print receipt. Allow pop-ups or check QZ Tray / the printer."
					),
					indicator: "orange",
				});
				return false;
			}
		});

		print_queue = job.catch(() => {});
		return job;
	}

	kqs_retail.silent_print.print = kqs_print;
	window.kqs_print = kqs_print;
})();
