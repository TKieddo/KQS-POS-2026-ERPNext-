frappe.pages["assign-to-branch"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Assign to Branch"),
		single_column: true,
	});

	let catalog_rows = [];
	let catalog_total = 0;
	let catalog_start = 0;
	const catalog_limit = 50;
	let catalog_view = "list";
	let catalog_search = "";
	let catalog_seq = 0;
	let catalog_shell_ready = false;
	let selected_products = new Set();
	let active_product = "";
	let transfer_lines = [];
	let qty_by_code = {};
	let suppress_product_onchange = false;
	let suppress_source_onchange = false;
	let transfer_lines_seq = 0;
	let last_source_warehouse = "";
	let save_in_progress = false;

	function format_float(value) {
		return frappe.format(value, { fieldtype: "Float", precision: 2 });
	}

	function item_image_url(image) {
		if (!image) return "/assets/frappe/images/ui/no-image.svg";
		const raw = String(image).trim();
		if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("data:")) {
			return raw;
		}
		let file_url = raw.startsWith("/") ? raw : `/${raw}`;
		file_url = encodeURI(file_url).replace(/#/g, "%23");
		if (frappe.urllib && frappe.urllib.get_full_url) {
			return frappe.urllib.get_full_url(file_url);
		}
		return file_url;
	}

	function encode_item_code(code) {
		// Preserve hyphens, plus signs, etc. in HTML data attributes.
		return encodeURIComponent(cstr_code(code));
	}

	function cstr_code(code) {
		return String(code == null ? "" : code).trim();
	}

	function read_item_code($el) {
		const raw = $el.attr("data-code");
		if (raw == null || raw === "") return "";
		try {
			return decodeURIComponent(String(raw));
		} catch (e) {
			return String(raw);
		}
	}

	function focus_product(code) {
		/** Highlight / scroll only — never wipe multi-select or typed qtys. */
		code = cstr_code(code);
		active_product = code || "";
		if (code) selected_products.add(code);
		render_catalog();
		load_transfer_lines();
		if (code) {
			const $section = $grid().closest(".form-section");
			if ($section.length) {
				$section[0].scrollIntoView({ behavior: "smooth", block: "start" });
			}
		}
	}

	function toggle_product_selection(code, checked) {
		code = cstr_code(code);
		if (checked) {
			selected_products.add(code);
			active_product = code;
		} else {
			selected_products.delete(code);
			if (active_product === code) active_product = "";
		}
		load_transfer_lines();
	}

	const form = new frappe.ui.FieldGroup({
		body: page.body,
		card_layout: true,
		fields: [
			{
				fieldtype: "Section Break",
				description: __(
					"Transfer stock between warehouses. Only products with stock at From appear. Tick products (Select page / Select all matching), then Use all available to fill sellable qty — or type qty per line. Available = on-hand minus layby holds."
				),
			},
			{
				fieldname: "source_warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("From (source)"),
				reqd: 1,
				description: __("Where stock leaves from — choose deliberately (Central or a store)."),
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
				onchange: () => {
					if (suppress_source_onchange) return;
					on_source_change();
				},
			},
			{ fieldtype: "Column Break" },
			{
				fieldname: "target_warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("To (branch)"),
				reqd: 1,
				description: __("Destination branch — must differ from From."),
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
			},
			{ fieldtype: "Section Break", label: __("Products at source") },
			{
				fieldname: "product",
				fieldtype: "Link",
				options: "Item",
				label: __("Filter product (optional)"),
				get_query() {
					const source = form.get_value("source_warehouse");
					if (!source) {
						frappe.show_alert({
							message: __("Select a source warehouse first."),
							indicator: "orange",
						});
					}
					return {
						query: "kqs_retail.api.stock_transfer.item_link_query",
						filters: { source_warehouse: source || "" },
					};
				},
				onchange: () => on_product_filter_change(),
			},
			{ fieldname: "catalog_browser", fieldtype: "HTML" },
			{ fieldtype: "Section Break", label: __("Quantities to transfer") },
			{ fieldname: "variant_grid", fieldtype: "HTML" },
		],
	});
	form.make();
	form.wrapper.addClass("kqs-assign-branch-form");
	$(page.body).css({ paddingTop: "1.5rem", paddingBottom: "1rem" });
	form.wrapper.css("padding-bottom", "3rem");

	const $catalog = () => form.get_field("catalog_browser").$wrapper;
	const $grid = () => form.get_field("variant_grid").$wrapper;

	function render_catalog_toolbar() {
		return `<div class="kqs-catalog-toolbar mb-3">
			<div class="flex align-center justify-between flex-wrap" style="gap:8px;">
				<input type="search" class="form-control kqs-catalog-search input-sm"
					placeholder="${__("Search products at source…")}"
					value="${frappe.utils.escape_html(catalog_search)}" style="max-width:320px;" />
				<div class="flex align-center flex-wrap" style="gap:6px;">
					<span class="text-muted small kqs-catalog-count"></span>
					<button type="button" class="btn btn-default btn-sm kqs-select-page" title="${__(
						"Tick every product on this page"
					)}">${__("Select page")}</button>
					<button type="button" class="btn btn-default btn-sm kqs-select-all-matching" title="${__(
						"Tick every product with stock at From (honours search filter)"
					)}">${__("Select all matching")}</button>
					<button type="button" class="btn btn-default btn-sm kqs-clear-selection">${__(
						"Clear selection"
					)}</button>
					<div class="btn-group">
						<button type="button" class="btn btn-default btn-sm kqs-view-list ${
							catalog_view === "list" ? "active" : ""
						}" title="${__("List view")}">
							<i class="fa fa-list"></i>
						</button>
						<button type="button" class="btn btn-default btn-sm kqs-view-grid ${
							catalog_view === "grid" ? "active" : ""
						}" title="${__("Image view")}">
							<i class="fa fa-th-large"></i>
						</button>
					</div>
				</div>
			</div>
		</div>`;
	}

	function render_catalog_list() {
		if (!catalog_rows.length) {
			return `<p class="text-muted">${__(
				"No products with stock at this source warehouse."
			)}</p>`;
		}
		const rows = catalog_rows
			.map((row) => {
				const checked = selected_products.has(row.item_code) ? "checked" : "";
				const active =
					active_product === row.item_code || form.get_value("product") === row.item_code
						? "kqs-catalog-active"
						: "";
				const variant_hint = row.has_variants
					? `<span class="indicator-pill gray">${__("Has variants")}</span>`
					: "";
				const style = row.style_code || row.item_code;
				return `<tr class="kqs-catalog-row ${active}" data-code="${encode_item_code(row.item_code)}">
					<td style="width:36px;">
						<input type="checkbox" class="kqs-catalog-check" ${checked} />
					</td>
					<td style="width:48px;">
						<img src="${item_image_url(row.image)}" alt="" class="kqs-catalog-thumb" />
					</td>
					<td>
						<div class="bold">${frappe.utils.escape_html(row.item_name)}</div>
						<div class="text-muted small">${__("Style")}: ${frappe.utils.escape_html(style)}</div>
					</td>
					<td>${frappe.utils.escape_html(row.item_group || "")}</td>
					<td>${variant_hint}</td>
					<td class="text-right">${format_float(row.available_qty)}</td>
				</tr>`;
			})
			.join("");

		return `<div class="kqs-catalog-list">
			<table class="table table-hover table-bordered">
				<thead><tr>
					<th style="width:36px;"><input type="checkbox" class="kqs-catalog-check-all" title="${__("Select all")}" /></th>
					<th></th>
					<th>${__("Product")}</th>
					<th>${__("Category")}</th>
					<th></th>
					<th class="text-right">${__("Available")}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}

	function render_catalog_grid() {
		if (!catalog_rows.length) {
			return `<p class="text-muted">${__(
				"No products with stock at this source warehouse."
			)}</p>`;
		}
		const cards = catalog_rows
			.map((row) => {
				const checked = selected_products.has(row.item_code) ? "checked" : "";
				const active =
					active_product === row.item_code || form.get_value("product") === row.item_code
						? "kqs-catalog-active"
						: "";
				const style = row.style_code || row.item_code;
				return `<div class="kqs-catalog-card ${active}" data-code="${encode_item_code(row.item_code)}">
					<label class="kqs-catalog-card-inner">
						<input type="checkbox" class="kqs-catalog-check" ${checked} />
						<img src="${item_image_url(row.image)}" alt="" class="kqs-catalog-card-img" />
						<div class="kqs-catalog-card-body">
							<div class="bold ellipsis" title="${frappe.utils.escape_html(row.item_name)}">${frappe.utils.escape_html(row.item_name)}</div>
							<div class="text-muted small ellipsis">${frappe.utils.escape_html(style)}</div>
							<div class="text-muted small">${format_float(row.available_qty)} ${__("available")}</div>
						</div>
					</label>
				</div>`;
			})
			.join("");

		return `<div class="kqs-catalog-grid">${cards}</div>`;
	}

	function ensure_catalog_shell() {
		if (catalog_shell_ready && $catalog().find(".kqs-catalog-shell").length) {
			return;
		}
		$catalog().html(`<div class="kqs-catalog-shell">
			${render_catalog_toolbar()}
			<div class="kqs-catalog-hint"></div>
			<div class="kqs-catalog-body"></div>
			<div class="kqs-catalog-footer"></div>
		</div>`);
		const $root = $catalog();
		$root.find(".kqs-catalog-search").on(
			"input",
			frappe.utils.debounce(function () {
				catalog_search = $(this).val() || "";
				load_catalog(true);
			}, 300)
		);
		$root.find(".kqs-view-list").on("click", () => {
			catalog_view = "list";
			render_catalog();
		});
		$root.find(".kqs-view-grid").on("click", () => {
			catalog_view = "grid";
			render_catalog();
		});
		$root.find(".kqs-select-page").on("click", () => select_catalog_page());
		$root.find(".kqs-select-all-matching").on("click", () => select_all_matching_at_source());
		$root.find(".kqs-clear-selection").on("click", () => {
			selected_products.clear();
			active_product = "";
			qty_by_code = {};
			transfer_lines = [];
			form.set_value("product", "");
			render_catalog();
			render_transfer_grid();
		});
		catalog_shell_ready = true;
	}

	function select_catalog_page() {
		catalog_rows.forEach((row) => selected_products.add(row.item_code));
		if (catalog_rows.length) active_product = catalog_rows[0].item_code;
		render_catalog();
		load_transfer_lines(() => fill_available_quantities({ only_checked: false, silent: true }));
		frappe.show_alert({
			message: __("Selected {0} on this page — available qty filled below.", [
				catalog_rows.length,
			]),
			indicator: "blue",
		});
	}

	function select_all_matching_at_source() {
		const source = form.get_value("source_warehouse");
		if (!source) {
			frappe.msgprint(__("Select a source warehouse first."));
			return;
		}
		frappe.call({
			method: "kqs_retail.api.stock_transfer.list_source_catalog",
			args: {
				source_warehouse: source,
				search: catalog_search,
				start: 0,
				limit: 5000,
				all_pages: 1,
			},
			freeze: true,
			freeze_message: __("Selecting products…"),
			callback(r) {
				if (r.exc) return;
				const items = (r.message && r.message.items) || [];
				if (!items.length) {
					frappe.show_alert({
						message: __("No products with stock to select."),
						indicator: "orange",
					});
					return;
				}
				selected_products.clear();
				items.forEach((row) => selected_products.add(row.item_code));
				active_product = items[0].item_code;
				render_catalog();
				load_transfer_lines(() =>
					fill_available_quantities({ only_checked: false, silent: true })
				);
				frappe.show_alert({
					message: __("Selected {0} product(s) — available qty filled below. Review and Transfer Stock.", [
						items.length,
					]),
					indicator: "green",
				});
			},
		});
	}

	function bind_catalog_body_events() {
		const $root = $catalog();

		$root.find(".kqs-catalog-check-all").off("change.kqs").on("change.kqs", function () {
			const checked = $(this).is(":checked");
			catalog_rows.forEach((row) => {
				if (checked) selected_products.add(row.item_code);
				else selected_products.delete(row.item_code);
			});
			if (!checked) active_product = "";
			render_catalog();
			load_transfer_lines();
		});

		$root.find(".kqs-catalog-check").off("change.kqs").on("change.kqs", function () {
			const $row = $(this).closest("[data-code]");
			const code = read_item_code($row);
			toggle_product_selection(code, $(this).is(":checked"));
		});

		$root
			.find(".kqs-catalog-row, .kqs-catalog-card")
			.off("click.kqs")
			.on("click.kqs", function (e) {
				if ($(e.target).is("input, label, a, button")) return;
				const code = read_item_code($(this));
				// Avoid Link-field onchange racing and rewriting a hyphenated style.
				suppress_product_onchange = true;
				const done = () => {
					suppress_product_onchange = false;
				};
				const set_p = form.set_value("product", code);
				if (set_p && typeof set_p.finally === "function") {
					set_p.finally(done);
				} else if (set_p && typeof set_p.always === "function") {
					set_p.always(done);
				} else {
					setTimeout(done, 0);
				}
				focus_product(code);
			});

		$root
			.find(".kqs-catalog-load-more")
			.off("click.kqs")
			.on("click.kqs", () => load_catalog(false));
	}

	function render_catalog() {
		const source = form.get_value("source_warehouse");
		if (!source) {
			catalog_shell_ready = false;
			$catalog().html(
				`<p class="text-muted">${__("Select a source warehouse to browse products.")}</p>`
			);
			return;
		}

		ensure_catalog_shell();
		const $root = $catalog();
		// Keep the search input node — only refresh results so focus/cursor stay while typing.
		$root.find(".kqs-view-list").toggleClass("active", catalog_view === "list");
		$root.find(".kqs-view-grid").toggleClass("active", catalog_view === "grid");

		const body =
			catalog_view === "grid" ? render_catalog_grid() : render_catalog_list();
		const load_more =
			catalog_rows.length < catalog_total
				? `<button type="button" class="btn btn-default btn-sm mt-2 kqs-catalog-load-more">${__(
						"Load more"
				  )}</button>`
				: "";

		let empty_hint = "";
		if (!catalog_rows.length) {
			const q = catalog_search ? frappe.utils.escape_html(catalog_search) : "";
			empty_hint = `<div class="alert alert-warning" style="margin-top:0.75rem;">
				${
					q
						? __(
								"No stock at <b>{0}</b> matching “{1}”. Assign only lists products that already have qty at the From warehouse. Check Edit Product → stock by warehouse, or change From (e.g. Central), or Receive Stock first.",
								[frappe.utils.escape_html(source), q]
						  )
						: __(
								"No stock at <b>{0}</b>. The Items list shows the whole catalog; Assign only shows products with qty at this From warehouse. Receive into Central (or change From), then try again.",
								[frappe.utils.escape_html(source)]
						  )
				}
			</div>`;
		}

		$root.find(".kqs-catalog-hint").html(empty_hint);
		$root.find(".kqs-catalog-body").html(body);
		$root.find(".kqs-catalog-footer").html(load_more);
		$root.find(".kqs-catalog-count").text(
			__("{0} product(s) with stock at {1}", [catalog_total, source])
		);
		bind_catalog_body_events();
	}

	function capture_qty_values() {
		$grid()
			.find(".kqs-assign-row")
			.each(function () {
				const code = read_item_code($(this));
				const qty = $(this).find(".kqs-assign-qty").val();
				if (qty !== undefined && qty !== null && String(qty).trim() !== "") {
					qty_by_code[code] = qty;
				} else {
					delete qty_by_code[code];
				}
			});
	}

	function clear_assign_qty_fields() {
		qty_by_code = {};
		$grid().find(".kqs-assign-qty").val("");
	}

	function render_transfer_grid() {
		capture_qty_values();

		if (!transfer_lines.length) {
			$grid().html(
				`<p class="text-muted">${__(
					"Tick products above (or Select page / Select all matching), then Use all available to fill sellable qty — or type qty per line."
				)}</p>`
			);
			return;
		}

		const grouped = {};
		transfer_lines.forEach((line) => {
			const key = line.template_code || line.style_code || line.item_code;
			if (!grouped[key]) {
				grouped[key] = {
					template_name: line.template_name || line.item_name,
					style_code: line.style_code || line.template_code || key,
					lines: [],
				};
			}
			grouped[key].lines.push(line);
		});

		const line_count = transfer_lines.length;
		const with_stock = transfer_lines.filter((l) => (parseFloat(l.available_qty) || 0) > 0).length;
		const toolbar = `<div class="kqs-transfer-toolbar flex align-center flex-wrap mb-3" style="gap:8px;">
			<span class="text-muted small">${__("{0} line(s) · {1} with sellable stock", [
				line_count,
				with_stock,
			])}</span>
			<button type="button" class="btn btn-sm btn-primary kqs-fill-available" title="${__(
				"Set transfer qty = available sellable for every line below"
			)}">${__("Use all available")}</button>
			<button type="button" class="btn btn-sm btn-default kqs-fill-checked" title="${__(
				"Only fill rows you ticked in the qty table"
			)}">${__("Use available for checked")}</button>
			<button type="button" class="btn btn-sm btn-default kqs-clear-qty">${__(
				"Clear quantities"
			)}</button>
		</div>`;

		const sections = Object.values(grouped)
			.map((group) => {
				const show_variant_cols = group.lines.some((line) => line.attributes);
				const rows = group.lines
					.map((line) => {
						const attr_label = line.attributes
							? frappe.utils.escape_html(line.attributes)
							: `<span class="text-muted">${__("—")}</span>`;
						const sku = frappe.utils.escape_html(line.variant_sku || line.item_code);
						const saved_qty = qty_by_code[line.item_code] || "";
						const max_qty = line.available_qty || 0;
						const disabled = max_qty <= 0 ? "disabled" : "";
						return `<tr class="kqs-assign-row" data-code="${encode_item_code(line.item_code)}">
							<td style="width:36px;"><input type="checkbox" class="kqs-line-check" ${
								max_qty <= 0 ? "disabled" : ""
							} /></td>
							<td>${attr_label}</td>
							<td class="text-muted small">${sku}</td>
							<td class="text-right text-muted">${format_float(line.available_qty)}</td>
							<td><input type="number" min="0" step="1" max="${max_qty || ""}"
								class="form-control input-sm kqs-assign-qty" placeholder="${__("Qty")}"
								style="width:100px;" value="${saved_qty}" ${disabled} /></td>
						</tr>`;
					})
					.join("");
				return `<div class="kqs-transfer-group mb-4">
					<div class="kqs-transfer-group-head mb-2">
						<h6 class="mt-0 mb-1">${frappe.utils.escape_html(group.template_name)}</h6>
						<div class="text-muted small">${__("Style")}: ${frappe.utils.escape_html(group.style_code)}</div>
					</div>
					<table class="table table-bordered table-sm kqs-transfer-grid">
						<thead><tr>
							<th style="width:36px;"><input type="checkbox" class="kqs-line-check-all" title="${__(
								"Check all lines in this product"
							)}" /></th>
							<th>${show_variant_cols ? __("Variant") : __("Product")}</th>
							<th>${__("SKU")}</th>
							<th class="text-right">${__("Available")}</th>
							<th style="width:120px;">${__("Transfer qty")}</th>
						</tr></thead>
						<tbody>${rows}</tbody>
					</table>
				</div>`;
			})
			.join("");

		$grid().html(toolbar + sections);
		// Per-group "check all" only affects that table
		$grid()
			.find(".kqs-transfer-group")
			.each(function () {
				const $g = $(this);
				$g.find(".kqs-line-check-all")
					.off("change.kqs")
					.on("change.kqs", function () {
						$g.find(".kqs-line-check:not(:disabled)").prop("checked", $(this).is(":checked"));
					});
			});
		bind_transfer_grid_events();
	}

	function load_catalog(reset = true) {
		const source = form.get_value("source_warehouse");
		if (!source) {
			catalog_rows = [];
			catalog_total = 0;
			catalog_shell_ready = false;
			render_catalog();
			return;
		}
		if (reset) {
			catalog_start = 0;
			catalog_rows = [];
		}
		const seq = ++catalog_seq;
		frappe.call({
			method: "kqs_retail.api.stock_transfer.list_source_catalog",
			args: {
				source_warehouse: source,
				search: catalog_search,
				start: catalog_start,
				limit: catalog_limit,
			},
			callback(r) {
				if (r.exc) return;
				if (seq !== catalog_seq) return;
				const msg = r.message || {};
				const items = msg.items || [];
				catalog_total = msg.total || 0;
				catalog_rows = reset ? items : catalog_rows.concat(items);
				catalog_start = catalog_rows.length;
				render_catalog();
			},
		});
	}

	function load_transfer_lines(after_load) {
		const source = form.get_value("source_warehouse");
		const codes = Array.from(selected_products);
		capture_qty_values();
		if (!source || !codes.length) {
			transfer_lines = [];
			render_transfer_grid();
			if (typeof after_load === "function") after_load();
			return;
		}
		const seq = ++transfer_lines_seq;
		frappe.call({
			method: "kqs_retail.api.stock_transfer.get_bulk_transfer_lines",
			args: {
				item_codes: JSON.stringify(codes),
				source_warehouse: source,
				in_stock_only: 1,
			},
			callback(r) {
				if (r.exc) return;
				if (seq !== transfer_lines_seq) return;
				transfer_lines = (r.message && r.message.lines) || [];
				render_transfer_grid();
				if (typeof after_load === "function") after_load();
			},
		});
	}

	function fill_available_quantities(opts) {
		opts = opts || {};
		const only_checked = !!opts.only_checked;
		capture_qty_values();
		let filled = 0;
		$grid()
			.find(".kqs-assign-row")
			.each(function () {
				const $row = $(this);
				if (only_checked && !$row.find(".kqs-line-check").is(":checked")) return;
				const code = read_item_code($row);
				const line = transfer_lines.find((l) => cstr_code(l.item_code) === code);
				const max_qty = parseFloat((line && line.available_qty) || $row.find(".kqs-assign-qty").attr("max") || 0) || 0;
				if (max_qty <= 0) return;
				const qty_str = String(max_qty);
				$row.find(".kqs-assign-qty").val(qty_str);
				qty_by_code[code] = qty_str;
				filled += 1;
			});
		if (!opts.silent) {
			if (!filled) {
				frappe.show_alert({
					message: only_checked
						? __("Tick variant rows first, or use Use all available.")
						: __("No sellable qty to fill — select products above."),
					indicator: "orange",
				});
			} else {
				frappe.show_alert({
					message: __("Filled available qty on {0} line(s).", [filled]),
					indicator: "green",
				});
			}
		}
		return filled;
	}

	function clear_transfer_quantities() {
		qty_by_code = {};
		$grid().find(".kqs-assign-qty").val("");
		$grid().find(".kqs-line-check").prop("checked", false);
		$grid().find(".kqs-line-check-all").prop("checked", false);
	}

	function bind_transfer_grid_events() {
		const $root = $grid();
		$root.find(".kqs-fill-available").off("click.kqs").on("click.kqs", () => {
			fill_available_quantities({ only_checked: false });
		});
		$root.find(".kqs-fill-checked").off("click.kqs").on("click.kqs", () => {
			fill_available_quantities({ only_checked: true });
		});
		$root.find(".kqs-clear-qty").off("click.kqs").on("click.kqs", () => {
			clear_transfer_quantities();
		});
	}

	function clear_draft_selection() {
		selected_products.clear();
		active_product = "";
		qty_by_code = {};
		transfer_lines = [];
		form.set_value("product", "");
		catalog_search = "";
		catalog_shell_ready = false;
		render_transfer_grid();
	}

	function on_source_change() {
		const source = form.get_value("source_warehouse") || "";
		const has_draft =
			selected_products.size > 0 || Object.keys(qty_by_code).some((k) => qty_by_code[k]);
		const source_changed =
			last_source_warehouse && source && source !== last_source_warehouse;

		const finish = () => {
			last_source_warehouse = source;
			clear_draft_selection();
			load_catalog(true);
		};

		if (source_changed && has_draft) {
			frappe.confirm(
				__("Changing source clears selected products and quantities. Continue?"),
				() => finish(),
				() => {
					suppress_source_onchange = true;
					const p = form.set_value("source_warehouse", last_source_warehouse);
					const done = () => {
						suppress_source_onchange = false;
					};
					if (p && typeof p.finally === "function") p.finally(done);
					else if (p && typeof p.always === "function") p.always(done);
					else setTimeout(done, 0);
				}
			);
			return;
		}
		finish();
	}

	function on_product_filter_change() {
		if (suppress_product_onchange) return;
		const product = cstr_code(form.get_value("product"));
		if (!product) {
			active_product = "";
			load_catalog(true);
			render_transfer_grid();
			return;
		}
		catalog_search = "";
		focus_product(product);
		load_catalog(true);
	}

	frappe.call({
		method: "kqs_retail.api.stock_transfer.get_transfer_defaults",
		callback(r) {
			// Do not auto-fill Central — prompt so the right branches are chosen.
			prompt_choose_branches();
		},
	});

	function remember_assign_pair(source, target) {
		try {
			if (source) localStorage.setItem("kqs_last_assign_from", source);
			if (target) localStorage.setItem("kqs_last_assign_to", target);
		} catch (e) {
			/* ignore */
		}
	}

	function prompt_choose_branches() {
		let last_from = "";
		let last_to = "";
		try {
			last_from = localStorage.getItem("kqs_last_assign_from") || "";
			last_to = localStorage.getItem("kqs_last_assign_to") || "";
		} catch (e) {
			/* ignore */
		}
		const cur_from = cstr_code(form.get_value("source_warehouse"));
		const cur_to = cstr_code(form.get_value("target_warehouse"));
		if (cur_from && cur_to && cur_from !== cur_to) {
			last_source_warehouse = cur_from;
			load_catalog(true);
			return;
		}
		const d = new frappe.ui.Dialog({
			title: __("Choose From and To branches"),
			fields: [
				{
					fieldname: "source_warehouse",
					fieldtype: "Link",
					options: "Warehouse",
					label: __("From (source)"),
					reqd: 1,
					default: cur_from || last_from || "",
					description: __("Stock leaves this warehouse."),
					get_query() {
						return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
					},
				},
				{
					fieldname: "target_warehouse",
					fieldtype: "Link",
					options: "Warehouse",
					label: __("To (branch)"),
					reqd: 1,
					default: cur_to || last_to || "",
					description: __("Stock arrives here — must be a different branch."),
					get_query() {
						return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
					},
				},
			],
			primary_action_label: __("Continue"),
			primary_action(values) {
				const source = cstr_code(values.source_warehouse);
				const target = cstr_code(values.target_warehouse);
				if (!source || !target) {
					frappe.msgprint(__("Select both From and To warehouses."));
					return;
				}
				if (source === target) {
					frappe.msgprint(__("From and To must be different."));
					return;
				}
				remember_assign_pair(source, target);
				d.hide();
				suppress_source_onchange = true;
				Promise.resolve(form.set_value("source_warehouse", source))
					.then(() => form.set_value("target_warehouse", target))
					.finally(() => {
						suppress_source_onchange = false;
						last_source_warehouse = source;
						clear_draft_selection();
						load_catalog(true);
					});
			},
		});
		d.show();
	}

	page.set_primary_action(__("Transfer Stock"), () => {
		if (save_in_progress) return;
		const source = form.get_value("source_warehouse");
		const target = form.get_value("target_warehouse");
		if (!source || !target) {
			frappe.msgprint(__("Select source and target warehouses."));
			return;
		}
		if (source === target) {
			frappe.msgprint(__("Source and target must be different."));
			return;
		}

		capture_qty_values();
		const items = [];
		$grid()
			.find(".kqs-assign-row")
			.each(function () {
				const code = read_item_code($(this));
				const qty = parseFloat($(this).find(".kqs-assign-qty").val()) || 0;
				if (qty > 0) items.push({ item_code: code, qty });
			});
		if (!items.length) {
			frappe.msgprint(__("Enter quantity for at least one item."));
			return;
		}

		save_in_progress = true;
		frappe.call({
			method: "kqs_retail.api.stock_transfer.assign_stock_to_branch",
			args: {
				source_warehouse: source,
				target_warehouse: target,
				items: JSON.stringify(items),
			},
			freeze: true,
			callback(r) {
				save_in_progress = false;
				if (!r.exc && r.message) {
					frappe.show_alert({
						message: __("Stock transfer {0} submitted.", [r.message.stock_entry]),
						indicator: "green",
					});
					clear_assign_qty_fields();
					selected_products.clear();
					active_product = "";
					form.set_value("product", "");
					transfer_lines = [];
					render_transfer_grid();
					load_catalog(true);
				}
			},
			error() {
				save_in_progress = false;
			},
		});
	});

	// Page-scoped styles (list + image view like Item list)
	if (!$("#kqs-assign-branch-style").length) {
		$("head").append(`<style id="kqs-assign-branch-style">
			.page-container[data-page-route="assign-to-branch"] .page-body,
			.page-container[data-page-route="assign-to-branch"] .layout-main-section {
				padding-top: 1.5rem;
			}
			.kqs-assign-branch-form .form-section.card-section:first-child {
				margin-top: 0.25rem;
			}
			.kqs-catalog-thumb { width:40px; height:40px; object-fit:cover; border-radius:4px; }
			.kqs-catalog-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; }
			.kqs-catalog-card { border:1px solid var(--border-color,#d1d8dd); border-radius:6px; overflow:hidden; cursor:pointer; }
			.kqs-catalog-card-inner { display:block; margin:0; cursor:pointer; }
			.kqs-catalog-card-inner input { position:absolute; opacity:0; }
			.kqs-catalog-card:has(input:checked) { border-color:var(--primary,#171717); box-shadow:0 0 0 1px var(--primary,#171717); }
			.kqs-catalog-card.kqs-catalog-active,
			.kqs-catalog-row.kqs-catalog-active { background:var(--highlight-color,#f7fafc); }
			.kqs-catalog-card.kqs-catalog-active { border-color:var(--primary,#171717); }
			.kqs-catalog-card-img { width:100%; height:120px; object-fit:cover; display:block; background:#f4f5f6; }
			.kqs-catalog-card-body { padding:8px; }
			.kqs-catalog-toolbar .btn.active { background:var(--fg-color,#fff); border-color:var(--primary,#171717); }
			.kqs-catalog-row { cursor:pointer; }
			.kqs-transfer-group:last-child { margin-bottom:0 !important; }
		</style>`);
	}

	wrapper.kqs_assign_form = form;
};

frappe.pages["assign-to-branch"].on_page_show = function (wrapper) {
	if (frappe.app.sidebar) {
		frappe.app.sidebar.setup("Stock");
	}
	const page_body = wrapper && $(wrapper).find(".page-body");
	if (page_body && page_body.length) {
		page_body.css({ paddingTop: "1.5rem", paddingBottom: "1rem" });
	}
};
