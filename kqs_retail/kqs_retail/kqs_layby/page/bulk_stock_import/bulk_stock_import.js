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
	let last_saved_at = null;

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
				label: __("Receive into"),
				reqd: 1,
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
				onchange: () => schedule_autosave(),
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
		if ($("#kqs-bulk-import-style").length) return;
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
				background: #fff5f5;
			}
			.kqs-bulk-import-form th .kqs-req {
				color: var(--red-500, #e24c4c);
			}
			.kqs-bulk-import-form .kqs-row-blocked {
				outline: 1px solid #f5c2c2;
				background: #fffafa;
			}
			.kqs-bulk-import-form .kqs-blockers {
				color: var(--red-600, #c0392b);
				font-size: 0.75rem;
				margin-top: 0.25rem;
			}
			.kqs-bulk-import-form input[type=file].kqs-hidden-file {
				position: absolute;
				width: 1px;
				height: 1px;
				opacity: 0;
				overflow: hidden;
				z-index: -1;
			}
		</style>`);
	}

	function esc(s) {
		return frappe.utils.escape_html(cstr(s));
	}
	function cstr(v) {
		return v == null ? "" : String(v);
	}

	function current_pack_map() {
		return {
			box: flt(form.get_value("pack_box")) || 1,
			pack: flt(form.get_value("pack_pack")) || 1,
		};
	}

	function row_blocking_errors(r) {
		const errs = [];
		if (r.status === "applied" || r.action === "skip") return errs;
		const action = cstr(r.action || "");
		if (action === "needs_match" || !action) {
			errs.push(__("Needs match — accept a suggestion or create as new"));
			return errs;
		}
		if (!cstr(r.product_name).trim()) errs.push(__("Name is required"));
		if (!cstr(r.style_code).trim()) errs.push(__("Style number is required"));
		if (action === "create") {
			if (r.price == null || r.price === "" || flt(r.price) <= 0) {
				errs.push(__("Price is required"));
			}
			if (!cstr(r.item_group).trim()) errs.push(__("Category is required"));
		} else if (action === "add_variant") {
			if (!cstr(r.linked_template).trim()) errs.push(__("Link a product"));
			if (!cstr(r.color || "").trim() && !cstr(r.size || "").trim()) {
				errs.push(__("Color or size required"));
			}
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
			return action === "receive" && flt(r.qty) <= 0;
		}
		return false;
	}

	function req_class(r, field) {
		return field_missing(r, field) ? "kqs-req-missing" : "";
	}

	function action_chip(action) {
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
		if (autosave_timer) clearTimeout(autosave_timer);
		autosave_timer = setTimeout(() => save_draft(true), 2500);
	}

	function save_draft(silent) {
		if (!batch) {
			if (!silent) frappe.msgprint(__("Load a CSV or paper extract first to create a draft."));
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
					if (r.message.rows) rows = r.message.rows;
				}
				render_summary();
				load_drafts_list();
				if (!silent) {
					frappe.show_alert({ message: __("Draft saved"), indicator: "green" });
				}
			},
			error() {
				autosave_busy = false;
			},
		});
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
					"No open drafts yet. Upload a CSV or photo — work is auto-saved so you can resume after a reload."
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
					<td>
						<button type="button" class="btn btn-xs ${active} kqs-open-draft" data-name="${esc(
					d.name
				)}">${d.name === batch ? __("Current") : __("Continue")}</button>
					</td>
				</tr>`;
			})
			.join("");
		$el.html(`
			<div class="mb-3">
				<label class="control-label">${__("Open drafts (resume after reload)")}</label>
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
	}

	function start_new_draft() {
		batch = null;
		rows = [];
		last_saved_at = null;
		render_summary();
		render_grid();
		load_drafts_list();
		frappe.show_alert({
			message: __("Cleared. Upload CSV or photo to start a new draft."),
			indicator: "blue",
		});
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
			$el.find(".kqs-img-name").text(
				files.length ? files.map((f) => f.name).join(", ") : __("No photos selected")
			);
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
			upload_images_then_extract(Array.from(input.files));
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

	function load_batch_into_state(data) {
		batch = data.name;
		rows = data.rows || [];
		pack_map = data.pack_map || pack_map;
		if (data.warehouse) form.set_value("warehouse", data.warehouse);
		form.set_value("pack_box", (pack_map && pack_map.box) || 1);
		form.set_value("pack_pack", (pack_map && pack_map.pack) || 1);
		render_summary();
		render_grid();
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

	function render_summary() {
		const c = counts();
		const saved = last_saved_at
			? `${__("Draft auto-saved")} ${esc(last_saved_at)}`
			: batch
				? __("Draft on server — edits auto-save")
				: "";
		form.get_field("summary_bar").$wrapper.html(`
			<div class="flex flex-wrap mb-3 align-center" style="gap:8px;">
				${batch ? `<span class="indicator-pill gray">${esc(batch)}</span>` : ""}
				<span class="indicator-pill blue">${__("Create")}: ${c.create}</span>
				<span class="indicator-pill green">${__("Add stock")}: ${c.receive}</span>
				<span class="indicator-pill orange">${__("Add variant")}: ${c.add_variant}</span>
				<span class="indicator-pill red">${__("Needs match")}: ${c.needs_match}</span>
				<span class="indicator-pill red">${__("Blocked")}: ${c.blocked}</span>
				<span class="indicator-pill green">${__("Ready")}: ${c.ready}</span>
				<span class="indicator-pill gray">${__("Done")}: ${c.applied}</span>
				${saved ? `<span class="text-muted small ml-2">${saved}</span>` : ""}
				${
					batch
						? `<button type="button" class="btn btn-xs btn-default kqs-export-draft">${__(
								"Export draft CSV"
						  )}</button>
						   <button type="button" class="btn btn-xs btn-default kqs-apply-cat">${__(
								"Fill empty categories from default"
						  )}</button>`
						: ""
				}
			</div>
			<p class="text-muted small mb-2">${__(
				"Red fields are required before Approve. New products need Name, Style, Price, and Category. Add stock needs Qty. Resolve Needs match or Create as new."
			)}</p>
		`);
		form
			.get_field("summary_bar")
			.$wrapper.find(".kqs-export-draft")
			.on("click", () => export_current_draft_csv());
		form
			.get_field("summary_bar")
			.$wrapper.find(".kqs-apply-cat")
			.on("click", () => apply_default_category_to_empty());
	}

	function render_grid() {
		const $grid = form.get_field("preview_grid").$wrapper;
		if (!rows || !rows.length) {
			$grid.html(`<p class="text-muted">${__("Upload a CSV or paper photo to see the preview table.")}</p>`);
			return;
		}

		const body = rows
			.map((r, idx) => {
				const flags = (r.flags || []).map((f) => `<span class="badge badge-warning">${esc(f)}</span>`).join(" ");
				const candidates = (r.match_candidates || [])
					.slice(0, 3)
					.map(
						(c) =>
							`<button type="button" class="btn btn-xs btn-default kqs-accept-match"
								data-row="${esc(r.row_id)}" data-template="${esc(c.item_code)}"
								title="${esc(c.reason)} (${c.score})">
								${esc(c.item_name)} <span class="text-muted">${esc(c.style_code)}</span>
							</button>`
					)
					.join(" ");
				const linked = r.linked_template
					? `<span class="indicator-pill green">${esc(r.linked_template)}</span>`
					: "";
				const err = r.error ? `<div class="text-danger small">${esc(r.error)}</div>` : "";
				const blockers = row_blocking_errors(r);
				const blocker_html = blockers.length
					? `<div class="kqs-blockers">${esc(blockers.join(" · "))}</div>`
					: "";
				const disabled = r.status === "applied" ? "disabled" : "";
				const row_cls = [
					r.status === "applied" ? "text-muted" : "",
					blockers.length ? "kqs-row-blocked" : "",
				]
					.filter(Boolean)
					.join(" ");
				return `<tr data-idx="${idx}" class="${row_cls}">
					<td>${action_chip(r.action)}${flags}<div>${linked}</div>${err}${blocker_html}</td>
					<td><input class="form-control input-sm kqs-f ${req_class(
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
					<td><input class="form-control input-sm kqs-f ${req_class(
						r,
						"style_code"
					)}" data-f="style_code" value="${esc(r.style_code)}" ${disabled}/>
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
					</td>
					<td><input class="form-control input-sm kqs-f" data-f="color" value="${esc(
						r.color || r.color_raw
					)}" ${disabled}/></td>
					<td><input class="form-control input-sm kqs-f" data-f="size" value="${esc(
						r.size || ""
					)}" ${disabled}/></td>
					<td style="min-width:90px;">
						<input class="form-control input-sm kqs-f ${req_class(
							r,
							"qty"
						)}" data-f="qty" type="number" step="any"
							value="${esc(r.qty)}" ${disabled}/>
						<div class="text-muted small">${esc(r.qty_raw || "")}</div>
					</td>
					<td style="min-width:90px;"><input class="form-control input-sm kqs-f ${req_class(
						r,
						"price"
					)}" data-f="price" type="number" step="any"
						value="${r.price == null ? "" : esc(r.price)}" ${disabled}/></td>
					<td style="min-width:180px;"><div class="${req_class(r, "item_group")}">${category_select_html(
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
					<td style="min-width:200px;">
						<div class="mb-1">${candidates || `<span class="text-muted small">${__("No suggestions")}</span>`}</div>
						<button type="button" class="btn btn-xs btn-primary kqs-force-create" data-row="${esc(
							r.row_id
						)}" ${disabled}>${__("Create as new")}</button>
						<button type="button" class="btn btn-xs btn-default kqs-search-link" data-row="${esc(
							r.row_id
						)}" ${disabled}>${__("Search…")}</button>
					</td>
				</tr>`;
			})
			.join("");

		$grid.html(`
			<div class="table-responsive">
			<table class="table table-bordered table-condensed kqs-import-table">
				<thead>
					<tr>
						<th>${__("Action")}</th>
						<th>${__("Name")} <span class="kqs-req">*</span></th>
						<th>${__("Style")} <span class="kqs-req">*</span></th>
						<th>${__("Color")}</th>
						<th>${__("Size")}</th>
						<th>${__("Qty")} <span class="kqs-req">*</span></th>
						<th>${__("Price")} <span class="kqs-req">*</span></th>
						<th>${__("Category")} <span class="kqs-req">*</span></th>
						<th>${__("Match")}</th>
					</tr>
				</thead>
				<tbody>${body}</tbody>
			</table>
			</div>
		`);

		$grid.find(".kqs-f").on("change", function () {
			const $tr = $(this).closest("tr");
			const idx = cint($tr.data("idx"));
			const field = $(this).data("f");
			let val = $(this).val();
			if (field === "qty" || field === "price") val = val === "" ? null : flt(val);
			rows[idx][field] = val;
			if (field === "qty") rows[idx]._qty_edited = 1;
			if (field === "color") rows[idx].color_raw = val;
			schedule_autosave();
			render_summary();
			// Refresh row highlights without full table rebuild of handlers — rebuild grid
			render_grid();
		});

		$grid.find(".kqs-accept-match").on("click", function () {
			const row_id = $(this).data("row");
			const template = $(this).data("template");
			frappe.call({
				method: "kqs_retail.api.bulk_import.accept_match",
				args: { batch_name: batch, row_id, template },
				freeze: true,
				callback(r) {
					if (r.message) load_batch_into_state(r.message);
				},
			});
		});

		$grid.find(".kqs-force-create").on("click", function () {
			frappe.call({
				method: "kqs_retail.api.bulk_import.force_create_row",
				args: { batch_name: batch, row_id: $(this).data("row") },
				freeze: true,
				callback(r) {
					if (r.message) load_batch_into_state(r.message);
				},
			});
		});

		$grid.find(".kqs-fix-spelling").on("click", function () {
			const row_id = $(this).data("row");
			const field = $(this).data("field");
			const value = $(this).data("value");
			const row = (rows || []).find((x) => x.row_id === row_id);
			if (!row) return;
			row[field] = value;
			row._spelling_locked = 1;
			row.name_spelling_suggestions = [];
			row.style_spelling_suggestions = [];
			schedule_autosave();
			render_grid();
			render_summary();
		});

		$grid.find(".kqs-keep-spelling").on("click", function () {
			const row_id = $(this).data("row");
			const row = (rows || []).find((x) => x.row_id === row_id);
			if (!row) return;
			row._spelling_locked = 1;
			row.name_spelling_suggestions = [];
			row.style_spelling_suggestions = [];
			schedule_autosave();
			render_grid();
		});

		$grid.find(".kqs-use-cat").on("click", function () {
			const idx = cint($(this).data("idx"));
			rows[idx].item_group = $(this).data("cat");
			rows[idx]._category_suggested = 0;
			schedule_autosave();
			render_grid();
			render_summary();
		});

		$grid.find(".kqs-search-link").on("click", function () {
			const row_id = $(this).data("row");
			const d = new frappe.ui.Dialog({
				title: __("Link to existing product"),
				fields: [
					{ fieldname: "q", fieldtype: "Data", label: __("Search") },
					{ fieldname: "results", fieldtype: "HTML" },
				],
			});
			const run = () => {
				frappe.call({
					method: "kqs_retail.api.bulk_import.search_catalog_matches",
					args: { query: d.get_value("q") || "", limit: 20 },
					callback(r) {
						const list = (r.message || [])
							.map(
								(it) =>
									`<div class="mb-1">
										<button type="button" class="btn btn-xs btn-default kqs-pick"
											data-code="${esc(it.item_code)}">${esc(it.item_name)}
											<span class="text-muted">${esc(it.style_code || it.item_code)}</span></button>
									</div>`
							)
							.join("");
						d.fields_dict.results.$wrapper.html(list || `<p class="text-muted">${__("No results")}</p>`);
						d.fields_dict.results.$wrapper.find(".kqs-pick").on("click", function () {
							frappe.call({
								method: "kqs_retail.api.bulk_import.accept_match",
								args: {
									batch_name: batch,
									row_id,
									template: $(this).data("code"),
								},
								freeze: true,
								callback(rr) {
									d.hide();
									if (rr.message) load_batch_into_state(rr.message);
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
						"Nothing is ready to publish. Fill red fields (Name, Style; new products also Price + Category; Add stock needs Qty). Resolve Needs match rows."
					) + (samples ? `<br><br>${samples}` : ""),
				indicator: "red",
			});
			render_grid();
			render_summary();
			return;
		}
		const def = form.get_value("default_item_group") || "";
		const go = () => {
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
							if (!r.message) return;
							const res = r.message.result || {};
							load_batch_into_state(r.message.batch || r.message);
							frappe.msgprint({
								title: __("Published"),
								message: __(
									"Created: {0}, Variants: {1}, Received: {2}, Skipped: {3}, Errors: {4}",
									[
										(res.created || []).length,
										(res.variants_added || []).length,
										(res.received || []).length,
										(res.skipped || []).length,
										(res.errors || []).length,
									]
								),
								indicator: (res.errors || []).length ? "orange" : "green",
							});
							load_drafts_list();
						},
					});
				},
			});
		};
		if (c.blocked > 0 && valid_only) {
			frappe.confirm(
				__(
					"{0} row(s) ready, {1} still blocked. Publish ready rows only? Blocked rows stay in the draft.",
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
			if (d.warehouse) form.set_value("warehouse", d.warehouse);
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
				},
			});
		},
	});
};
