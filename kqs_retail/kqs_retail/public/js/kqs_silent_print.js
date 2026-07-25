/* Copyright (c) 2026, KQS — QZ Tray silent print with browser fallback for POS receipts. */
frappe.provide("kqs_retail.silent_print");

(function () {
	const STORAGE_KEY = "kqs_qz_printer_name";
	/** ~72mm printable width on 80mm thermal (inches for QZ pageWidth). */
	const PAGE_WIDTH_IN = 2.83;
	let print_queue = Promise.resolve();

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
			.then((r) => {
				const body = r.message?.html;
				const style = r.message?.style || "";
				if (!body) {
					throw new Error("Empty print HTML");
				}
				return (
					"<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
					`<style>${style}</style></head><body>${body}</body></html>`
				);
			});
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
		await frappe.ui.form.qz_connect();
		if (typeof qz === "undefined" || !qz.print || !qz.configs?.create) {
			throw new Error("QZ Tray API not ready");
		}

		const html = await fetch_print_html(doctype, docname, print_format, letterhead);
		const printer = await resolve_qz_printer();
		const config = qz.configs.create(printer || null, {
			scaleContent: true,
			margins: 0,
		});
		const data = [
			{
				type: "pixel",
				format: "html",
				flavor: "plain",
				data: html,
				options: { pageWidth: PAGE_WIDTH_IN },
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
