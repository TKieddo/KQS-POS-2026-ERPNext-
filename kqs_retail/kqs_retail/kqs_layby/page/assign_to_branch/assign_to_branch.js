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
	let selected_products = new Set();
	let active_product = "";
	let transfer_lines = [];
	let qty_by_code = {};

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

	function select_single_product(code) {
		selected_products.clear();
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
		if (checked) selected_products.add(code);
		else {
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
					"Transfer stock between warehouses. Only products with stock at the source are shown."
				),
			},
			{
				fieldname: "source_warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("From (source)"),
				reqd: 1,
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
				onchange: () => on_source_change(),
			},
			{ fieldtype: "Column Break" },
			{
				fieldname: "target_warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("To (branch)"),
				reqd: 1,
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
		return `<div class="kqs-catalog-toolbar flex align-center justify-between mb-3">
			<input type="search" class="form-control kqs-catalog-search input-sm"
				placeholder="${__("Search products at source…")}"
				value="${frappe.utils.escape_html(catalog_search)}" style="max-width:320px;" />
			<div class="flex align-center">
				<span class="text-muted small mr-3 kqs-catalog-count"></span>
				<div class="btn-group">
					<button type="button" class="btn btn-default btn-sm kqs-view-list ${catalog_view === "list" ? "active" : ""}" title="${__("List view")}">
						<i class="fa fa-list"></i>
					</button>
					<button type="button" class="btn btn-default btn-sm kqs-view-grid ${catalog_view === "grid" ? "active" : ""}" title="${__("Image view")}">
						<i class="fa fa-th-large"></i>
					</button>
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
				return `<tr class="kqs-catalog-row ${active}" data-code="${frappe.utils.escape_html(row.item_code)}">
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
				return `<div class="kqs-catalog-card ${active}" data-code="${frappe.utils.escape_html(row.item_code)}">
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

	function render_catalog() {
		const source = form.get_value("source_warehouse");
		if (!source) {
			$catalog().html(
				`<p class="text-muted">${__("Select a source warehouse to browse products.")}</p>`
			);
			return;
		}

		const body = catalog_view === "grid" ? render_catalog_grid() : render_catalog_list();
		const load_more =
			catalog_start + catalog_rows.length < catalog_total
				? `<button type="button" class="btn btn-default btn-sm mt-2 kqs-catalog-load-more">${__(
						"Load more"
				  )}</button>`
				: "";

		$catalog().html(`${render_catalog_toolbar()}${body}${load_more}`);
		$catalog().find(".kqs-catalog-count").text(
			__("{0} product(s) at source", [catalog_total])
		);
		bind_catalog_events();
	}

	function bind_catalog_events() {
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

		$root.find(".kqs-catalog-check-all").on("change", function () {
			const checked = $(this).is(":checked");
			catalog_rows.forEach((row) => {
				if (checked) selected_products.add(row.item_code);
				else selected_products.delete(row.item_code);
			});
			if (!checked) active_product = "";
			render_catalog();
			load_transfer_lines();
		});

		$root.find(".kqs-catalog-check").on("change", function () {
			const $row = $(this).closest("[data-code]");
			const code = $row.data("code");
			toggle_product_selection(code, $(this).is(":checked"));
		});

		$root.find(".kqs-catalog-row, .kqs-catalog-card").on("click", function (e) {
			if ($(e.target).is("input, label, a, button")) return;
			const code = $(this).data("code");
			form.set_value("product", code);
			select_single_product(code);
		});

		$root.find(".kqs-catalog-load-more").on("click", () => load_catalog(false));
	}

	function capture_qty_values() {
		$grid()
			.find(".kqs-assign-row")
			.each(function () {
				const code = $(this).data("code");
				const qty = $(this).find(".kqs-assign-qty").val();
				if (qty) qty_by_code[code] = qty;
			});
	}

	function render_transfer_grid() {
		capture_qty_values();

		if (!transfer_lines.length) {
			$grid().html(
				`<p class="text-muted">${__(
					"Click a product above to see its variants, or tick products to transfer several at once."
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
						return `<tr class="kqs-assign-row" data-code="${frappe.utils.escape_html(line.item_code)}">
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

		$grid().html(sections);
	}

	function load_catalog(reset = true) {
		const source = form.get_value("source_warehouse");
		if (!source) {
			catalog_rows = [];
			catalog_total = 0;
			render_catalog();
			return;
		}
		if (reset) {
			catalog_start = 0;
			catalog_rows = [];
		}
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
				const msg = r.message || {};
				const items = msg.items || [];
				catalog_total = msg.total || 0;
				catalog_rows = reset ? items : catalog_rows.concat(items);
				catalog_start = catalog_rows.length;
				render_catalog();
			},
		});
	}

	function load_transfer_lines() {
		const source = form.get_value("source_warehouse");
		const codes = Array.from(selected_products);
		if (!source || !codes.length) {
			transfer_lines = [];
			render_transfer_grid();
			return;
		}
		frappe.call({
			method: "kqs_retail.api.stock_transfer.get_bulk_transfer_lines",
			args: {
				item_codes: JSON.stringify(codes),
				source_warehouse: source,
				in_stock_only: 0,
			},
			callback(r) {
				if (r.exc) return;
				transfer_lines = (r.message && r.message.lines) || [];
				render_transfer_grid();
			},
		});
	}

	function on_source_change() {
		selected_products.clear();
		active_product = "";
		qty_by_code = {};
		transfer_lines = [];
		form.set_value("product", "");
		catalog_search = "";
		load_catalog(true);
		render_transfer_grid();
	}

	function on_product_filter_change() {
		const product = form.get_value("product");
		if (!product) {
			active_product = "";
			load_catalog(true);
			render_transfer_grid();
			return;
		}
		catalog_search = "";
		select_single_product(product);
		load_catalog(true);
	}

	frappe.call({
		method: "kqs_retail.api.stock_transfer.get_transfer_defaults",
		callback(r) {
			if (r.message?.source_warehouse) {
				form.set_value("source_warehouse", r.message.source_warehouse);
				on_source_change();
			}
		},
	});

	page.set_primary_action(__("Transfer Stock"), () => {
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
				const code = $(this).data("code");
				const qty = parseFloat($(this).find(".kqs-assign-qty").val()) || 0;
				if (qty > 0) items.push({ item_code: code, qty });
			});
		if (!items.length) {
			frappe.msgprint(__("Enter quantity for at least one item."));
			return;
		}

		frappe.call({
			method: "kqs_retail.api.stock_transfer.assign_stock_to_branch",
			args: {
				source_warehouse: source,
				target_warehouse: target,
				items: JSON.stringify(items),
			},
			freeze: true,
			callback(r) {
				if (!r.exc && r.message) {
					frappe.show_alert({
						message: __("Stock transfer {0} submitted.", [r.message.stock_entry]),
						indicator: "green",
					});
					qty_by_code = {};
					selected_products.clear();
					form.set_value("product", "");
					on_source_change();
				}
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
