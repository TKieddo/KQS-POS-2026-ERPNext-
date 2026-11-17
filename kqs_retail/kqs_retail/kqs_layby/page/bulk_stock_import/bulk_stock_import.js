frappe.pages["bulk-stock-import"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Bulk Stock Import"),
		single_column: true,
	});

	let batch = null;
	let rows = [];
	let pack_map = { box: 1, pack: 1 };
	let ai_info = { configured: false, provider: "", providers: ["openai", "deepseek", "qwen"] };
	let category_options = []; // [{name, parent}]
	let default_item_group = "";
	let uploaded_file_urls = [];
	let csv_template = "";
	let csv_template_blank = "";
	let settings_hint = "";
	let autosave_timer = null;
	let autosave_busy = false;
	let rematch_timer = null;
	let rematch_busy = false;
	let rematch_focus_row_id = null;
	let last_saved_at = null;
	let commit_busy = false;
	let last_publish_result = null;
	let hide_published_rows = true;

	const form = new frappe.ui.FieldGroup({
		body: page.body,
		card_layout: true,
		fields: [
			{
				fieldtype: "Section Break",
				description: __(
					"Work in a draft (auto-saved). Download the CSV template to format an old catalogue. Nothing goes live until you Approve & publish."
				),
			},
			{ fieldname: "drafts_panel", fieldtype: "HTML" },
			{
				fieldname: "warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("Receive into (branch)"),
				reqd: 1,
				description: __(
					"Required — choose the branch that should hold this stock. Nothing is assumed (not Central). Wrong branch mixes inventory with other stores."
				),
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
				onchange: () => {
					render_summary();
					schedule_autosave();
				},
			},
			{
				fieldname: "default_item_group",
				fieldtype: "Link",
				options: "Item Group",
				label: __("Default category (fills empty rows only)"),
				description: __(
					"Optional shortcut. Each preview row has its own Category — edit per line when one upload has bags + shoes + belts. Paper names like Soviet are product names, not categories."
				),
				onchange: () => schedule_autosave(),
			},
			{ fieldtype: "Column Break" },
			{
				fieldname: "pack_box",
				fieldtype: "Float",
				label: __("Units per box"),
				default: 1,
				description: __("When qty is 1box, multiply by this."),
				onchange: () => schedule_autosave(),
			},
			{
				fieldname: "pack_pack",
				fieldtype: "Float",
				label: __("Units per pack"),
				default: 1,
				onchange: () => schedule_autosave(),
			},
			{ fieldtype: "Section Break", label: __("1. Choose how to import") },
			{ fieldname: "source_panel", fieldtype: "HTML" },
			{ fieldtype: "Section Break", label: __("2. Preview draft") },
			{ fieldname: "summary_bar", fieldtype: "HTML" },
			{ fieldname: "preview_grid", fieldtype: "HTML" },
		],
	});
	form.make();
	form.wrapper.addClass("kqs-bulk-import-form");
	$(page.body).css({ paddingTop: "1.5rem", paddingBottom: "4rem" });
	inject_bulk_import_styles();

	page.set_primary_action(__("Approve & publish"), () => commit_batch(true));
	page.set_secondary_action(__("Save draft now"), () => save_draft(false));
	if (page.add_menu_item) {
		page.add_menu_item(__("Refresh matches"), () => save_and_reenrich());
		page.add_menu_item(__("Download CSV template (with samples)"), () =>
			download_text_file("kqs-stock-import-template.csv", csv_template)
		);
		page.add_menu_item(__("Download blank CSV template"), () =>
			download_text_file("kqs-stock-import-blank.csv", csv_template_blank)
		);
		page.add_menu_item(__("Export this draft as CSV"), () => export_current_draft_csv());
		page.add_menu_item(__("New draft"), () => start_new_draft());
		page.add_menu_item(__("KQS Retail Settings"), () =>
			frappe.set_route("Form", "KQS Retail Settings")
		);
	}

	function inject_bulk_import_styles() {
		$("#kqs-bulk-import-style").remove();
		$("head").append(`<style id="kqs-bulk-import-style">
			.kqs-bulk-import-form .kqs-source-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
				gap: 1rem;
				margin-bottom: 0.5rem;
			}
			.kqs-bulk-import-form .kqs-source-card {
				border: 1px solid var(--border-color, #d1d8dd);
				border-radius: 8px;
				padding: 1.1rem 1.15rem 1.25rem;
				background: var(--fg-color, #fff);
				display: flex;
				flex-direction: column;
				min-height: 220px;
			}
			.kqs-bulk-import-form .kqs-source-card h4 {
				margin: 0 0 0.35rem;
				font-size: 1.05rem;
				font-weight: 600;
			}
			.kqs-bulk-import-form .kqs-source-card .kqs-source-desc {
				color: var(--text-muted, #6c7680);
				font-size: 0.85rem;
				margin-bottom: 1rem;
				line-height: 1.4;
			}
			.kqs-bulk-import-form .kqs-dropzone {
				border: 2px dashed var(--border-color, #c8cfd5);
				border-radius: 8px;
				padding: 1.25rem 1rem;
				text-align: center;
				cursor: pointer;
				background: var(--control-bg, #f5f7fa);
				transition: border-color 0.15s, background 0.15s;
				margin-bottom: 0.85rem;
			}
			.kqs-bulk-import-form .kqs-dropzone:hover,
			.kqs-bulk-import-form .kqs-dropzone.kqs-drag {
				border-color: var(--primary, #171717);
				background: var(--bg-color, #fff);
			}
			.kqs-bulk-import-form .kqs-dropzone.kqs-disabled {
				opacity: 0.55;
				cursor: not-allowed;
			}
			.kqs-bulk-import-form .kqs-dropzone .kqs-dz-title {
				font-weight: 600;
				margin-bottom: 0.2rem;
			}
			.kqs-bulk-import-form .kqs-dropzone .kqs-dz-file {
				font-size: 0.8rem;
				color: var(--text-muted, #6c7680);
				margin-top: 0.35rem;
				word-break: break-all;
			}
			.kqs-bulk-import-form .kqs-img-previews {
				display: flex;
				flex-wrap: wrap;
				gap: 0.5rem;
				margin: 0.65rem 0 0.85rem;
				justify-content: flex-start;
			}
			.kqs-bulk-import-form .kqs-img-previews:empty {
				display: none;
			}
			.kqs-bulk-import-form .kqs-img-thumb {
				position: relative;
				width: 88px;
				border-radius: 6px;
				overflow: hidden;
				border: 1px solid var(--border-color, #d0d7de);
				background: #fff;
				cursor: zoom-in;
			}
			.kqs-bulk-import-form .kqs-img-thumb img {
				display: block;
				width: 88px;
				height: 88px;
				object-fit: cover;
			}
			.kqs-bulk-import-form .kqs-img-thumb .kqs-img-caption {
				display: block;
				font-size: 0.65rem;
				line-height: 1.2;
				padding: 0.2rem 0.3rem;
				color: var(--text-muted, #6c7680);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				max-width: 88px;
			}
			.kqs-bulk-import-form .kqs-img-thumb .kqs-img-remove {
				position: absolute;
				top: 2px;
				right: 2px;
				width: 22px;
				height: 22px;
				border: none;
				border-radius: 50%;
				background: rgba(0, 0, 0, 0.65);
				color: #fff;
				font-size: 14px;
				line-height: 1;
				cursor: pointer;
				padding: 0;
			}
			.kqs-bulk-import-form .kqs-img-thumb .kqs-img-remove:hover {
				background: rgba(180, 0, 0, 0.85);
			}
			.kqs-bulk-import-form .kqs-source-card .kqs-source-actions {
				margin-top: auto;
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
			}
			.kqs-bulk-import-form .kqs-source-card .btn-primary {
				width: 100%;
				font-weight: 600;
				padding: 0.55rem 0.75rem;
			}
			.kqs-bulk-import-form .kqs-source-links {
				font-size: 0.8rem;
				margin-top: 0.35rem;
			}
			.kqs-bulk-import-form .kqs-source-links a {
				margin-right: 0.75rem;
			}
			.kqs-bulk-import-form .kqs-ai-banner {
				font-size: 0.85rem;
				padding: 0.65rem 0.85rem;
				border-radius: 6px;
				margin-bottom: 0.85rem;
				background: var(--control-bg, #f5f7fa);
				border: 1px solid var(--border-color, #e2e6ea);
			}
			.kqs-bulk-import-form .kqs-ai-banner.ok {
				background: #eef9f1;
				border-color: #c6e6d0;
			}
			.kqs-bulk-import-form .kqs-ai-banner.warn {
				background: #fff8e8;
				border-color: #f0e0b2;
			}
			.kqs-bulk-import-form .kqs-req-missing {
				border-color: var(--red-500, #e24c4c) !important;
				background: #fff5f5 !important;
				box-shadow: inset 0 0 0 1px rgba(226, 76, 76, 0.35);
			}
			.kqs-bulk-import-form th .kqs-req {
				color: var(--red-500, #e24c4c);
			}
			.kqs-bulk-import-form .kqs-row-blocked {
				outline: 1px solid #f5c2c2;
			}
			.kqs-bulk-import-form .kqs-blockers {
				color: #fff;
				background: #c0392b;
				font-size: 0.72rem;
				font-weight: 600;
				line-height: 1.35;
				margin-top: 0.35rem;
				padding: 0.35rem 0.45rem;
				border-radius: 6px;
			}
			.kqs-bulk-import-form .kqs-summary-panel {
				border: 1px solid var(--border-color, #d1d8dd);
				border-radius: 10px;
				padding: 12px 14px;
				margin-bottom: 12px;
				background: var(--fg-color, #fff);
			}
			.kqs-bulk-import-form .kqs-summary-tools {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin: 10px 0 8px;
			}
			.kqs-bulk-import-form .kqs-summary-tools .btn {
				font-weight: 600;
				padding: 6px 12px;
				height: auto;
				line-height: 1.3;
			}
			.kqs-bulk-import-form .kqs-pill-legend {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
				gap: 6px 14px;
				margin-top: 8px;
				padding-top: 8px;
				border-top: 1px solid var(--border-color, #eef0f2);
				font-size: 0.78rem;
				color: var(--text-muted, #5b6570);
				line-height: 1.4;
			}
			.kqs-bulk-import-form .kqs-pill-legend strong {
				color: var(--text-color, #1f272e);
				font-weight: 650;
			}
			.kqs-bulk-import-form input[type=file].kqs-hidden-file {
				position: absolute;
				width: 1px;
				height: 1px;
				opacity: 0;
				overflow: hidden;
				z-index: -1;
			}
			.kqs-bulk-import-form .kqs-preview-hint {
				font-size: 0.8rem;
				color: var(--text-muted, #6c7680);
				margin: 0 0 0.5rem;
			}
			.kqs-bulk-import-form .kqs-preview-scroll {
				width: 100%;
				max-width: 100%;
				/* Near full page — sideways scrollbar stays on-screen with the pane */
				max-height: calc(100vh - 140px);
				min-height: 420px;
				overflow: auto;
				overscroll-behavior: contain;
				-webkit-overflow-scrolling: touch;
				border: 1px solid var(--border-color, #d1d8dd);
				border-radius: 8px;
				background: var(--fg-color, #fff);
				/* Own compositing layer — avoids blink/repaint thrash while scrolling */
				transform: translateZ(0);
			}
			.kqs-bulk-import-form .kqs-import-table {
				margin: 0;
				min-width: 1540px;
				width: 1540px;
				/* separate + sticky avoids blink during horizontal scroll (collapse flickers) */
				border-collapse: separate !important;
				border-spacing: 0;
				table-layout: fixed;
			}
			.kqs-bulk-import-form .kqs-import-table thead th {
				position: sticky;
				top: 0;
				z-index: 3;
				background: var(--control-bg, #f5f7fa);
				font-size: 12px;
				font-weight: 650;
				white-space: nowrap;
				padding: 0.7rem 0.85rem !important;
				vertical-align: middle;
				border-bottom: 1px solid var(--border-color, #d1d8dd);
				box-shadow: 0 1px 0 var(--border-color, #d1d8dd);
			}
			.kqs-bulk-import-form .kqs-import-table tbody td {
				padding: 0.7rem 0.85rem !important;
				vertical-align: top;
				font-size: 13px;
				background: var(--fg-color, #fff);
				border-bottom: 1px solid var(--border-color, #eef0f2);
			}
			.kqs-bulk-import-form .kqs-import-table tbody tr.kqs-row-blocked td {
				background: #fffafa;
			}
			.kqs-bulk-import-form .kqs-import-table tbody tr.text-muted td {
				background: var(--control-bg, #f8fafc);
			}
			.kqs-bulk-import-form .kqs-import-table .kqs-col-action {
				width: 200px;
				min-width: 180px;
				position: sticky;
				left: 0;
				z-index: 2;
				background: var(--fg-color, #fff);
				box-shadow: 2px 0 0 rgba(0, 0, 0, 0.06);
			}
			.kqs-bulk-import-form .kqs-import-table thead th.kqs-col-action {
				z-index: 4;
				background: var(--control-bg, #f5f7fa);
			}
			.kqs-bulk-import-form .kqs-import-table tbody tr.kqs-row-blocked td.kqs-col-action {
				background: #fff5f5;
			}
			.kqs-bulk-import-form .kqs-import-table .kqs-col-name { width: 220px; }
			.kqs-bulk-import-form .kqs-import-table .kqs-col-style { width: 170px; }
			.kqs-bulk-import-form .kqs-import-table .kqs-col-color { width: 120px; }
			.kqs-bulk-import-form .kqs-import-table .kqs-col-size { width: 100px; }
			.kqs-bulk-import-form .kqs-import-table .kqs-col-qty { width: 110px; }
			.kqs-bulk-import-form .kqs-import-table .kqs-col-price { width: 110px; }
			.kqs-bulk-import-form .kqs-import-table .kqs-col-category { width: 200px; }
			.kqs-bulk-import-form .kqs-import-table .kqs-col-match { width: 280px; }
			.kqs-bulk-import-form .kqs-row-actions {
				display: flex;
				flex-wrap: nowrap;
				align-items: center;
				gap: 4px;
				margin-top: 4px;
			}
			.kqs-bulk-import-form .kqs-row-actions .btn {
				padding: 1px 6px;
				font-size: 11px;
				line-height: 1.4;
			}
			.kqs-bulk-import-form .kqs-row-actions .kqs-remove-row {
				min-width: 22px;
				padding: 1px 5px;
				font-weight: 700;
			}
			.kqs-bulk-import-form .kqs-row-actions .btn {
				margin: 0;
			}
			.kqs-bulk-import-form tr.kqs-row-flash {
				animation: kqs-row-flash 1.6s ease;
			}
			@keyframes kqs-row-flash {
				0% { background: #fff8c5; }
				100% { background: transparent; }
			}
			.kqs-bulk-import-form .kqs-grid-footer {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 10px;
				margin-top: 12px;
				padding: 10px 12px;
				border: 1px dashed var(--border-color, #c8cfd5);
				border-radius: 8px;
				background: var(--control-bg, #f8fafc);
			}
			.kqs-bulk-import-form .kqs-import-table input.form-control,
			.kqs-bulk-import-form .kqs-import-table select.form-control {
				width: 100%;
				font-size: 13px;
				height: 34px;
				padding: 6px 10px;
			}
			.kqs-bulk-import-form .kqs-import-table .kqs-flag {
				display: inline-block;
				margin: 2px 4px 0 0;
				padding: 2px 8px;
				border-radius: 999px;
				font-size: 11px;
				font-weight: 600;
				background: #f4f1ea;
				color: #5c5346;
			}
			.kqs-bulk-import-form .kqs-flag-force_create {
				background: #e8f5ec;
				color: #1e6b3a;
			}
			.kqs-bulk-import-form .kqs-flag-needs_match_choice {
				background: #fff1e8;
				color: #9a4b12;
			}
			.kqs-bulk-import-form .kqs-linked-match {
				line-height: 1.35;
				margin-bottom: 4px;
			}
			.kqs-bulk-import-form .kqs-linked-name {
				font-weight: 600;
				font-size: 13px;
				color: var(--text-color, #1f272e);
			}
			.kqs-bulk-import-form .kqs-match-tools .btn {
				margin: 2px 4px 0 0;
			}
			.kqs-bulk-import-form .kqs-style-input {
				background: #fff;
				border: 1px solid var(--border-color, #c8cfd5);
			}
			.kqs-bulk-import-form .kqs-col-match {
				min-width: 200px;
			}
			.kqs-bulk-import-form .kqs-publish-log {
				margin-top: 12px;
				padding: 10px 12px;
				border: 1px solid var(--border-color, #d1d8dd);
				border-radius: 8px;
				background: var(--control-bg, #f8fafc);
				max-height: 280px;
				overflow: auto;
			}
			.kqs-bulk-import-form .kqs-publish-log-head {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 8px;
				margin-bottom: 6px;
			}
			.kqs-bulk-import-form .kqs-pub-section {
				margin-top: 8px;
			}
			.kqs-bulk-import-form .kqs-receive-banner {
				margin-bottom: 10px;
				padding: 8px 12px;
				border-radius: 8px;
				background: #e8f1fb;
				border: 1px solid #b5d0ef;
				color: #1a3a5c;
			}
			.kqs-bulk-import-form .kqs-receive-banner-missing {
				background: #fdecea;
				border-color: #f0b4ae;
				color: #8b1e1e;
				font-weight: 600;
			}
			.kqs-bulk-import-form .kqs-hide-done-label {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				margin: 0 0 0 8px;
				font-weight: normal;
				cursor: pointer;
			}
			.kqs-bulk-import-form .kqs-pub-log-row {
				margin: 4px 0;
				line-height: 1.35;
			}
		</style>`);
	}

	function esc(s) {
		return frappe.utils.escape_html(cstr(s));
	}
	function cstr(v) {
		return v == null ? "" : String(v);
	}

	function revoke_photo_preview_urls($root) {
		const prev = $root.data("kqsPreviewUrls") || [];
		prev.forEach((u) => {
			try {
				URL.revokeObjectURL(u);
			} catch (e) {
				/* ignore */
			}
		});
		$root.data("kqsPreviewUrls", []);
	}

	function render_photo_previews($root, files) {
		const list = Array.from(files || []).filter((f) => f && /^image\//i.test(f.type || ""));
		const $name = $root.find(".kqs-img-name");
		const $previews = $root.find(".kqs-img-previews");
		revoke_photo_preview_urls($root);

		if (!list.length) {
			$name.text(__("No photos selected"));
			$previews.empty();
			return;
		}

		$name.text(
			list.length === 1
				? list[0].name
				: __("{0} photos selected", [list.length])
		);

		const urls = [];
		const html = list
			.map((f, idx) => {
				const url = URL.createObjectURL(f);
				urls.push(url);
				return `<div class="kqs-img-thumb" title="${esc(f.name)}" data-idx="${idx}">
					<button type="button" class="kqs-img-remove" data-idx="${idx}" title="${__(
					"Remove"
				)}" aria-label="${__("Remove")}">×</button>
					<img src="${esc(url)}" alt="${esc(f.name)}" />
					<span class="kqs-img-caption">${esc(f.name)}</span>
				</div>`;
			})
			.join("");
		$root.data("kqsPreviewUrls", urls);
		$previews.html(html);
	}

	function current_pack_map() {
		return {
			box: flt(form.get_value("pack_box")) || 1,
			pack: flt(form.get_value("pack_pack")) || 1,
		};
	}

	function style_key(v) {
		return cstr(v || "")
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "");
	}

	function row_blocking_errors(r) {
		const errs = [];
		if (r.status === "applied" || r.action === "skip") return errs;
		const action = cstr(r.action || "");
		if (action === "needs_match" || !action) {
			errs.push(__("Possible existing product — Accept match, Search, or Create as new"));
			return errs;
		}
		if (!cstr(r.product_name).trim()) errs.push(__("Name is required"));
		if (!cstr(r.style_code).trim()) errs.push(__("Style number is required"));
		if (action === "create") {
			if (r.price == null || r.price === "" || flt(r.price) <= 0) {
				errs.push(__("Price is required"));
			}
			if (!cstr(r.item_group).trim()) errs.push(__("Category is required"));
			if (flt(r.qty) <= 0) errs.push(__("Qty must be greater than zero"));
			const key = style_key(r.style_code);
			if (key) {
				const siblings = (rows || []).filter(
					(x) =>
						x.status !== "applied" &&
						cstr(x.action) === "create" &&
						style_key(x.style_code) === key
				);
				if (
					siblings.length > 1 &&
					!cstr(r.color || "").trim() &&
					!cstr(r.size || "").trim()
				) {
					errs.push(__("Color or size required (same style has multiple rows)"));
				}
			}
		} else if (action === "add_variant") {
			if (!cstr(r.linked_template).trim()) errs.push(__("Link a product"));
			if (!cstr(r.color || "").trim() && !cstr(r.size || "").trim()) {
				errs.push(__("Color or size required"));
			}
			if (flt(r.qty) <= 0) errs.push(__("Qty must be greater than zero"));
		} else if (action === "receive") {
			if (!cstr(r.linked_item || r.linked_template).trim()) errs.push(__("Link a SKU"));
			if (flt(r.qty) <= 0) errs.push(__("Qty must be greater than zero"));
		}
		return errs;
	}

	function field_missing(r, field) {
		const action = cstr(r.action || "");
		if (r.status === "applied" || action === "skip") return false;
		if (field === "product_name") return !cstr(r.product_name).trim();
		if (field === "style_code") return !cstr(r.style_code).trim();
		if (field === "price") {
			return action === "create" && (r.price == null || r.price === "" || flt(r.price) <= 0);
		}
		if (field === "item_group") {
			return action === "create" && !cstr(r.item_group).trim();
		}
		if (field === "qty") {
			return (
				(action === "create" || action === "add_variant" || action === "receive") &&
				flt(r.qty) <= 0
			);
		}
		if (field === "color" || field === "size") {
			const has_color = !!cstr(r.color || "").trim();
			const has_size = !!cstr(r.size || "").trim();
			if (has_color || has_size) return false;
			if (action === "add_variant") return true;
			if (action === "create") {
				const key = style_key(r.style_code);
				if (!key) return false;
				const siblings = (rows || []).filter(
					(x) =>
						x.status !== "applied" &&
						cstr(x.action) === "create" &&
						style_key(x.style_code) === key
				);
				return siblings.length > 1;
			}
		}
		return false;
	}

	function req_class(r, field) {
		return field_missing(r, field) ? "kqs-req-missing" : "";
	}

	function fix_howto(detail) {
		const d = cstr(detail).toLowerCase();
		if (d.indexOf("accept") >= 0 || d.indexOf("needs match") >= 0 || d.indexOf("possible existing") >= 0) {
			return __("In Match column: click Use…, or Search / change…, or Create as new.");
		}
		if (d.indexOf("price") >= 0) {
			return __("Type a price greater than 0 in the Price column.");
		}
		if (d.indexOf("category") >= 0 || d.indexOf("item group") >= 0) {
			return __("Pick a category (or use Fill empty categories from default).");
		}
		if (d.indexOf("name is required") >= 0) {
			return __("Fill in the Name column.");
		}
		if (d.indexOf("style") >= 0 && d.indexOf("required") >= 0) {
			return __("Fill in the Style column.");
		}
		if (d.indexOf("qty") >= 0 || d.indexOf("quantity") >= 0) {
			return __("Enter qty greater than 0.");
		}
		if (d.indexOf("color or size") >= 0) {
			return __("Fill Color and/or Size for each variant row of this style.");
		}
		if (d.indexOf("already published") >= 0) {
			return __("No fix needed — already live.");
		}
		return "";
	}

	function action_chip(action, status) {
		if (cstr(status) === "applied") {
			return `<span class="indicator-pill green" title="${__(
				"Already published from this draft — Approve will not add again"
			)}">${__("Published")}</span>`;
		}
		if (cstr(status) === "error") {
			return `<span class="indicator-pill red" title="${__(
				"Last publish failed — fix and Approve again"
			)}">${__("Failed")}</span>`;
		}
		const map = {
			create: ["blue", __("Create")],
			receive: ["green", __("Add stock")],
			add_variant: ["orange", __("Add variant")],
			needs_match: ["red", __("Needs match")],
			skip: ["gray", __("Skip")],
		};
		const [color, label] = map[action] || ["gray", action || "—"];
		return `<span class="indicator-pill ${color}">${esc(label)}</span>`;
	}

	function download_text_file(filename, content) {
		if (!content) {
			frappe.msgprint(__("Template not loaded yet — wait a moment and try again."));
			return;
		}
		const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	function schedule_autosave() {
		if (!batch || !rows.length) return;
		if (commit_busy) return;
		// Style/name rematch already saves the draft — don't pile a second write on top.
		if (rematch_timer || rematch_busy) return;
		if (autosave_timer) clearTimeout(autosave_timer);
		autosave_timer = setTimeout(() => save_draft(true), 2500);
	}

	function schedule_rematch(focus_row_id) {
		if (!batch || !rows.length) return;
		rematch_focus_row_id = focus_row_id || rematch_focus_row_id;
		// Cancel pending autosave — rematch will persist rows in one request.
		if (autosave_timer) {
			clearTimeout(autosave_timer);
			autosave_timer = null;
		}
		if (rematch_timer) clearTimeout(rematch_timer);
		rematch_timer = setTimeout(() => run_rematch(), 900);
	}

	function run_rematch() {
		rematch_timer = null;
		if (!batch || !rows.length) return;
		if (autosave_busy || rematch_busy) {
			// Wait for the in-flight draft write, then retry once.
			rematch_timer = setTimeout(() => run_rematch(), 450);
			return;
		}
		rematch_busy = true;
		const focus_row_id = rematch_focus_row_id;
		rematch_focus_row_id = null;
		const snapshot = JSON.parse(JSON.stringify(rows));
		frappe.call({
			method: "kqs_retail.api.bulk_import.rematch_batch",
			args: {
				batch_name: batch,
				rows_json: JSON.stringify(snapshot),
			},
			callback(r) {
				rematch_busy = false;
				last_saved_at = frappe.datetime.now_time();
				if (!r.message || !r.message.rows) return;
				// Merge match metadata only — never drop newer local edits.
				const by_id = {};
				(r.message.rows || []).forEach((sr) => {
					by_id[sr.row_id] = sr;
				});
				rows = (rows || []).map((local) => {
					const sr = by_id[local.row_id];
					if (!sr) return local;
					return Object.assign({}, local, {
						action: sr.action,
						match_candidates: sr.match_candidates,
						linked_template: cint(local._force_create)
							? ""
							: sr.linked_template || local.linked_template,
						linked_item: sr.linked_item,
						linked_item_name: sr.linked_item_name,
						linked_style_code: sr.linked_style_code,
						flags: sr.flags,
						error: sr.error,
						_force_create: local._force_create,
						_link_confirmed: cint(local._force_create) ? 0 : sr._link_confirmed,
						status: local.status === "applied" ? "applied" : sr.status || local.status,
					});
				});
				render_grid_preserving_view(focus_row_id || null, null);
				render_summary();
			},
			error(err) {
				rematch_busy = false;
				const msg = cstr((err && (err.message || err.exc)) || "");
				if (/deadlock|concurrent|lock wait/i.test(msg)) {
					frappe.show_alert({
						message: __("Still saving — edit again in a moment if matches look stale."),
						indicator: "orange",
					});
					return;
				}
				frappe.show_alert({
					message: __("Could not refresh matches — try again"),
					indicator: "orange",
				});
			},
		});
	}

	function save_draft(silent) {
		if (!batch) {
			if (!silent) frappe.msgprint(__("Load a CSV or paper extract first to create a draft."));
			return;
		}
		if (commit_busy) return;
		if (rematch_busy || rematch_timer) {
			// Rematch owns the next save; defer plain autosave.
			if (!silent) {
				frappe.show_alert({
					message: __("Finishing match refresh first…"),
					indicator: "blue",
				});
			}
			if (autosave_timer) clearTimeout(autosave_timer);
			autosave_timer = setTimeout(() => save_draft(silent), 600);
			return;
		}
		if (autosave_busy) return;
		autosave_busy = true;
		frappe.call({
			method: "kqs_retail.api.bulk_import.update_batch",
			args: {
				batch_name: batch,
				rows_json: JSON.stringify(collect_rows_from_dom()),
				warehouse: form.get_value("warehouse"),
				pack_map_json: JSON.stringify(current_pack_map()),
				re_enrich: 0,
			},
			callback(r) {
				autosave_busy = false;
				last_saved_at = frappe.datetime.now_time();
				if (r.message) {
					batch = r.message.name || batch;
					// Silent autosave must not replace in-memory rows (wipes mid-edit / races rematch).
					if (!silent && r.message.rows) rows = r.message.rows;
				}
				render_summary();
				if (!silent) {
					load_drafts_list();
					frappe.show_alert({ message: __("Draft saved"), indicator: "green" });
				}
			},
			error(err) {
				autosave_busy = false;
				const msg = cstr((err && (err.message || err.exc)) || "");
				if (/deadlock|concurrent|lock wait/i.test(msg)) {
					frappe.show_alert({
						message: __("Draft busy — saved again automatically."),
						indicator: "orange",
					});
					if (autosave_timer) clearTimeout(autosave_timer);
					autosave_timer = setTimeout(() => save_draft(true), 800);
					return;
				}
				if (!silent) {
					frappe.show_alert({ message: __("Could not save draft"), indicator: "red" });
				}
			},
		});
	}

	function capture_preview_scroll() {
		const main = form.get_field("preview_grid").$wrapper.find(".kqs-preview-scroll")[0];
		return {
			top: main ? main.scrollTop : 0,
			left: main ? main.scrollLeft : 0,
			winY: window.scrollY || window.pageYOffset || 0,
			winX: window.scrollX || window.pageXOffset || 0,
		};
	}

	function restore_preview_scroll(pos) {
		if (!pos) return;
		const apply = () => {
			const main = form.get_field("preview_grid").$wrapper.find(".kqs-preview-scroll")[0];
			if (main) {
				main.scrollTop = pos.top;
				main.scrollLeft = pos.left;
			}
			if (pos.winY != null || pos.winX != null) {
				window.scrollTo(pos.winX || 0, pos.winY || 0);
			}
		};
		apply();
		// Re-apply after layout (table rebuild can shift page height).
		requestAnimationFrame(apply);
		setTimeout(apply, 0);
	}

	function find_row_by_id(row_id) {
		const id = cstr(row_id);
		return (rows || []).find((x) => cstr(x.row_id) === id) || null;
	}

	function btn_data_row($btn) {
		// Prefer attr — jQuery .data() coerces values and can break UUID/string ids.
		return cstr($btn.attr("data-row") || $btn.data("row") || "");
	}

	function flash_row(focus_row_id, focus_field) {
		if (!focus_row_id) return;
		const $grid = form.get_field("preview_grid").$wrapper;
		const $tr = $grid.find("tr[data-row-id]").filter(function () {
			return cstr($(this).attr("data-row-id")) === cstr(focus_row_id);
		});
		if (!$tr.length) return;
		$tr.removeClass("kqs-row-flash");
		void $tr[0].offsetWidth;
		$tr.addClass("kqs-row-flash");
		try {
			$tr[0].scrollIntoView({ block: "nearest", inline: "nearest" });
		} catch (e) {
			/* ignore */
		}
		if (focus_field) {
			const $inp = $tr.find(`.kqs-f[data-f='${focus_field}']`);
			if ($inp.length) {
				$inp.trigger("focus");
				const el = $inp[0];
				if (el && typeof el.setSelectionRange === "function" && el.value != null) {
					const n = String(el.value).length;
					try {
						el.setSelectionRange(n, n);
					} catch (err) {
						/* ignore */
					}
				}
			}
		}
	}

	function render_grid_preserving_view(focus_row_id, focus_field) {
		const pos = capture_preview_scroll();
		render_grid();
		restore_preview_scroll(pos);
		flash_row(focus_row_id, focus_field);
	}

	function apply_force_create_locally(row_id) {
		const row = find_row_by_id(row_id);
		if (!row) return false;
		row.action = "create";
		row._force_create = 1;
		row._link_confirmed = 0;
		row.linked_template = "";
		row.linked_item = "";
		row.match_candidates = [];
		row.error = "";
		const drop = {
			needs_match_choice: 1,
			needs_match: 1,
			missing_variant_attrs: 1,
		};
		const keep = (row.flags || []).filter((f) => f && !drop[f]);
		row.flags = Array.from(new Set(keep.concat(["force_create"]))).sort();
		return true;
	}

	function apply_field_edit($input) {
		const $tr = $input.closest("tr");
		const idx = cint($tr.data("idx"));
		if (idx < 0 || !rows[idx]) return null;
		const field = $input.data("f");
		let val = $input.val();
		if (field === "qty" || field === "price") val = val === "" ? null : flt(val);
		rows[idx][field] = val;
		if (field === "qty") rows[idx]._qty_edited = 1;
		if (field === "product_name") {
			rows[idx].name_raw = val;
			rows[idx]._spelling_locked = 1;
		}
		if (field === "style_code") {
			rows[idx].style_raw = val;
			rows[idx]._spelling_locked = 1;
		}
		if (field === "color") rows[idx].color_raw = val;
		if (field === "size") {
			rows[idx].size_raw = val;
			rows[idx]._qty_edited = rows[idx]._qty_edited || 1;
		}
		return { idx, field, row_id: rows[idx].row_id };
	}

	function refresh_row_validation(idx) {
		const $grid = form.get_field("preview_grid").$wrapper;
		const $tr = $grid.find(`tr[data-idx="${idx}"]`);
		if (!$tr.length || !rows[idx]) return;
		const r = rows[idx];
		["product_name", "style_code", "color", "size", "qty", "price", "item_group"].forEach((f) => {
			const missing = field_missing(r, f);
			if (f === "item_group") {
				$tr.find(".kqs-col-category > div").toggleClass("kqs-req-missing", missing);
			} else {
				$tr.find(`.kqs-f[data-f='${f}']`).toggleClass("kqs-req-missing", missing);
			}
		});
		const blockers = row_blocking_errors(r);
		$tr.toggleClass("kqs-row-blocked", blockers.length > 0);
		let $b = $tr.find(".kqs-blockers");
		if (blockers.length) {
			if (!$b.length) {
				$tr.find(".kqs-col-action").append(`<div class="kqs-blockers"></div>`);
				$b = $tr.find(".kqs-blockers");
			}
			$b.text(blockers.join(" · "));
		} else {
			$b.remove();
		}
	}

	function load_drafts_list() {
		frappe.call({
			method: "kqs_retail.api.bulk_import.list_import_batches",
			args: { limit: 20 },
			callback(r) {
				render_drafts(r.message || []);
			},
		});
	}

	function render_drafts(list) {
		const $el = form.get_field("drafts_panel").$wrapper;
		if (!list.length) {
			$el.html(
				`<p class="text-muted small mb-3">${__(
					"No open drafts yet. Upload a CSV or photo — or use Add product row below. Drafts auto-save so you can resume after a reload."
				)}</p>`
			);
			return;
		}
		const rows_html = list
			.map((d) => {
				const active = d.name === batch ? "btn-primary" : "btn-default";
				return `<tr>
					<td><strong>${esc(d.name)}</strong>
						<div class="text-muted small">${esc(d.source_type)} · ${esc(d.status)} · ${cint(d.row_count)} ${__(
					"rows"
				)}</div>
					</td>
					<td class="text-muted small">${esc(d.warehouse || "")}<br>${esc(d.modified || "")}</td>
					<td class="text-right" style="white-space:nowrap;">
						<button type="button" class="btn btn-xs ${active} kqs-open-draft" data-name="${esc(
					d.name
				)}">${d.name === batch ? __("Current") : __("Continue")}</button>
						<button type="button" class="btn btn-xs btn-danger kqs-delete-draft" data-name="${esc(
					d.name
				)}" title="${__("Delete draft")}">${__("Delete")}</button>
					</td>
				</tr>`;
			})
			.join("");
		$el.html(`
			<div class="mb-3">
				<label class="control-label">${__("Open drafts — Continue or Delete to start fresh")}</label>
				<div class="table-responsive">
					<table class="table table-condensed table-bordered mb-0">
						<tbody>${rows_html}</tbody>
					</table>
				</div>
			</div>
		`);
		$el.find(".kqs-open-draft").on("click", function () {
			const name = $(this).data("name");
			frappe.call({
				method: "kqs_retail.api.bulk_import.get_batch",
				args: { batch_name: name },
				freeze: true,
				callback(rr) {
					if (rr.message) {
						load_batch_into_state(rr.message);
						frappe.show_alert({
							message: __("Draft {0} loaded", [name]),
							indicator: "blue",
						});
					}
				},
			});
		});
		$el.find(".kqs-delete-draft").on("click", function () {
			const name = $(this).data("name");
			frappe.confirm(__("Delete draft {0}? This cannot be undone.", [name]), () => {
				frappe.call({
					method: "kqs_retail.api.bulk_import.delete_import_batch",
					args: { batch_name: name },
					freeze: true,
					callback() {
						if (batch === name) {
							batch = null;
							rows = [];
							last_saved_at = null;
							render_summary();
							render_grid();
						}
						load_drafts_list();
						frappe.show_alert({
							message: __("Draft deleted"),
							indicator: "orange",
						});
					},
				});
			});
		});
	}

	function start_new_draft() {
		batch = null;
		rows = [];
		last_saved_at = null;
		render_summary();
		render_grid();
		load_drafts_list();
		frappe.show_alert({
			message: __("Cleared. Upload CSV/photo, or Add product row to start a blank draft."),
			indicator: "blue",
		});
	}

	function remember_warehouse(wh) {
		wh = cstr(wh || "").trim();
		if (!wh) return;
		try {
			localStorage.setItem("kqs_last_receive_warehouse", wh);
		} catch (e) {
			/* ignore */
		}
	}

	function last_remembered_warehouse() {
		try {
			return cstr(localStorage.getItem("kqs_last_receive_warehouse") || "").trim();
		} catch (e) {
			return "";
		}
	}

	function prompt_choose_warehouse(done) {
		const remembered = last_remembered_warehouse();
		const d = new frappe.ui.Dialog({
			title: __("Which branch receives this stock?"),
			fields: [
				{
					fieldname: "warehouse",
					fieldtype: "Link",
					options: "Warehouse",
					label: __("Receive into (branch)"),
					reqd: 1,
					default: remembered || form.get_value("warehouse") || "",
					description: __(
						"Pick the store or Central that should own this import. Confirm carefully — stock lands here on Approve."
					),
					get_query() {
						return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
					},
				},
			],
			primary_action_label: __("Use this branch"),
			primary_action(values) {
				const wh = cstr(values.warehouse || "").trim();
				if (!wh) {
					frappe.msgprint(__("Select a warehouse / branch."));
					return;
				}
				remember_warehouse(wh);
				form.set_value("warehouse", wh).then(() => {
					d.hide();
					if (typeof done === "function") done(wh);
				});
			},
		});
		d.show();
	}

	function ensure_warehouse_chosen(done) {
		const wh = cstr(form.get_value("warehouse") || "").trim();
		if (wh) {
			remember_warehouse(wh);
			if (typeof done === "function") done(wh);
			return;
		}
		prompt_choose_warehouse(done);
	}

	function ensure_batch_then(done) {
		ensure_warehouse_chosen(() => {
			if (batch) {
				done();
				return;
			}
			frappe.call({
				method: "kqs_retail.api.bulk_import.create_empty_batch",
				args: {
					warehouse: form.get_value("warehouse") || "",
				},
				freeze: true,
				callback(r) {
					if (!r.message) return;
					load_batch_into_state(r.message);
					load_drafts_list();
					done();
				},
			});
		});
	}

	function append_manual_row(mode, from_row_id) {
		ensure_batch_then(() => {
			const payload =
				mode === "variant"
					? [{ from_row_id: from_row_id || "" }]
					: [
							{
								product_name: "",
								style_code: "",
								qty: 1,
								item_group: form.get_value("default_item_group") || "",
							},
					  ];
			frappe.call({
				method: "kqs_retail.api.bulk_import.append_draft_rows",
				args: {
					batch_name: batch,
					rows_json: JSON.stringify(payload),
					mode: mode || "blank",
				},
				freeze: true,
				callback(r) {
					if (!r.message) return;
					const focus_id = (r.message.added_row_ids || [])[0] || "";
					load_batch_into_state(r.message);
					frappe.show_alert({
						message:
							mode === "variant"
								? __("Color/size row added under this style — fill color & size")
								: __("Product row added at the bottom — fill name, style, price, category"),
						indicator: "green",
					});
					if (focus_id) {
						setTimeout(() => focus_draft_row(focus_id, mode !== "variant"), 80);
					}
				},
			});
		});
	}

	function remove_manual_row(row_id) {
		if (!batch || !row_id) return;
		const row = (rows || []).find((x) => x.row_id === row_id);
		if (!row) return;
		if (cstr(row.status) === "applied") {
			frappe.msgprint(__("Published rows cannot be removed."));
			return;
		}
		const label = [row.product_name, row.style_code, row.color, row.size]
			.filter(Boolean)
			.join(" · ");
		frappe.confirm(__("Remove this row from the draft?{0}", [label ? `<br><strong>${esc(label)}</strong>` : ""]), () => {
			frappe.call({
				method: "kqs_retail.api.bulk_import.remove_draft_rows",
				args: {
					batch_name: batch,
					row_ids_json: JSON.stringify([row_id]),
				},
				freeze: true,
				callback(r) {
					if (r.message) {
						load_batch_into_state(r.message);
						frappe.show_alert({ message: __("Row removed"), indicator: "orange" });
					}
				},
			});
		});
	}

	function focus_draft_row(row_id, prefer_bottom_btn) {
		const $grid = form.get_field("preview_grid").$wrapper;
		const want = String(row_id || "");
		const $tr = $grid.find("tr[data-row-id]").filter(function () {
			return String($(this).attr("data-row-id") || "") === want;
		});
		if (!$tr.length) {
			if (prefer_bottom_btn) {
				const el = $grid.find(".kqs-add-product-row")[0];
				if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
			}
			return;
		}
		$tr.addClass("kqs-row-flash");
		const node = $tr[0];
		if (node && node.scrollIntoView) {
			node.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
		const $color = $tr.find("input.kqs-f[data-f='color']");
		const $name = $tr.find("input.kqs-f[data-f='product_name']");
		const $focus = $color.length && !$color.val() ? $color : $name.length ? $name : $color;
		if ($focus.length) $focus.trigger("focus");
	}

	function export_current_draft_csv() {
		if (!batch) {
			frappe.msgprint(__("No draft loaded."));
			return;
		}
		save_draft(true);
		frappe.call({
			method: "kqs_retail.api.bulk_import.export_batch_csv",
			args: { batch_name: batch },
			callback(r) {
				if (!r.message) return;
				download_text_file(r.message.filename, r.message.content);
			},
		});
	}

	function render_source_panel() {
		const $el = form.get_field("source_panel").$wrapper;
		const hint = settings_hint || __("Desk → KQS Retail Settings → Bulk Import AI");
		const ai_banner = ai_info.configured
			? `<div class="kqs-ai-banner ok">${__("Paper AI ready")}: <strong>${esc(
					ai_info.provider
			  )}</strong> (${esc(ai_info.model || "")})
				· <a href="/app/kqs-retail-settings">${__("Settings")}</a></div>`
			: `<div class="kqs-ai-banner warn">${__(
					"Paper scan needs an AI key — CSV import works without it."
			  )}
				<a href="/app/kqs-retail-settings"><strong>${__("Open KQS Retail Settings")}</strong></a>
				<span class="text-muted"> · ${esc(hint)}</span></div>`;

		const paper_disabled = ai_info.configured ? "" : "kqs-disabled";
		const paper_attrs = ai_info.configured ? "" : "disabled";

		$el.html(`
			${ai_banner}
			<div class="kqs-source-grid">
				<div class="kqs-source-card" data-mode="csv">
					<h4>${__("From CSV / spreadsheet")}</h4>
					<p class="kqs-source-desc">${__(
						"Best for moving a full catalogue from another system. Download the template, fill it, then drop the file here."
					)}</p>
					<input type="file" class="kqs-hidden-file kqs-csv-file" accept=".csv,text/csv,.txt" />
					<div class="kqs-dropzone kqs-csv-drop" tabindex="0" role="button">
						<div class="kqs-dz-title">${__("Click or drop your CSV here")}</div>
						<div class="text-muted small">${__("name, style, size, color, qty, price…")}</div>
						<div class="kqs-dz-file kqs-csv-name">${__("No file selected")}</div>
					</div>
					<div class="kqs-source-actions">
						<button type="button" class="btn btn-primary kqs-parse-csv">${__(
							"Parse CSV into draft"
						)}</button>
						<div class="kqs-source-links">
							<a href="#" class="kqs-dl-template">${__("Template with samples")}</a>
							<a href="#" class="kqs-dl-blank">${__("Blank template")}</a>
						</div>
					</div>
				</div>
				<div class="kqs-source-card" data-mode="paper">
					<h4>${__("From paper photo")}</h4>
					<p class="kqs-source-desc">${__(
						"Photograph a handwritten stock list. AI fills the draft — you still review before publish."
					)}</p>
					<input type="file" class="kqs-hidden-file kqs-img-file" accept="image/*" multiple ${paper_attrs} />
					<div class="kqs-dropzone kqs-img-drop ${paper_disabled}" tabindex="0" role="button">
						<div class="kqs-dz-title">${
							ai_info.configured
								? __("Click or drop photos here")
								: __("Configure AI to enable photos")
						}</div>
						<div class="text-muted small">${__("One or more pages")}</div>
						<div class="kqs-dz-file kqs-img-name">${__("No photos selected")}</div>
					</div>
					<div class="kqs-img-previews" aria-live="polite"></div>
					<div class="kqs-source-actions">
						<button type="button" class="btn btn-primary kqs-extract-images" ${paper_attrs}>${__(
							"Extract with AI → draft"
						)}</button>
					</div>
				</div>
			</div>
		`);

		const $csvInput = $el.find(".kqs-csv-file");
		const $imgInput = $el.find(".kqs-img-file");

		function bind_dropzone($zone, $input, on_files) {
			$zone.on("click", () => {
				if ($zone.hasClass("kqs-disabled")) return;
				$input.trigger("click");
			});
			$zone.on("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					$zone.trigger("click");
				}
			});
			$zone.on("dragover", (e) => {
				e.preventDefault();
				if (!$zone.hasClass("kqs-disabled")) $zone.addClass("kqs-drag");
			});
			$zone.on("dragleave drop", (e) => {
				e.preventDefault();
				$zone.removeClass("kqs-drag");
				if (e.type === "drop" && !$zone.hasClass("kqs-disabled")) {
					const files = e.originalEvent.dataTransfer.files;
					if (!files || !files.length) return;
					on_files(Array.from(files));
					if (files.length === 1 && $input[0]) {
						const dt = new DataTransfer();
						dt.items.add(files[0]);
						$input[0].files = dt.files;
					} else if ($input[0]) {
						const dt = new DataTransfer();
						Array.from(files).forEach((f) => dt.items.add(f));
						$input[0].files = dt.files;
					}
				}
			});
			$input.on("change", () => {
				const files = Array.from($input[0].files || []);
				on_files(files);
			});
		}

		bind_dropzone($el.find(".kqs-csv-drop"), $csvInput, (files) => {
			$el.find(".kqs-csv-name").text(files[0] ? files[0].name : __("No file selected"));
		});
		bind_dropzone($el.find(".kqs-img-drop"), $imgInput, (files) => {
			render_photo_previews($el, files);
		});

		$el.on("click", ".kqs-img-remove", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const idx = cint($(this).data("idx"));
			const input = $imgInput[0];
			if (!input || !input.files) return;
			const dt = new DataTransfer();
			Array.from(input.files).forEach((f, i) => {
				if (i !== idx) dt.items.add(f);
			});
			input.files = dt.files;
			render_photo_previews($el, Array.from(input.files));
		});

		$el.on("click", ".kqs-img-thumb img, .kqs-img-thumb .kqs-img-caption", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const src = $(this).closest(".kqs-img-thumb").find("img").attr("src");
			const name = $(this).closest(".kqs-img-thumb").attr("title") || __("Photo");
			if (!src) return;
			const d = new frappe.ui.Dialog({
				title: name,
				size: "large",
				primary_action_label: __("Close"),
				primary_action() {
					d.hide();
				},
			});
			d.$body.html(
				`<div style="text-align:center;"><img src="${esc(
					src
				)}" alt="${esc(name)}" style="max-width:100%;max-height:70vh;border-radius:6px;"/></div>`
			);
			d.show();
		});

		$el.find(".kqs-dl-template").on("click", (e) => {
			e.preventDefault();
			download_text_file("kqs-stock-import-template.csv", csv_template);
		});
		$el.find(".kqs-dl-blank").on("click", (e) => {
			e.preventDefault();
			download_text_file("kqs-stock-import-blank.csv", csv_template_blank);
		});

		$el.find(".kqs-parse-csv").on("click", () => {
			const input = $csvInput[0];
			if (!input.files || !input.files[0]) {
				frappe.msgprint(__("Choose a CSV file first — click the drop zone above."));
				return;
			}
			ensure_warehouse_chosen(() => {
				const reader = new FileReader();
				reader.onload = () => {
					frappe.call({
						method: "kqs_retail.api.bulk_import.create_batch_from_csv",
						args: {
							csv_content: reader.result,
							warehouse: form.get_value("warehouse"),
							pack_map_json: JSON.stringify(current_pack_map()),
							default_item_group: form.get_value("default_item_group") || "",
						},
						freeze: true,
						freeze_message: __("Parsing CSV…"),
						callback(r) {
							if (!r.message) return;
							apply_batch_payload(r.message);
							load_drafts_list();
							frappe.show_alert({
								message: __("Draft ready — review then Approve & publish"),
								indicator: "green",
							});
						},
					});
				};
				reader.readAsText(input.files[0]);
			});
		});

		$el.find(".kqs-extract-images").on("click", () => {
			const input = $imgInput[0];
			if (!ai_info.configured) {
				frappe.msgprint({
					title: __("AI not configured"),
					message: __(
						"Add an API key under KQS Retail Settings → Bulk Import AI, or use CSV import."
					),
					indicator: "orange",
				});
				return;
			}
			if (!input.files || !input.files.length) {
				frappe.msgprint(__("Choose at least one photo — click the drop zone above."));
				return;
			}
			ensure_warehouse_chosen(() => upload_images_then_extract(Array.from(input.files)));
		});
	}

	function upload_images_then_extract(files) {
		uploaded_file_urls = [];
		const upload_one = (file) =>
			new Promise((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				const fd = new FormData();
				fd.append("file", file, file.name);
				fd.append("is_private", 1);
				fd.append("folder", "Home");
				xhr.open("POST", "/api/method/upload_file");
				xhr.setRequestHeader("X-Frappe-CSRF-Token", frappe.csrf_token);
				xhr.onload = () => {
					try {
						const res = JSON.parse(xhr.responseText);
						if (res.message && res.message.file_url) {
							resolve(res.message.file_url);
						} else {
							reject(res._error_message || res.message || "upload failed");
						}
					} catch (e) {
						reject(e);
					}
				};
				xhr.onerror = reject;
				xhr.send(fd);
			});

		frappe.dom.freeze(__("Uploading images…"));
		Promise.all(files.map(upload_one))
			.then((urls) => {
				uploaded_file_urls = urls;
				return frappe.call({
					method: "kqs_retail.api.bulk_import.create_batch_from_images",
					args: {
						file_urls: JSON.stringify(urls),
						warehouse: form.get_value("warehouse"),
						pack_map_json: JSON.stringify(current_pack_map()),
						default_item_group: form.get_value("default_item_group") || "",
					},
				});
			})
			.then((r) => {
				frappe.dom.unfreeze();
				if (!r.message) return;
				apply_batch_payload(r.message);
				load_drafts_list();
				frappe.show_alert({ message: __("AI extract saved as draft"), indicator: "green" });
			})
			.catch((err) => {
				frappe.dom.unfreeze();
				frappe.msgprint({
					title: __("Extract failed"),
					message: cstr(err.message || err),
					indicator: "red",
				});
			});
	}

	function apply_batch_payload(msg) {
		batch = msg.batch || (msg.name ? msg.name : batch);
		if (msg.rows) rows = msg.rows;
		if (msg.warehouse) form.set_value("warehouse", msg.warehouse);
		if (msg.pack_map) {
			pack_map = msg.pack_map;
			form.set_value("pack_box", pack_map.box || 1);
			form.set_value("pack_pack", pack_map.pack || 1);
		}
		if (msg.name && msg.rows) {
			batch = msg.name;
			rows = msg.rows;
			if (msg.warehouse) form.set_value("warehouse", msg.warehouse);
			if (msg.pack_map) {
				pack_map = msg.pack_map;
				form.set_value("pack_box", pack_map.box || 1);
				form.set_value("pack_pack", pack_map.pack || 1);
			}
		}
		render_summary();
		render_grid();
	}

	function load_batch_into_state(data, focus_row_id) {
		const pos = capture_preview_scroll();
		batch = data.name;
		rows = data.rows || [];
		pack_map = data.pack_map || pack_map;
		last_publish_result = data.result || last_publish_result;
		if (data.warehouse) {
			form.set_value("warehouse", data.warehouse);
			remember_warehouse(data.warehouse);
		}
		form.set_value("pack_box", (pack_map && pack_map.box) || 1);
		form.set_value("pack_pack", (pack_map && pack_map.pack) || 1);
		render_summary();
		render_grid();
		restore_preview_scroll(pos);
		flash_row(focus_row_id || null, null);
	}

	function publish_log_html(result) {
		const log = (result && result.log) || [];
		if (!log.length) return "";
		const sum = (result && result.summary) || {};
		const at = esc(sum.at || "");
		const wh = esc(sum.warehouse || (result && result.warehouse) || form.get_value("warehouse") || "");
		const needs = log.filter(
			(e) => e.outcome === "failed" || (e.outcome === "skipped" && cint(e.needs_fix))
		);
		const done_ok = log.filter((e) => e.outcome === "succeeded");
		const already = log.filter(
			(e) => e.outcome === "skipped" && !cint(e.needs_fix)
		);
		const open_link = (e) => {
			const code = cstr(e.open_item || e.item_code || (e.item_codes && e.item_codes[0]) || e.template || "");
			if (!code) return "";
			return ` <a href="/app/item/${encodeURIComponent(code)}" target="_blank" rel="noopener">${__(
				"Open Item"
			)}</a>`;
		};
		const line = (e, pill) => {
			const label = [e.name, e.style, e.color].filter(Boolean).map(esc).join(" · ");
			const sku = cstr(e.item_code || (e.item_codes && e.item_codes[0]) || "");
			const sku_bit = sku ? ` <code>${esc(sku)}</code>` : "";
			return `<div class="kqs-pub-log-row">${pill}
				<strong>${label || esc(e.row_id)}</strong>${sku_bit}
				<span class="text-muted"> — ${esc(e.detail || "")}</span>${open_link(e)}
			</div>`;
		};
		const fix_block = needs.length
			? `<div class="kqs-pub-section">
				<div class="font-weight-bold text-danger">${__("Needs a fix (then Approve again)")}</div>
				${needs
					.slice(0, 30)
					.map((e) =>
						line(
							e,
							e.outcome === "failed"
								? `<span class="indicator-pill red">${__("Failed")}</span>`
								: `<span class="indicator-pill orange">${__("Fix")}</span>`
						)
					)
					.join("")}
			</div>`
			: `<div class="text-success small">${__("Nothing left that needs a fix from the last publish.")}</div>`;
		const ok_block = done_ok.length
			? `<div class="kqs-pub-section">
				<div class="font-weight-bold text-success">${__("Published OK this run")} (${done_ok.length})</div>
				${done_ok
					.slice(0, 40)
					.map((e) => line(e, `<span class="indicator-pill green">${__("OK")}</span>`))
					.join("")}
			</div>`
			: "";
		const already_block = already.length
			? `<div class="kqs-pub-section text-muted small">
				${__("Already done earlier ({0}) — no action needed, will not duplicate", [already.length])}
				${already
					.slice(0, 15)
					.map((e) => line(e, `<span class="indicator-pill gray">${__("Done")}</span>`))
					.join("")}
			</div>`
			: "";
		const find_hint = `<p class="text-muted small mb-0 mt-2">${__(
			"To find products under Items: search by style number (e.g. 6308), not color alone. If the list is filtered to Stock at another branch, clear that filter or open All catalog — stock only shows at the receive warehouse above."
		)}</p>`;
		return `<div class="kqs-publish-log">
			<div class="kqs-publish-log-head">
				<strong>${__("Last publish log")}</strong>
				${at ? `<span class="text-muted small">${at}</span>` : ""}
				${wh ? `<span class="indicator-pill blue">${__("Received into")} ${wh}</span>` : ""}
				<span class="indicator-pill green">${__("OK")} ${cint(sum.succeeded)}</span>
				<span class="indicator-pill orange">${__("Fix")} ${needs.length}</span>
				<span class="indicator-pill gray">${__("Already done")} ${already.length}</span>
			</div>
			${fix_block}${ok_block}${already_block}${find_hint}
		</div>`;
	}

	function counts() {
		const c = {
			create: 0,
			receive: 0,
			add_variant: 0,
			needs_match: 0,
			skip: 0,
			applied: 0,
			blocked: 0,
			ready: 0,
		};
		(rows || []).forEach((r) => {
			if (r.status === "applied") c.applied += 1;
			else if (c[r.action] != null) c[r.action] += 1;
			if (r.status !== "applied" && r.action !== "skip") {
				const b = row_blocking_errors(r);
				if (b.length) c.blocked += 1;
				else c.ready += 1;
			}
		});
		return c;
	}

	function category_select_html(selected, disabled) {
		const cur = cstr(selected || "");
		const opts = [`<option value="">${__("— Select category —")}</option>`]
			.concat(
				(category_options || []).map((g) => {
					const sel = g.name === cur ? "selected" : "";
					return `<option value="${esc(g.name)}" ${sel}>${esc(g.name)}</option>`;
				})
			)
			.join("");
		// Keep typed value even if not in list yet
		const extra =
			cur && !(category_options || []).some((g) => g.name === cur)
				? `<option value="${esc(cur)}" selected>${esc(cur)}</option>`
				: "";
		return `<select class="form-control input-sm kqs-f kqs-cat" data-f="item_group" ${disabled}>${extra}${opts}</select>`;
	}

	function apply_default_category_to_empty() {
		const def = form.get_value("default_item_group") || "";
		if (!def) {
			frappe.msgprint(__("Pick a Default category first."));
			return;
		}
		let n = 0;
		(rows || []).forEach((r) => {
			if (r.status === "applied") return;
			if (!cstr(r.item_group).trim()) {
				r.item_group = def;
				n += 1;
			}
		});
		render_grid();
		schedule_autosave();
		frappe.show_alert({
			message: __("Set category on {0} empty row(s)", [n]),
			indicator: "blue",
		});
	}

	function receive_banner_html() {
		const wh = cstr(form.get_value("warehouse") || "").trim();
		if (!wh) {
			return `<div class="kqs-receive-banner kqs-receive-banner-missing">${__(
				"Receiving into: not set — choose a branch before Approve. Stock will only appear at that warehouse (other branches look empty until Assign)."
			)}</div>`;
		}
		return `<div class="kqs-receive-banner">${__("Receiving into")}: <strong>${esc(
			wh
		)}</strong> — ${__(
			"Only this branch sees qty after publish. Other stores need Assign to Branch."
		)}</div>`;
	}

	function render_summary() {
		const c = counts();
		const saved = last_saved_at
			? `${__("Draft auto-saved")} ${esc(last_saved_at)}`
			: batch
				? __("Draft on server — edits auto-save")
				: "";
		form.get_field("summary_bar").$wrapper.html(`
			<div class="kqs-summary-panel">
				${receive_banner_html()}
				<div class="flex flex-wrap align-center" style="gap:8px;">
					${batch ? `<span class="indicator-pill gray">${esc(batch)}</span>` : ""}
					<span class="indicator-pill blue" title="${__("Will create a new product style in the catalog")}">${__(
						"Create"
					)}: ${c.create}</span>
					<span class="indicator-pill green" title="${__("Will receive qty onto an existing SKU")}">${__(
						"Add stock"
					)}: ${c.receive}</span>
					<span class="indicator-pill orange" title="${__("Will add a new color/size under an existing product")}">${__(
						"Add variant"
					)}: ${c.add_variant}</span>
					<span class="indicator-pill red" title="${__("Must choose match / Create as new first")}">${__(
						"Needs match"
					)}: ${c.needs_match}</span>
					<span class="indicator-pill red" title="${__("Missing required fields — will NOT publish")}">${__(
						"Blocked"
					)}: ${c.blocked}</span>
					<span class="indicator-pill green" title="${__("Passes checks — will publish on Approve")}">${__(
						"Ready"
					)}: ${c.ready}</span>
					<span class="indicator-pill gray" title="${__("Already published from this draft")}">${__(
						"Done"
					)}: ${c.applied}</span>
					${saved ? `<span class="text-muted small ml-2">${saved}</span>` : ""}
				</div>
				${
					batch
						? `<div class="kqs-summary-tools">
						<button type="button" class="btn btn-sm btn-default kqs-export-draft">
							${__("Export draft CSV")}
						</button>
						<button type="button" class="btn btn-sm btn-secondary kqs-apply-cat">
							${__("Fill empty categories from default")}
						</button>
						<label class="kqs-hide-done-label">
							<input type="checkbox" class="kqs-hide-done" ${hide_published_rows ? "checked" : ""}/>
							${__("Hide published (Done) rows")}
						</label>
					</div>`
						: ""
				}
				<p class="text-muted small mb-0">${__(
					"Empty / incomplete rows stay in the draft only — Approve publishes Ready rows and skips Blocked. Red fields must be filled first. Re-Approve never re-adds Published (Done) rows."
				)}</p>
				<div class="kqs-pill-legend">
					<div><strong>${__("Create")}</strong> — ${__("new product style (name + style + price + category)")}</div>
					<div><strong>${__("Add stock")}</strong> — ${__("more qty on an existing barcode/SKU already in catalog")}</div>
					<div><strong>${__("Add variant")}</strong> — ${__("new color/size under a product that already exists")}</div>
					<div><strong>${__("Needs match")}</strong> — ${__("looks like an existing style — you must Accept, Search, or Create as new")}</div>
					<div><strong>${__("Blocked")}</strong> — ${__("missing required fields; will not go live")}</div>
					<div><strong>${__("Ready")}</strong> — ${__("passes all checks; included when you Approve & publish")}</div>
					<div><strong>${__("Done / Published")}</strong> — ${__("already succeeded — Approve again will not create duplicates or add qty twice")}</div>
				</div>
				${publish_log_html(last_publish_result)}
			</div>
		`);
		form
			.get_field("summary_bar")
			.$wrapper.find(".kqs-export-draft")
			.on("click", () => export_current_draft_csv());
		form
			.get_field("summary_bar")
			.$wrapper.find(".kqs-apply-cat")
			.on("click", () => apply_default_category_to_empty());
		form
			.get_field("summary_bar")
			.$wrapper.find(".kqs-hide-done")
			.on("change", function () {
				hide_published_rows = !!this.checked;
				render_grid();
			});
	}

	function flag_label(flag) {
		const map = {
			force_create: __("Creating new"),
			needs_match_choice: __("Needs choice"),
			category_suggested: "",
			qty_uncertain: __("Qty uncertain"),
			missing_variant_attrs: __("Need color/size"),
			manual_row: __("Manual"),
			style_exists_new_variant: __("New color/size on existing style"),
			style_format_twin: __("Same style?"),
		};
		if (Object.prototype.hasOwnProperty.call(map, flag)) return map[flag];
		return String(flag || "").replace(/_/g, " ");
	}

	function flags_html(r) {
		const action = cstr(r.action || "");
		return (r.flags || [])
			.map((f) => {
				// Hide match-choice badges once staff already chose Create / linked.
				if (
					(f === "needs_match_choice" || f === "needs_match") &&
					action !== "needs_match"
				) {
					return "";
				}
				if (f === "category_suggested") return "";
				const label = flag_label(f);
				if (!label) return "";
				return `<span class="kqs-flag kqs-flag-${esc(f)}">${esc(label)}</span>`;
			})
			.filter(Boolean)
			.join(" ");
	}

	function linked_match_summary(r) {
		const tpl = cstr(r.linked_template || "").trim();
		if (!tpl) return "";
		const cand =
			(r.match_candidates || []).find((c) => cstr(c.item_code) === tpl) ||
			(r.match_candidates || [])[0] ||
			{};
		const name = cstr(r.linked_item_name || cand.item_name || "").trim() || tpl;
		const style = cstr(r.linked_style_code || cand.style_code || tpl).trim();
		const sku = cstr(r.linked_item || "").trim();
		const action = cstr(r.action || "");
		let how = "";
		if (action === "receive") {
			how = __("Adding stock to this product");
		} else if (action === "add_variant") {
			how = __("Adding a new color/size under this product");
		} else {
			how = __("Linked to catalog");
		}
		return `<div class="kqs-linked-match">
			<div class="kqs-linked-name">${esc(name)}</div>
			<div class="text-muted small">${__("Style")} <strong>${esc(style)}</strong>${
			sku && sku !== tpl && sku !== style ? ` · ${__("SKU")} ${esc(sku)}` : ""
		}</div>
			<div class="text-success small">${esc(how)}</div>
		</div>`;
	}

	function match_tools_html(r, disabled) {
		if (r.status === "applied") return "";
		const action = cstr(r.action || "");
		const show_create =
			!cint(r._force_create) &&
			(action === "needs_match" || action === "receive" || action === "add_variant");
		return `<div class="kqs-match-tools mt-1">
			<button type="button" class="btn btn-xs btn-default kqs-search-link" data-row="${esc(
				r.row_id
			)}" ${disabled} title="${__("Search catalog and change the linked product")}">${__(
			"Search / change…"
		)}</button>
			${
				show_create
					? `<button type="button" class="btn btn-xs btn-default kqs-force-create" data-row="${esc(
							r.row_id
					  )}" ${disabled}>${__("Create as new")}</button>`
					: ""
			}
		</div>`;
	}

	function render_grid() {
		const $grid = form.get_field("preview_grid").$wrapper;
		const footer = `
			<div class="kqs-grid-footer">
				<button type="button" class="btn btn-sm btn-primary kqs-add-product-row">${__(
					"Add product row"
				)}</button>
				<span class="text-muted small">${__(
					"Adds a blank product at the end. For another color/size of an existing line, use + Color/size on that row."
				)}</span>
			</div>`;
		if (!rows || !rows.length) {
			$grid.html(
				`<p class="text-muted mb-2">${__(
					"Upload a CSV or paper photo to see the preview table — or add a product row below."
				)}</p>${footer}`
			);
			$grid.find(".kqs-add-product-row").on("click", () => append_manual_row("blank"));
			return;
		}

		const visible = (rows || []).filter(
			(r) => !(hide_published_rows && cstr(r.status) === "applied")
		);
		const hidden_done = (rows || []).length - visible.length;
		const body = visible
			.map((r) => {
				const idx = (rows || []).indexOf(r);
				const flags = flags_html(r);
				const show_match_ui = cstr(r.action) === "needs_match" && !cint(r._force_create);
				const candidates = show_match_ui
					? (r.match_candidates || [])
							.slice(0, 3)
							.map((c) => {
								const reason = cstr(c.reason || "");
								const is_style =
									reason.indexOf("style_") === 0 ||
									reason === "exact_name_and_style";
								const hint = is_style
									? ` <span class="text-success">${__("existing style — add color/size")}</span>`
									: reason.indexOf("fuzzy") >= 0 || reason === "fuzzy"
									  ? ` <span class="text-muted">${__("similar?")}</span>`
									  : "";
								return `<button type="button" class="btn btn-xs btn-default kqs-accept-match"
								data-row="${esc(r.row_id)}" data-template="${esc(c.item_code)}"
								title="${esc(c.reason)} (${c.score})">
								${__("Use")} ${esc(c.item_name)} <span class="text-muted">${esc(c.style_code)}</span>${hint}
							</button>`;
							})
							.join(" ")
					: "";
				const needs_choice = show_match_ui
					? `<div class="text-danger small">${__(
							"Style may already exist — Use the template to add this color/size, Search, or Create as new"
					  )}</div>`
					: "";
				const err = r.error
					? `<div class="text-danger small">${esc(r.error)}${
							fix_howto(r.error)
								? `<div class="text-muted"><em>${esc(fix_howto(r.error))}</em></div>`
								: ""
					  }</div>`
					: "";
				const blockers = row_blocking_errors(r);
				const blocker_html = blockers.length
					? `<div class="kqs-blockers">${esc(blockers.join(" · "))}${
							fix_howto(blockers.join(" "))
								? `<div class="text-muted"><em>${esc(fix_howto(blockers.join(" ")))}</em></div>`
								: ""
					  }</div>`
					: "";
				const disabled = r.status === "applied" ? "disabled" : "";
				const row_cls = [
					r.status === "applied" ? "text-muted" : "",
					blockers.length ? "kqs-row-blocked" : "",
				]
					.filter(Boolean)
					.join(" ");
				const force_note = cint(r._force_create)
					? `<div class="text-success small">${__("Will create as a new product")}</div>`
					: "";
				const row_actions =
					r.status === "applied"
						? ""
						: `<div class="kqs-row-actions">
							<button type="button" class="btn btn-xs btn-default kqs-clone-variant" data-row="${esc(
								r.row_id
							)}" title="${__("Insert another color/size under this style")}">+</button>
							<button type="button" class="btn btn-xs btn-danger kqs-remove-row" data-row="${esc(
								r.row_id
							)}" title="${__("Remove row from draft")}">×</button>
						</div>`;
				const match_body = show_match_ui
					? `${needs_choice}
						<div class="mb-1">${
							candidates ||
							`<span class="text-muted small">${__("No close catalog match")}</span>`
						}</div>
						${match_tools_html(r, disabled)}`
					: cint(r._force_create)
					  ? `<span class="text-muted small">${__("Match skipped — creating new")}</span>
						${match_tools_html(r, disabled)}`
					  : r.linked_template
					    ? `${linked_match_summary(r)}${match_tools_html(r, disabled)}`
					    : `<span class="text-muted small">${__("Ready — new product")}</span>
						${match_tools_html(r, disabled)}`;
				return `<tr data-idx="${idx}" data-row-id="${esc(r.row_id)}" class="${row_cls}">
					<td class="kqs-col-action">${action_chip(r.action, r.status)}${row_actions}${flags}${err}${blocker_html}${force_note}</td>
					<td class="kqs-col-name"><input class="form-control input-sm kqs-f ${req_class(
						r,
						"product_name"
					)}" data-f="product_name" value="${esc(r.product_name)}" ${disabled}/>
					${(r.name_spelling_suggestions || [])
						.slice(0, 2)
						.map(
							(s) =>
								`<button type="button" class="btn btn-xs btn-warning kqs-fix-spelling mt-1"
									data-row="${esc(r.row_id)}" data-field="product_name" data-value="${esc(
									s.value
								)}" title="${__("Did you mean")} (${s.score})?">${__("Use")} “${esc(
									s.value
								)}”</button>`
						)
						.join(" ")}
					${
						(r.name_spelling_suggestions || []).length
							? `<button type="button" class="btn btn-xs btn-default kqs-keep-spelling mt-1"
								data-row="${esc(r.row_id)}">${__("Keep spelling")}</button>`
							: ""
					}
					</td>
					<td class="kqs-col-style"><input class="form-control input-sm kqs-f kqs-style-input ${req_class(
						r,
						"style_code"
					)}" data-f="style_code" value="${esc(r.style_code)}" ${disabled}
						placeholder="${__("Style number — click to edit")}" title="${__(
						"Edit the style number, then Search / change if you need a different catalog product"
					)}"/>
					${(r.style_spelling_suggestions || [])
						.slice(0, 2)
						.map(
							(s) =>
								`<button type="button" class="btn btn-xs btn-warning kqs-fix-spelling mt-1"
									data-row="${esc(r.row_id)}" data-field="style_code" data-value="${esc(
									s.value
								)}">${__("Use")} “${esc(s.value)}”</button>`
						)
						.join(" ")}
					${
						(r.style_spelling_suggestions || []).length
							? `<button type="button" class="btn btn-xs btn-default kqs-keep-spelling mt-1"
								data-row="${esc(r.row_id)}">${__("Keep style")}</button>`
							: ""
					}
					</td>
					<td class="kqs-col-color"><input class="form-control input-sm kqs-f ${req_class(
						r,
						"color"
					)}" data-f="color" value="${esc(r.color || r.color_raw)}" ${disabled} placeholder="${__(
						"color"
					)}"/></td>
					<td class="kqs-col-size"><input class="form-control input-sm kqs-f ${req_class(
						r,
						"size"
					)}" data-f="size" value="${esc(r.size || "")}" ${disabled} placeholder="${__(
						"size"
					)}"/></td>
					<td class="kqs-col-qty">
						<input class="form-control input-sm kqs-f ${req_class(
							r,
							"qty"
						)}" data-f="qty" type="number" step="any"
							value="${esc(r.qty)}" ${disabled}/>
						<div class="text-muted small">${esc(r.qty_raw || "")}</div>
					</td>
					<td class="kqs-col-price"><input class="form-control input-sm kqs-f ${req_class(
						r,
						"price"
					)}" data-f="price" type="number" step="any"
						value="${r.price == null ? "" : esc(r.price)}" ${disabled}/></td>
					<td class="kqs-col-category"><div class="${req_class(r, "item_group")}">${category_select_html(
						r.item_group || "",
						disabled
					)}</div>
					${
						cint(r._category_suggested)
							? `<div class="text-muted small">${__("Auto-suggested — change if wrong")}</div>`
							: ""
					}
					${(r.category_candidates || [])
						.slice(0, 3)
						.map(
							(c) =>
								`<button type="button" class="btn btn-xs btn-default kqs-use-cat mt-1"
									data-idx="${idx}" data-cat="${esc(c.name)}">${esc(c.name)}</button>`
						)
						.join(" ")}
					</td>
					<td class="kqs-col-match">${match_body}</td>
				</tr>`;
			})
			.join("");

		$grid.html(`
			<p class="kqs-preview-hint">${__(
				"Preview fills most of the page. Sideways scroll stays at the bottom of this window — stay on any row and pan columns without jumping to the end."
			)}</p>
			${
				hidden_done
					? `<p class="text-muted small">${__(
							"Hiding {0} published (Done) row(s) so retries only show what still needs work. Uncheck “Hide published” above to see them.",
							[hidden_done]
					  )}</p>`
					: ""
			}
			<div class="kqs-preview-scroll">
			<table class="table table-bordered kqs-import-table">
				<thead>
					<tr>
						<th class="kqs-col-action">${__("Action")}</th>
						<th class="kqs-col-name">${__("Name")} <span class="kqs-req">*</span></th>
						<th class="kqs-col-style">${__("Style")} <span class="kqs-req">*</span></th>
						<th class="kqs-col-color">${__("Color")}</th>
						<th class="kqs-col-size">${__("Size")}</th>
						<th class="kqs-col-qty">${__("Qty")} <span class="kqs-req">*</span></th>
						<th class="kqs-col-price">${__("Price")} <span class="kqs-req">*</span></th>
						<th class="kqs-col-category">${__("Category")} <span class="kqs-req">*</span></th>
						<th class="kqs-col-match">${__("Match")}</th>
					</tr>
				</thead>
				<tbody>${body}</tbody>
			</table>
			</div>
			${footer}
		`);

		$grid.find(".kqs-add-product-row").on("click", () => append_manual_row("blank"));
		$grid.find(".kqs-clone-variant").on("click", function (e) {
			e.preventDefault();
			append_manual_row("variant", btn_data_row($(this)));
		});
		$grid.find(".kqs-remove-row").on("click", function (e) {
			e.preventDefault();
			remove_manual_row(btn_data_row($(this)));
		});

		$grid.find(".kqs-f").on("change", function () {
			const edited = apply_field_edit($(this));
			if (!edited) return;
			refresh_row_validation(edited.idx);
			render_summary();
			if (edited.field === "product_name" || edited.field === "style_code") {
				// Rematch saves the draft in one request — skip parallel autosave (deadlocks).
				schedule_rematch(edited.row_id);
			} else {
				schedule_autosave();
			}
			// Do not rebuild the whole table on every edit — that scrolled away and wiped focus.
		});

		// Keep memory in sync while typing (before blur/change), so autosave/rematch never send stale values.
		$grid.find(".kqs-f").on("input", function () {
			apply_field_edit($(this));
		});

		$grid.find(".kqs-accept-match").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const row_id = btn_data_row($(this));
			const template = cstr($(this).attr("data-template") || $(this).data("template") || "");
			if (!batch || !row_id || !template) return;
			frappe.call({
				method: "kqs_retail.api.bulk_import.accept_match",
				args: { batch_name: batch, row_id, template },
				freeze: true,
				callback(r) {
					if (r.message) load_batch_into_state(r.message, row_id);
				},
			});
		});

		$grid.find(".kqs-force-create").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const row_id = btn_data_row($(this));
			if (!batch) {
				frappe.show_alert({
					message: __("Draft not loaded — refresh the page and open the draft again."),
					indicator: "red",
				});
				return;
			}
			if (!row_id) return;
			const row = find_row_by_id(row_id) || {};
			const twins = (row.match_candidates || []).filter((c) =>
				[
					"style_format_variant",
					"style_format_same_name",
					"style_normalized",
					"style_identical",
				].includes(c.reason)
			);
			const go = () => {
				// Immediate UI so the row updates even if the confirm/dialog stole focus.
				apply_force_create_locally(row_id);
				render_grid_preserving_view(row_id);
				render_summary();
				frappe.show_alert({
					message: __("Will create as a new product"),
					indicator: "green",
				});
				frappe.call({
					method: "kqs_retail.api.bulk_import.force_create_row",
					args: { batch_name: batch, row_id },
					callback(r) {
						if (r.message) load_batch_into_state(r.message, row_id);
					},
					error() {
						frappe.show_alert({
							message: __("Could not save Create as new — try again"),
							indicator: "red",
						});
					},
				});
			};
			if (twins.length) {
				const sample = twins
					.slice(0, 3)
					.map((c) => `${c.item_name} (${c.style_code})`)
					.join(", ");
				frappe.confirm(
					__(
						"This style looks like an existing product: {0}. Create a separate new product anyway? Only continue if it is truly different.",
						[sample]
					),
					go
				);
			} else {
				go();
			}
		});

		$grid.find(".kqs-fix-spelling").on("click", function (e) {
			e.preventDefault();
			const row_id = btn_data_row($(this));
			const field = cstr($(this).attr("data-field") || $(this).data("field") || "");
			const value = cstr($(this).attr("data-value") || $(this).data("value") || "");
			const row = find_row_by_id(row_id);
			if (!row || !field) return;
			row[field] = value;
			row._spelling_locked = 1;
			row.name_spelling_suggestions = [];
			row.style_spelling_suggestions = [];
			schedule_autosave();
			render_grid_preserving_view(row_id, field);
			render_summary();
		});

		$grid.find(".kqs-keep-spelling").on("click", function (e) {
			e.preventDefault();
			const row_id = btn_data_row($(this));
			const row = find_row_by_id(row_id);
			if (!row) return;
			row._spelling_locked = 1;
			row.name_spelling_suggestions = [];
			row.style_spelling_suggestions = [];
			schedule_autosave();
			render_grid_preserving_view(row_id);
		});

		$grid.find(".kqs-use-cat").on("click", function (e) {
			e.preventDefault();
			const idx = cint($(this).attr("data-idx") || $(this).data("idx"));
			if (idx < 0 || !rows[idx]) return;
			rows[idx].item_group = cstr($(this).attr("data-cat") || $(this).data("cat") || "");
			rows[idx]._category_suggested = 0;
			schedule_autosave();
			render_grid_preserving_view(rows[idx].row_id);
			render_summary();
		});

		$grid.find(".kqs-search-link").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			const row_id = btn_data_row($(this));
			const row = find_row_by_id(row_id) || {};
			const seed = cstr(row.style_code || row.product_name || "").trim();
			const d = new frappe.ui.Dialog({
				title: __("Link to existing product"),
				fields: [
					{
						fieldname: "q",
						fieldtype: "Data",
						label: __("Search by name, style, or barcode"),
						default: seed,
					},
					{ fieldname: "results", fieldtype: "HTML" },
				],
			});
			const run = () => {
				frappe.call({
					method: "kqs_retail.api.bulk_import.search_catalog_matches",
					args: { query: d.get_value("q") || "", limit: 20 },
					callback(r) {
						let items = r.message;
						if (items && !Array.isArray(items) && Array.isArray(items.items)) {
							items = items.items;
						}
						items = items || [];
						const list = items
							.map(
								(it) =>
									`<div class="mb-1">
										<button type="button" class="btn btn-xs btn-primary kqs-pick"
											data-code="${esc(it.item_code)}">${esc(it.item_name)}
											<span class="text-muted">${esc(it.style_code || it.item_code)}</span></button>
									</div>`
							)
							.join("");
						d.fields_dict.results.$wrapper.html(
							list || `<p class="text-muted">${__("No results — try a shorter name or style")}</p>`
						);
						d.fields_dict.results.$wrapper.find(".kqs-pick").on("click", function () {
							const template = cstr(
								$(this).attr("data-code") || $(this).data("code") || ""
							);
							frappe.call({
								method: "kqs_retail.api.bulk_import.accept_match",
								args: {
									batch_name: batch,
									row_id,
									template,
								},
								freeze: true,
								callback(rr) {
									d.hide();
									if (rr.message) load_batch_into_state(rr.message, row_id);
								},
							});
						});
					},
				});
			};
			d.fields_dict.q.$input.on("input", frappe.utils.debounce(run, 300));
			d.show();
			run();
		});
	}

	function collect_rows_from_dom() {
		// values already synced on change; also push default category
		const def = form.get_value("default_item_group") || "";
		rows.forEach((r) => {
			if (!r.item_group && def) r.item_group = def;
		});
		return rows;
	}

	function save_and_reenrich() {
		if (!batch) {
			frappe.msgprint(__("Load a CSV or paper extract first."));
			return;
		}
		frappe.call({
			method: "kqs_retail.api.bulk_import.update_batch",
			args: {
				batch_name: batch,
				rows_json: JSON.stringify(collect_rows_from_dom()),
				warehouse: form.get_value("warehouse"),
				pack_map_json: JSON.stringify(current_pack_map()),
				re_enrich: 1,
			},
			freeze: true,
			callback(r) {
				if (r.message) load_batch_into_state(r.message);
			},
		});
	}

	function commit_batch(valid_only) {
		if (!batch) {
			frappe.msgprint(__("Load a CSV or paper extract first."));
			return;
		}
		if (commit_busy) {
			frappe.show_alert({ message: __("Publish already in progress…"), indicator: "orange" });
			return;
		}
		if (!form.get_value("warehouse")) {
			frappe.msgprint({
				title: __("Warehouse required"),
				message: __("Select Receive into warehouse before publishing."),
				indicator: "red",
			});
			return;
		}
		collect_rows_from_dom();
		const c = counts();
		if (c.ready === 0) {
			const samples = (rows || [])
				.filter((r) => r.status !== "applied" && r.action !== "skip")
				.slice(0, 6)
				.map((r) => {
					const b = row_blocking_errors(r);
					return b.length
						? `• ${cstr(r.product_name || r.style_code || r.row_id)}: ${b.join("; ")}`
						: null;
				})
				.filter(Boolean)
				.join("<br>");
			frappe.msgprint({
				title: __("Required fields missing"),
				message:
					__(
						"Nothing is ready to publish. Empty rows and incomplete rows stay in the draft only. Fill red fields, then try again."
					) + (samples ? `<br><br>${samples}` : ""),
				indicator: "red",
			});
			render_grid();
			render_summary();
			return;
		}
		const def = form.get_value("default_item_group") || "";
		const go = () => {
			if (commit_busy) return;
			if (autosave_timer) {
				clearTimeout(autosave_timer);
				autosave_timer = null;
			}
			commit_busy = true;
			frappe.call({
				method: "kqs_retail.api.bulk_import.update_batch",
				args: {
					batch_name: batch,
					rows_json: JSON.stringify(collect_rows_from_dom()),
					warehouse: form.get_value("warehouse"),
					pack_map_json: JSON.stringify(current_pack_map()),
					re_enrich: 0,
				},
				freeze: true,
				callback() {
					frappe.call({
						method: "kqs_retail.api.bulk_import.commit_batch",
						args: {
							batch_name: batch,
							commit_valid_only: valid_only ? 1 : 0,
							item_group: def,
						},
						freeze: true,
						freeze_message: __("Publishing…"),
						callback(r) {
							commit_busy = false;
							if (!r.message) return;
							const res = r.message.result || {};
							last_publish_result = res;
							load_batch_into_state(r.message.batch || r.message);
							const sum = res.summary || {};
							const wh = esc(sum.warehouse || res.warehouse || form.get_value("warehouse") || "");
							const needs = (res.log || []).filter(
								(e) =>
									e.outcome === "failed" ||
									(e.outcome === "skipped" && cint(e.needs_fix))
							);
							const already = (res.log || []).filter(
								(e) => e.outcome === "skipped" && !cint(e.needs_fix)
							);
							const ok_lines = (res.log || [])
								.filter((e) => e.outcome === "succeeded")
								.slice(0, 12)
								.map((e) => {
									const sku = cstr(
										e.item_code || (e.item_codes && e.item_codes[0]) || e.template || ""
									);
									const open = sku
										? ` — <a href="/app/item/${encodeURIComponent(
												sku
										  )}" target="_blank">${__("Open")} ${esc(sku)}</a>`
										: "";
									return `<li>${esc(
										[e.name, e.style, e.color].filter(Boolean).join(" · ")
									)}${open}</li>`;
								})
								.join("");
							let detail = `
								<p><strong>${__("Received into")}:</strong> ${wh || "—"}</p>
								<p><strong>${__("Published OK")}:</strong> ${cint(sum.succeeded)} &nbsp;
								<strong>${__("Need a fix")}:</strong> ${needs.length} &nbsp;
								<strong>${__("Already done (ignore)")}:</strong> ${already.length}</p>
								<p>${__(
									"Look at rows marked Failed / orange Blocked in the table — the red text under each row says exactly what to fix. Then Approve again. Published rows will not duplicate."
								)}</p>`;
							if (ok_lines) {
								detail += `<p><strong>${__("Find these under Items")}</strong></p><ul>${ok_lines}</ul>`;
							}
							if (needs.length) {
								detail += `<p><strong>${__("Fix these")}</strong></p><ul>${needs
									.slice(0, 15)
									.map((e) => {
										const how = fix_howto(e.detail);
										return `<li><strong>${esc(
											[e.name, e.style, e.color].filter(Boolean).join(" · ")
										)}</strong><br>${esc(e.detail)}${
											how ? `<br><em>${esc(how)}</em>` : ""
										}</li>`;
									})
									.join("")}</ul>`;
							} else {
								detail += `<p class="text-success">${__(
									"No rows left that need a fix from this publish."
								)}</p>`;
							}
							frappe.msgprint({
								title: __("Publish result"),
								message: detail,
								indicator: needs.length ? "orange" : "green",
							});
							load_drafts_list();
						},
						error() {
							commit_busy = false;
						},
					});
				},
				error() {
					commit_busy = false;
				},
			});
		};
		if (c.blocked > 0 && valid_only) {
			frappe.confirm(
				__(
					"{0} row(s) ready, {1} still blocked. Publish ready rows only? Blocked / empty rows stay in the draft and are not created.",
					[c.ready, c.blocked]
				),
				go
			);
		} else {
			go();
		}
	}

	function flt(v) {
		return parseFloat(v) || 0;
	}
	function cint(v) {
		return parseInt(v, 10) || 0;
	}

	frappe.call({
		method: "kqs_retail.api.bulk_import.get_import_defaults",
		callback(r) {
			if (!r.message) return;
			const d = r.message;
			ai_info = d.ai || ai_info;
			pack_map = d.pack_map || pack_map;
			csv_template = d.csv_template || "";
			csv_template_blank = d.csv_template_blank || "";
			settings_hint = d.settings_hint || "";
			form.set_value("pack_box", pack_map.box || 1);
			form.set_value("pack_pack", pack_map.pack || 1);
			frappe.call({
				method: "kqs_retail.api.bulk_import.list_import_categories",
				callback(cr) {
					category_options = cr.message || [];
					render_source_panel();
					render_grid();
					load_drafts_list();
					// Always confirm branch when blank — never assume Central.
					if (!cstr(form.get_value("warehouse") || "").trim()) {
						prompt_choose_warehouse();
					}
				},
			});
		},
	});
};
