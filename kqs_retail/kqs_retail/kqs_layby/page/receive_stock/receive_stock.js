frappe.pages["receive-stock"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Receive Stock"),
		single_column: true,
	});

	let catalog_rows = [];
	let catalog_has_more = false;
	let catalog_start = 0;
	const catalog_limit = 50;
	let catalog_view = "list";
	let catalog_search = "";
	let selected_products = new Set();
	let active_product = "";
	let receive_lines = [];
	let qty_by_code = {};
	let rate_by_code = {};

	function format_float(value) {
		return frappe.format(value, { fieldtype: "Float", precision: 2 });
	}

	function item_image_url(image) {
		if (!image) return "/assets/frappe/images/ui/no-image.svg";
		const raw = String(image).trim();
		if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("data:")) return raw;
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
		load_receive_lines();
	}

	function toggle_product_selection(code, checked) {
		if (checked) selected_products.add(code);
		else {
			selected_products.delete(code);
			if (active_product === code) active_product = "";
		}
		load_receive_lines();
	}

	const form = new frappe.ui.FieldGroup({
		body: page.body,
		card_layout: true,
		fields: [
			{
				fieldtype: "Section Break",
				description: __(
					"Receive inbound stock for products that already exist. Default warehouse is Central — then use Assign to Branch to send to stores. Zero-stock items are included."
				),
			},
			{
				fieldname: "warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("Receive into"),
				reqd: 1,
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
				onchange: () => on_warehouse_change(),
			},
			{ fieldtype: "Section Break", label: __("Products") },
			{ fieldname: "catalog_browser", fieldtype: "HTML" },
			{ fieldtype: "Section Break", label: __("Quantities to receive") },
			{ fieldname: "variant_grid", fieldtype: "HTML" },
		],
	});
	form.make();
	form.wrapper.addClass("kqs-receive-stock-form");
	$(page.body).css({ paddingTop: "1.5rem", paddingBottom: "1rem" });
	form.wrapper.css("padding-bottom", "3rem");

	const $catalog = () => form.get_field("catalog_browser").$wrapper;
	const $grid = () => form.get_field("variant_grid").$wrapper;

	function render_catalog_toolbar() {
		return `<div class="kqs-catalog-toolbar flex align-center justify-between mb-3">
			<input type="search" class="form-control kqs-catalog-search input-sm"
				placeholder="${__("Search products…")}"
				value="${frappe.utils.escape_html(catalog_search)}" style="max-width:320px;" />
			<div class="flex align-center">
				<span class="text-muted small mr-3 kqs-catalog-count"></span>
				<div class="btn-group">
					<button type="button" class="btn btn-default btn-sm kqs-view-list ${
						catalog_view === "list" ? "active" : ""
					}" title="${__("List view")}"><i class="fa fa-list"></i></button>
					<button type="button" class="btn btn-default btn-sm kqs-view-grid ${
						catalog_view === "grid" ? "active" : ""
					}" title="${__("Image view")}"><i class="fa fa-th-large"></i></button>
				</div>
			</div>
		</div>`;
	}

	function render_catalog_list() {
		if (!catalog_rows.length) {
			return `<p class="text-muted">${__("No products found.")}</p>`;
		}
		const rows = catalog_rows
			.map((row) => {
				const checked = selected_products.has(row.item_code) ? "checked" : "";
				const active = active_product === row.item_code ? "kqs-catalog-active" : "";
				const variant_hint = row.has_variants
					? `<span class="indicator-pill gray">${__("Has variants")}</span>`
					: "";
				const style = row.style_code || row.item_code;
				return `<tr class="kqs-catalog-row ${active}" data-code="${frappe.utils.escape_html(row.item_code)}">
					<td style="width:36px;"><input type="checkbox" class="kqs-catalog-check" ${checked} /></td>
					<td style="width:48px;"><img src="${item_image_url(row.image)}" alt="" class="kqs-catalog-thumb" /></td>
					<td>
						<div class="bold">${frappe.utils.escape_html(row.item_name)}</div>
						<div class="text-muted small">${__("Style")}: ${frappe.utils.escape_html(style)}</div>
					</td>
					<td>${frappe.utils.escape_html(row.item_group || "")}</td>
					<td>${variant_hint}</td>
					<td class="text-right">${format_float(row.available_qty || 0)}</td>
				</tr>`;
			})
			.join("");
		return `<div class="kqs-catalog-list">
			<table class="table table-hover table-bordered">
				<thead><tr>
					<th style="width:36px;"></th><th></th><th>${__("Product")}</th>
					<th>${__("Category")}</th><th></th>
					<th class="text-right">${__("On hand")}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}

	function render_catalog_grid() {
		if (!catalog_rows.length) {
			return `<p class="text-muted">${__("No products found.")}</p>`;
		}
		const cards = catalog_rows
			.map((row) => {
				const checked = selected_products.has(row.item_code) ? "checked" : "";
				const active = active_product === row.item_code ? "kqs-catalog-active" : "";
				const style = row.style_code || row.item_code;
				return `<div class="kqs-catalog-card ${active}" data-code="${frappe.utils.escape_html(row.item_code)}">
					<label class="kqs-catalog-card-inner">
						<input type="checkbox" class="kqs-catalog-check" ${checked} />
						<img src="${item_image_url(row.image)}" alt="" class="kqs-catalog-card-img" />
						<div class="kqs-catalog-card-body">
							<div class="bold ellipsis">${frappe.utils.escape_html(row.item_name)}</div>
							<div class="text-muted small ellipsis">${frappe.utils.escape_html(style)}</div>
							<div class="text-muted small">${format_float(row.available_qty || 0)} ${__("on hand")}</div>
						</div>
					</label>
				</div>`;
			})
			.join("");
		return `<div class="kqs-catalog-grid">${cards}</div>`;
	}

	function render_catalog() {
		const warehouse = form.get_value("warehouse");
		if (!warehouse) {
			$catalog().html(`<p class="text-muted">${__("Select a warehouse to browse products.")}</p>`);
			return;
		}
		const body = catalog_view === "grid" ? render_catalog_grid() : render_catalog_list();
		const load_more = catalog_has_more
			? `<button type="button" class="btn btn-default btn-sm mt-2 kqs-catalog-load-more">${__(
					"Load more"
			  )}</button>`
			: "";
		$catalog().html(`${render_catalog_toolbar()}${body}${load_more}`);
		$catalog()
			.find(".kqs-catalog-count")
			.text(__("{0} shown", [catalog_rows.length]));
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
		$root.find(".kqs-catalog-check").on("change", function () {
			const code = String($(this).closest("[data-code]").attr("data-code") || "");
			toggle_product_selection(code, $(this).is(":checked"));
		});
		$root.find(".kqs-catalog-row, .kqs-catalog-card").on("click", function (e) {
			if ($(e.target).is("input, label, a, button")) return;
			select_single_product(String($(this).attr("data-code") || ""));
		});
		$root.find(".kqs-catalog-load-more").on("click", () => load_catalog(false));
	}

	function capture_qty_values() {
		$grid()
			.find(".kqs-receive-row")
			.each(function () {
				// Use .attr — jQuery .data() coerces numeric item codes to ints.
				const code = String($(this).attr("data-code") || "");
				const qty = $(this).find(".kqs-receive-qty").val();
				const rate = $(this).find(".kqs-receive-rate").val();
				if (qty) qty_by_code[code] = qty;
				if (rate) rate_by_code[code] = rate;
			});
	}

	function render_receive_grid() {
		capture_qty_values();
		if (!receive_lines.length) {
			$grid().html(
				`<p class="text-muted">${__(
					"Click a product above to enter receive quantities per variant."
				)}</p>`
			);
			return;
		}

		const grouped = {};
		receive_lines.forEach((line) => {
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
						const saved_rate =
							rate_by_code[line.item_code] != null
								? rate_by_code[line.item_code]
								: line.rate || "";
						return `<tr class="kqs-receive-row" data-code="${frappe.utils.escape_html(line.item_code)}">
							<td>${attr_label}</td>
							<td class="text-muted small">${sku}</td>
							<td class="text-right text-muted">${format_float(line.on_hand || 0)}</td>
							<td><input type="number" min="0" step="1" class="form-control input-sm kqs-receive-qty"
								placeholder="${__("Qty")}" style="width:100px;" value="${saved_qty}" /></td>
							<td><input type="number" min="0" step="0.01" class="form-control input-sm kqs-receive-rate"
								placeholder="${__("Rate")}" style="width:100px;" value="${saved_rate}" /></td>
						</tr>`;
					})
					.join("");
				return `<div class="kqs-transfer-group mb-4">
					<div class="kqs-transfer-group-head mb-2">
						<h6 class="mt-0 mb-1">${frappe.utils.escape_html(group.template_name)}</h6>
						<div class="text-muted small">${__("Style")}: ${frappe.utils.escape_html(group.style_code)}</div>
					</div>
					<table class="table table-bordered table-sm">
						<thead><tr>
							<th>${show_variant_cols ? __("Variant") : __("Product")}</th>
							<th>${__("SKU")}</th>
							<th class="text-right">${__("On hand")}</th>
							<th style="width:120px;">${__("Receive qty")}</th>
							<th style="width:120px;">${__("Valuation rate")}</th>
						</tr></thead>
						<tbody>${rows}</tbody>
					</table>
				</div>`;
			})
			.join("");
		$grid().html(sections);
	}

	function load_catalog(reset = true) {
		const warehouse = form.get_value("warehouse");
		if (!warehouse) {
			catalog_rows = [];
			catalog_has_more = false;
			render_catalog();
			return;
		}
		if (reset) {
			catalog_start = 0;
			catalog_rows = [];
		}
		frappe.call({
			method: "kqs_retail.api.stock_receive.search_products_for_receive",
			args: {
				warehouse,
				query: catalog_search,
				start: catalog_start,
				limit: catalog_limit,
			},
			callback(r) {
				if (r.exc) return;
				const msg = r.message || {};
				const items = msg.items || [];
				catalog_has_more = !!msg.has_more;
				catalog_rows = reset ? items : catalog_rows.concat(items);
				catalog_start = catalog_rows.length;
				render_catalog();
			},
		});
	}

	function load_receive_lines() {
		const warehouse = form.get_value("warehouse");
		const codes = Array.from(selected_products);
		if (!warehouse || !codes.length) {
			receive_lines = [];
			render_receive_grid();
			return;
		}
		frappe.call({
			method: "kqs_retail.api.stock_receive.get_bulk_receive_lines",
			args: {
				item_codes: JSON.stringify(codes),
				warehouse,
			},
			callback(r) {
				if (r.exc) return;
				receive_lines = (r.message && r.message.lines) || [];
				render_receive_grid();
			},
		});
	}

	function on_warehouse_change() {
		selected_products.clear();
		active_product = "";
		qty_by_code = {};
		rate_by_code = {};
		receive_lines = [];
		catalog_search = "";
		load_catalog(true);
		render_receive_grid();
	}

	frappe.call({
		method: "kqs_retail.api.stock_receive.get_receive_defaults",
		callback(r) {
			if (r.message?.warehouse) {
				form.set_value("warehouse", r.message.warehouse);
				on_warehouse_change();
			}
		},
	});

	page.set_primary_action(__("Receive Stock"), () => {
		const warehouse = form.get_value("warehouse");
		if (!warehouse) {
			frappe.msgprint(__("Select a warehouse."));
			return;
		}
		capture_qty_values();
		const items = [];
		$grid()
			.find(".kqs-receive-row")
			.each(function () {
				const code = String($(this).attr("data-code") || "");
				const qty = parseFloat($(this).find(".kqs-receive-qty").val()) || 0;
				const rate = parseFloat($(this).find(".kqs-receive-rate").val()) || 0;
				if (qty > 0) items.push({ item_code: code, qty, rate });
			});
		if (!items.length) {
			frappe.msgprint(__("Enter quantity for at least one item."));
			return;
		}
		frappe.call({
			method: "kqs_retail.api.stock_receive.receive_stock",
			args: {
				warehouse,
				items_json: JSON.stringify(items),
			},
			freeze: true,
			callback(r) {
				if (!r.exc && r.message) {
					frappe.show_alert({
						message: __(
							"Received ({0}). Use Assign to Branch to send to stores.",
							[r.message.stock_entry]
						),
						indicator: "green",
					});
					qty_by_code = {};
					selected_products.clear();
					on_warehouse_change();
				}
			},
		});
	});

	if (page.set_secondary_action) {
		page.set_secondary_action(__("Assign to Branch"), () => {
			frappe.set_route("assign-to-branch");
		});
	}
	if (page.add_menu_item) {
		page.add_menu_item(__("Edit Product"), () => frappe.set_route("edit-product"));
		page.add_menu_item(__("Add Product"), () => frappe.set_route("quick-add-product"));
	}

	if (!$("#kqs-receive-stock-style").length) {
		$("head").append(`<style id="kqs-receive-stock-style">
			.kqs-catalog-thumb { width:40px; height:40px; object-fit:cover; border-radius:4px; }
			.kqs-catalog-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; }
			.kqs-catalog-card { border:1px solid var(--border-color,#d1d8dd); border-radius:6px; overflow:hidden; cursor:pointer; }
			.kqs-catalog-card-inner { display:block; margin:0; cursor:pointer; }
			.kqs-catalog-card-inner input { position:absolute; opacity:0; }
			.kqs-catalog-card:has(input:checked) { border-color:var(--primary,#171717); box-shadow:0 0 0 1px var(--primary,#171717); }
			.kqs-catalog-card.kqs-catalog-active,
			.kqs-catalog-row.kqs-catalog-active { background:var(--highlight-color,#f7fafc); }
			.kqs-catalog-card-img { width:100%; height:120px; object-fit:cover; display:block; background:#f4f5f6; }
			.kqs-catalog-card-body { padding:8px; }
			.kqs-catalog-toolbar .btn.active { background:var(--fg-color,#fff); border-color:var(--primary,#171717); }
			.kqs-catalog-row { cursor:pointer; }
		</style>`);
	}

	wrapper.kqs_receive_form = form;
};

frappe.pages["receive-stock"].on_page_show = function (wrapper) {
	if (frappe.app.sidebar) {
		frappe.app.sidebar.setup("Stock");
	}
};
