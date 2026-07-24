frappe.pages["edit-product"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Edit Product"),
		single_column: true,
	});

	let loaded_code = "";
	let selected_categories = [];
	let active_department_key = "";
	let category_sections = [];
	let attribute_catalog = [];
	let selected_attributes = [];
	let quick_fill_values = {};
	let existing_variants = [];
	let new_variant_rows = [];
	let product_images = [];
	let main_image_index = null;
	let save_in_progress = false;
	let editor_ready = false;

	const form = new frappe.ui.FieldGroup({
		body: page.body,
		card_layout: true,
		fields: [
			{
				fieldtype: "Section Break",
				description: __(
					"Find a style, then edit it like Add Product — name, price, photos, categories, and variants."
				),
			},
			{ fieldname: "search_html", fieldtype: "HTML" },
			{ fieldname: "product_section", fieldtype: "Section Break", label: __("Product") },
			{ fieldname: "editor_banner", fieldtype: "HTML" },
			{ fieldname: "item_name", fieldtype: "Data", label: __("Product Name"), reqd: 1 },
			{
				fieldname: "style_code",
				fieldtype: "Data",
				label: __("SKU / Style number"),
				read_only: 1,
				description: __("Style code cannot be changed after create."),
			},
			{ fieldtype: "Column Break" },
			{ fieldname: "product_images_picker", fieldtype: "HTML", label: __("Product images") },
			{ fieldtype: "Section Break", label: __("Details"), fieldname: "details_section" },
			{
				fieldname: "default_rate",
				fieldtype: "Currency",
				label: __("Price"),
				description: __("Default price. Override per variant in the table if needed."),
			},
			{
				fieldname: "stock_uom",
				fieldtype: "Link",
				options: "UOM",
				label: __("Unit of measure"),
				reqd: 1,
			},
			{ fieldname: "item_group", fieldtype: "Data", hidden: 1 },
			{
				fieldname: "category_picker",
				fieldtype: "HTML",
				label: __("Category"),
				reqd: 1,
				description: __("Select at least one category. Tap again to remove."),
			},
			{ fieldname: "description", fieldtype: "Small Text", label: __("Description") },
			{
				fieldname: "warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("Receive new variant stock into"),
				description: __(
					"Only used when you add new variants with opening qty. Existing stock is unchanged."
				),
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
			},
			{
				fieldname: "disabled",
				fieldtype: "Check",
				label: __("Disabled (hide from POS)"),
			},
			{
				fieldname: "existing_section",
				fieldtype: "Section Break",
				label: __("Existing variants"),
				description: __(
					"Edit price, barcode, image, or disable. Size/colour on existing SKUs cannot be changed — add a new variant instead."
				),
			},
			{ fieldname: "existing_grid", fieldtype: "HTML" },
			{
				fieldname: "quick_fill_section",
				fieldtype: "Section Break",
				label: __("Add new variants"),
				description: __(
					"Tap values for each attribute, then add combinations. New rows save when you click Save Changes."
				),
			},
			{ fieldname: "quick_fill_picker", fieldtype: "HTML" },
			{
				fieldname: "new_variants_section",
				fieldtype: "Section Break",
				label: __("New variants to create"),
			},
			{ fieldname: "new_variant_grid", fieldtype: "HTML" },
		],
	});
	form.make();
	form.wrapper.addClass("kqs-edit-product-form kqs-add-product-form");
	prevent_accidental_form_submit();
	mount_product_header_layout();
	$(page.body).css({ paddingTop: "1.5rem", paddingBottom: "1rem" });
	form.wrapper.css("padding-bottom", "3rem");

	const EDITOR_FIELDS = [
		"product_section",
		"editor_banner",
		"item_name",
		"style_code",
		"product_images_picker",
		"details_section",
		"default_rate",
		"stock_uom",
		"category_picker",
		"description",
		"warehouse",
		"disabled",
		"existing_section",
		"existing_grid",
		"quick_fill_section",
		"quick_fill_picker",
		"new_variants_section",
		"new_variant_grid",
	];

	function prevent_accidental_form_submit() {
		const block_enter = (e) => {
			if (e.key !== "Enter" || e.shiftKey) return;
			const tag = ((e.target && e.target.tagName) || "").toLowerCase();
			if (tag === "textarea") return;
			e.preventDefault();
			e.stopPropagation();
		};
		form.wrapper.on("keydown", block_enter);
		$(page.body).on("keydown", block_enter);
	}

	function mount_product_header_layout() {
		// Product name / style + images share the Product section (after search).
		const field = form.fields_dict.item_name;
		const $section = field?.$wrapper?.closest(".form-section");
		if (!$section?.length) return;
		$section.addClass("kqs-product-header-section");
		const $columns = $section.find("> .form-column");
		if ($columns.length >= 2) {
			$columns.eq(0).addClass("kqs-product-header-left");
			$columns.eq(1).addClass("kqs-product-header-right");
		}
	}

	function toggle_field_visibility(fieldname, visible) {
		const field = form.fields_dict[fieldname];
		if (!field || !field.$wrapper) return;
		const $target =
			field.df.fieldtype === "Section Break"
				? field.$wrapper.closest(".section-body, .form-section, .frappe-control").first()
				: field.$wrapper.closest(".frappe-control");
		if ($target.length) $target.toggle(visible);
		else field.$wrapper.toggle(visible);
	}

	function set_editor_visible(visible) {
		editor_ready = visible;
		EDITOR_FIELDS.forEach((name) => toggle_field_visibility(name, visible));
		if (visible && selected_attributes.length) {
			toggle_field_visibility("quick_fill_section", true);
			toggle_field_visibility("new_variants_section", true);
			toggle_field_visibility("new_variant_grid", true);
		}
	}

	function bind_pill_click($root, selector, handler) {
		$root.find(selector).on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			handler.call(this, e);
		});
	}

	function normalize_attribute_value(value) {
		if (value === null || value === undefined) return "";
		return String(value).trim();
	}

	function read_pill_data_value($el) {
		return normalize_attribute_value($el.attr("data-value"));
	}

	function image_preview_url(path) {
		if (!path) return "/assets/frappe/images/ui/no-image.svg";
		const raw = String(path).trim();
		if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("data:")) return raw;
		let file_url = raw.startsWith("/") ? raw : `/${raw}`;
		file_url = encodeURI(file_url).replace(/#/g, "%23");
		if (frappe.urllib && frappe.urllib.get_full_url) {
			return frappe.urllib.get_full_url(file_url);
		}
		return file_url;
	}

	function normalize_uploaded_file_url(file_doc, response) {
		if (typeof file_doc === "string" && file_doc) return file_doc;
		if (file_doc?.dataurl) return file_doc.dataurl;
		if (file_doc?.file_url) return file_doc.file_url;
		if (file_doc?.doc?.file_url) return file_doc.doc.file_url;
		const r = response || file_doc;
		if (r?.message?.file_url) return r.message.file_url;
		if (r?.file_url) return r.file_url;
		return "";
	}

	function normalize_image_key(url) {
		if (!url) return "";
		const raw = String(url).trim().split("?")[0];
		if (raw.startsWith("data:")) return raw;
		const path = raw.includes("/files/") ? raw.split("/files/").pop() : raw;
		return (path || raw).toLowerCase();
	}

	function open_upload_image_dialog(on_url, allow_multiple = false) {
		new frappe.ui.FileUploader({
			allow_multiple,
			disable_file_browser: true,
			allow_web_link: false,
			folder: "Home",
			make_attachments_public: true,
			restrictions: { allowed_file_types: ["image/*"] },
			on_success(file_doc, response) {
				const url = normalize_uploaded_file_url(file_doc, response);
				if (url) on_url(url);
			},
		});
	}

	function open_image_picker(on_url, options = {}) {
		const allow_multiple = !!options.allow_multiple;
		let library_start = 0;
		let library_search = "";
		const selected_keys = new Set();

		const dialog = new frappe.ui.Dialog({
			title: allow_multiple ? __("Add product images") : __("Select image"),
			size: "large",
			fields: [{ fieldname: "picker_body", fieldtype: "HTML" }],
			primary_action_label: allow_multiple ? __("Add selected") : __("Close"),
			primary_action() {
				if (!allow_multiple) {
					dialog.hide();
					return;
				}
				const urls = dialog.$wrapper
					.find(".kqs-lib-tile.selected")
					.map(function () {
						return $(this).attr("data-url");
					})
					.get();
				if (!urls.length) {
					frappe.msgprint(__("Select at least one image, or upload a new file."));
					return;
				}
				urls.forEach((url) => on_url(url));
				dialog.hide();
			},
		});

		function load_library($body, reset) {
			if (reset) {
				library_start = 0;
				$body.find(".kqs-lib-grid").empty();
			}
			frappe.call({
				method: "kqs_retail.api.product_setup.list_image_library",
				args: { search: library_search, start: library_start, limit: 48 },
				callback(r) {
					if (r.exc) return;
					const images = (r.message && r.message.images) || [];
					const has_more = !!(r.message && r.message.has_more);
					library_start += images.length;
					const $grid = $body.find(".kqs-lib-grid");
					if (reset && !images.length) {
						$grid.html(`<p class="text-muted small">${__("No images yet. Upload new.")}</p>`);
					} else {
						const tiles = images
							.map((file) => {
								const url = file.file_url || "";
								const key = normalize_image_key(url);
								const selected = selected_keys.has(key) ? " selected" : "";
								return `<button type="button" class="kqs-lib-tile${selected}" data-url="${frappe.utils.escape_html(
									url
								)}">
									<img src="${frappe.utils.escape_html(image_preview_url(url))}" alt="" />
								</button>`;
							})
							.join("");
						if (reset) $grid.html(tiles);
						else $grid.append(tiles);
					}
					$body.find(".kqs-lib-more").toggle(has_more);
				},
			});
		}

		const $body = dialog.fields_dict.picker_body.$wrapper;
		$body.html(`
			<div class="kqs-image-picker">
				<div class="kqs-image-picker-toolbar flex align-center justify-between mb-3">
					<input type="search" class="form-control input-sm kqs-lib-search"
						placeholder="${__("Search images…")}" style="max-width:240px;" />
					<button type="button" class="btn btn-default btn-sm kqs-lib-upload">
						${__("Upload new")}
					</button>
				</div>
				<div class="kqs-image-library-grid kqs-lib-grid"></div>
				<button type="button" class="btn btn-default btn-sm kqs-lib-more mt-2" style="display:none;">
					${__("Load more")}
				</button>
			</div>
		`);
		$body.find(".kqs-lib-upload").on("click", () => {
			open_upload_image_dialog((url) => {
				on_url(url);
				dialog.hide();
			}, allow_multiple);
		});
		$body.find(".kqs-lib-search").on(
			"input",
			frappe.utils.debounce(function () {
				library_search = $(this).val() || "";
				load_library($body, true);
			}, 300)
		);
		$body.find(".kqs-lib-more").on("click", () => load_library($body, false));
		$body.on("click", ".kqs-lib-tile", function () {
			const url = $(this).attr("data-url");
			if (!url) return;
			if (!allow_multiple) {
				on_url(url);
				dialog.hide();
				return;
			}
			const key = normalize_image_key(url);
			$(this).toggleClass("selected");
			if ($(this).hasClass("selected")) selected_keys.add(key);
			else selected_keys.delete(key);
		});
		dialog.show();
		load_library($body, true);
	}

	function get_main_product_image() {
		if (main_image_index === null || main_image_index < 0) return "";
		return product_images[main_image_index] || "";
	}

	function get_gallery_product_images() {
		const main = get_main_product_image();
		return product_images.filter((url) => url && url !== main);
	}

	function add_product_image(url) {
		if (!url) return;
		const key = normalize_image_key(url);
		if (product_images.some((u) => normalize_image_key(u) === key)) return;
		if (main_image_index === null) main_image_index = product_images.length;
		product_images.push(url);
	}

	function remove_product_image(idx) {
		product_images.splice(idx, 1);
		if (!product_images.length) main_image_index = null;
		else if (main_image_index === idx) main_image_index = 0;
		else if (main_image_index !== null && main_image_index > idx) main_image_index -= 1;
		render_product_images();
	}

	function render_product_images() {
		const field = form.get_field("product_images_picker");
		if (!field?.$wrapper) return;
		const $wrap = field.$wrapper;
		const main_url = get_main_product_image();
		const has_images = product_images.length > 0;
		const featured = main_url
			? `<img src="${frappe.utils.escape_html(image_preview_url(main_url))}" alt="" class="kqs-featured-img" />`
			: `<div class="kqs-image-placeholder-inner">
					<span class="kqs-image-placeholder-icon">+</span>
					<span class="kqs-image-placeholder-text">${__("Add photos")}</span>
				</div>`;
		const thumbs = product_images
			.map((url, idx) => {
				const is_main = idx === main_image_index;
				return `<button type="button" class="kqs-thumb-tile${is_main ? " is-main" : ""}" data-idx="${idx}">
					<img src="${frappe.utils.escape_html(image_preview_url(url))}" alt="" class="kqs-thumb-img" />
					${is_main ? `<span class="kqs-thumb-badge">${__("Main")}</span>` : ""}
					<span class="kqs-thumb-remove" data-idx="${idx}" title="${__("Remove")}">×</span>
				</button>`;
			})
			.join("");

		$wrap.html(`<div class="kqs-product-images">
			<div class="kqs-product-images-title">${__("Product images")}</div>
			<button type="button" class="kqs-featured-slot${has_images ? " has-image" : " is-empty"}">${featured}</button>
			<div class="kqs-thumb-strip">
				${thumbs}
				<button type="button" class="kqs-thumb-tile kqs-thumb-add" title="${__("Upload more")}">
					<span class="kqs-image-placeholder-icon">+</span>
				</button>
			</div>
		</div>`);

		$wrap.find(".kqs-featured-slot.is-empty, .kqs-thumb-add").on("click", () => {
			open_image_picker((url) => {
				add_product_image(url);
				render_product_images();
			}, { allow_multiple: true });
		});
		$wrap.find(".kqs-thumb-tile:not(.kqs-thumb-add)").on("click", function (e) {
			if ($(e.target).closest(".kqs-thumb-remove").length) return;
			main_image_index = Number($(this).attr("data-idx"));
			render_product_images();
		});
		$wrap.find(".kqs-thumb-remove").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			remove_product_image(Number($(this).attr("data-idx")));
		});
	}

	function sync_category_form_value() {
		form.set_value("item_group", selected_categories[0] || "");
	}

	function update_category_pill_states() {
		const $picker = form.get_field("category_picker").$wrapper;
		$picker.find(".kqs-category-pill").each(function () {
			const name = String($(this).attr("data-name") || "");
			$(this).toggleClass("active", selected_categories.includes(name));
		});
		const $summary = $picker.find(".kqs-category-selection-summary");
		if (!selected_categories.length) {
			$summary.remove();
		} else {
			const label =
				selected_categories.length === 1
					? __("1 category selected")
					: __("{0} categories selected", [selected_categories.length]);
			if ($summary.length) $summary.text(label);
			else {
				$picker
					.find(".kqs-category-shell")
					.prepend(`<p class="text-muted small mb-2 kqs-category-selection-summary">${label}</p>`);
			}
		}
		sync_category_form_value();
	}

	function toggle_category(name) {
		if (!name) return;
		const idx = selected_categories.indexOf(name);
		if (idx >= 0) selected_categories.splice(idx, 1);
		else selected_categories.push(name);
		update_category_pill_states();
	}

	function pills_html(categories) {
		return (categories || [])
			.map(
				(cat) =>
					`<button type="button" class="kqs-pill kqs-pill-sm kqs-category-pill" data-name="${frappe.utils.escape_html(
						cat.name
					)}">${frappe.utils.escape_html(cat.title || cat.item_group_name || cat.name)}</button>`
			)
			.join("");
	}

	function render_department_categories(section) {
		const subgroups = (section && section.subgroups) || [];
		if (!subgroups.length) {
			return `<p class="text-muted small mb-0">${__("No categories in this department yet.")}</p>`;
		}
		return subgroups
			.map(
				(subgroup) => `<div class="kqs-category-subgroup-card">
				<div class="kqs-category-subtitle">${frappe.utils.escape_html(subgroup.title)}</div>
				<div class="kqs-pill-row kqs-pill-row-sm">${pills_html(subgroup.categories || [])}</div>
			</div>`
			)
			.join("");
	}

	function render_category_pills(sections) {
		const $picker = form.get_field("category_picker").$wrapper;
		category_sections = sections || category_sections;
		if (!category_sections.length) {
			$picker.html(`<p class="text-muted">${__("No categories yet.")}</p>`);
			return;
		}
		if (
			!active_department_key ||
			!category_sections.some((s) => s.key === active_department_key)
		) {
			active_department_key = category_sections[0].key;
		}
		const tabs_html = category_sections
			.map(
				(section) =>
					`<button type="button" class="kqs-dept-tab${
						section.key === active_department_key ? " active" : ""
					}" data-key="${frappe.utils.escape_html(section.key)}">${frappe.utils.escape_html(
						section.title
					)}</button>`
			)
			.join("");
		const active =
			category_sections.find((s) => s.key === active_department_key) || category_sections[0];
		$picker.html(`<div class="kqs-category-shell">
			<div class="kqs-dept-tabs">${tabs_html}</div>
			<div class="kqs-dept-panel">${render_department_categories(active)}</div>
		</div>`);
		update_category_pill_states();
		$picker.find(".kqs-dept-tab").on("click", function () {
			active_department_key = String($(this).attr("data-key") || "");
			render_category_pills(category_sections);
		});
		bind_pill_click($picker, ".kqs-category-pill", function () {
			toggle_category(String($(this).attr("data-name") || ""));
		});
	}

	function attribute_values(name) {
		const from_loaded = (attribute_catalog || []).find((a) => a.name === name);
		return (from_loaded && from_loaded.values) || [];
	}

	function combo_key(attrs) {
		return selected_attributes.map((n) => `${n}=${(attrs[n] || "").trim()}`).join("|");
	}

	function existing_combo_set() {
		const set = new Set();
		existing_variants.forEach((v) => set.add(combo_key(v.attributes || {})));
		new_variant_rows.forEach((row) => set.add(combo_key(row.attributes || {})));
		return set;
	}

	function cartesian(selections) {
		const keys = Object.keys(selections);
		if (!keys.length) return [];
		let combos = [{}];
		keys.forEach((key) => {
			const values = selections[key] || [];
			if (!values.length) return;
			const next = [];
			combos.forEach((combo) => {
				values.forEach((value) => next.push({ ...combo, [key]: value }));
			});
			combos = next;
		});
		return combos.filter((c) => Object.keys(c).length === keys.length);
	}

	function default_sku(attrs) {
		const base = form.get_value("style_code") || loaded_code || "";
		const parts = selected_attributes
			.map((n) => attrs[n])
			.filter(Boolean)
			.map((v) => String(v).replace(/\s+/g, "-").toUpperCase());
		return parts.length ? `${base}-${parts.join("-")}` : base;
	}

	function format_float(value) {
		return frappe.format(value, { fieldtype: "Float", precision: 2 });
	}

	function capture_existing_from_dom() {
		form
			.get_field("existing_grid")
			.$wrapper.find(".kqs-existing-row")
			.each(function () {
				const code = String($(this).attr("data-code") || "");
				const row = existing_variants.find((v) => String(v.item_code) === code);
				if (!row) return;
				row.barcode = $(this).find(".kqs-v-barcode").val() || "";
				row.rate = parseFloat($(this).find(".kqs-v-rate").val()) || 0;
				row.image = $(this).find(".kqs-v-image").attr("data-url") || row.image || "";
				row.disabled = $(this).find(".kqs-v-disabled").is(":checked") ? 1 : 0;
			});
	}

	function capture_new_from_dom() {
		form
			.get_field("new_variant_grid")
			.$wrapper.find("tr[data-idx]")
			.each(function () {
				const idx = parseInt($(this).attr("data-idx"), 10);
				const row = new_variant_rows[idx];
				if (!row) return;
				row.sku = $(this).find(".kqs-new-sku").val() || "";
				row.rate = parseFloat($(this).find(".kqs-new-rate").val()) || 0;
				row.barcode = $(this).find(".kqs-new-barcode").val() || "";
				row.qty = parseFloat($(this).find(".kqs-new-qty").val()) || 0;
			});
	}

	function render_existing_grid() {
		const $grid = form.get_field("existing_grid").$wrapper;
		if (!existing_variants.length) {
			$grid.html(`<p class="text-muted">${__("No variants on this product.")}</p>`);
			return;
		}
		const has_attrs = selected_attributes.length > 0;
		const rows = existing_variants
			.map((v) => {
				const attr_label = has_attrs
					? frappe.utils.escape_html(v.attribute_label || "—")
					: frappe.utils.escape_html(v.item_name || v.sku);
				const qty_bits = Object.entries(v.qty_by_warehouse || {})
					.map(([wh, qty]) => `${frappe.utils.escape_html(wh)}: ${format_float(qty)}`)
					.join(", ");
				const img = v.image
					? `<img src="${frappe.utils.escape_html(image_preview_url(v.image))}" class="kqs-edit-variant-thumb" alt="" />`
					: "";
				return `<tr class="kqs-existing-row" data-code="${frappe.utils.escape_html(v.item_code)}">
					<td>
						<div class="bold">${attr_label}</div>
						<div class="text-muted small">${frappe.utils.escape_html(v.sku)}</div>
					</td>
					<td><input type="text" class="form-control input-sm kqs-v-barcode" value="${frappe.utils.escape_html(
						v.barcode || ""
					)}" placeholder="${__("Barcode")}" /></td>
					<td><input type="number" min="0" step="0.01" class="form-control input-sm kqs-v-rate" style="width:110px;" value="${
						v.rate || 0
					}" /></td>
					<td>
						<div class="kqs-v-image-cell">
							${img}
							<button type="button" class="btn btn-xs btn-default kqs-v-image" data-url="${frappe.utils.escape_html(
								v.image || ""
							)}">${v.image ? __("Change") : __("Add image")}</button>
						</div>
					</td>
					<td class="text-center"><input type="checkbox" class="kqs-v-disabled" ${v.disabled ? "checked" : ""} /></td>
					<td class="text-muted small">${qty_bits || "—"}</td>
				</tr>`;
			})
			.join("");

		$grid.html(`<table class="table table-bordered table-sm kqs-variant-table">
			<thead><tr>
				<th>${has_attrs ? __("Variant") : __("Product")}</th>
				<th>${__("Barcode")}</th>
				<th>${__("Price")}</th>
				<th>${__("Image")}</th>
				<th>${__("Disabled")}</th>
				<th>${__("Stock")}</th>
			</tr></thead>
			<tbody>${rows}</tbody>
		</table>`);

		$grid.find(".kqs-v-image").on("click", function () {
			const $btn = $(this);
			const $row = $btn.closest("tr");
			const code = String($row.attr("data-code") || "");
			open_image_picker((url) => {
				const row = existing_variants.find((v) => String(v.item_code) === code);
				if (row) row.image = url;
				$btn.attr("data-url", url);
				capture_existing_from_dom();
				render_existing_grid();
			});
		});
	}

	function render_value_pickers() {
		const $picker = form.get_field("quick_fill_picker").$wrapper;
		if (!selected_attributes.length) {
			$picker.html(
				`<p class="text-muted">${__(
					"This product has no variant attributes. Use Add Product to create a new style with Size/Colour."
				)}</p>`
			);
			toggle_field_visibility("quick_fill_section", false);
			toggle_field_visibility("new_variants_section", false);
			toggle_field_visibility("new_variant_grid", false);
			return;
		}
		toggle_field_visibility("quick_fill_section", true);
		toggle_field_visibility("new_variants_section", true);
		toggle_field_visibility("new_variant_grid", true);

		const blocks = selected_attributes
			.map((name) => {
				const values = attribute_values(name);
				const selected = quick_fill_values[name] || [];
				const pills = values
					.map((v) => {
						const norm = normalize_attribute_value(v);
						const active = selected.some((s) => normalize_attribute_value(s) === norm)
							? " active"
							: "";
						return `<button type="button" class="kqs-pill kqs-pill-sm kqs-value-pill${active}"
							data-attr="${frappe.utils.escape_html(name)}"
							data-value="${frappe.utils.escape_html(v)}">${frappe.utils.escape_html(v)}</button>`;
					})
					.join("");
				return `<div class="kqs-value-block">
					<div class="kqs-value-header">
						<div class="kqs-value-label">${frappe.utils.escape_html(name)}</div>
						<span class="kqs-value-count ${selected.length ? "kqs-value-count-active" : "text-muted"}">${
							selected.length
								? __("{0} selected", [selected.length])
								: __("Tap values to select")
						}</span>
					</div>
					<div class="kqs-pill-row kqs-pill-row-sm">${
						pills || `<span class="text-muted small">${__("No values on Item Attribute.")}</span>`
					}</div>
				</div>`;
			})
			.join("");

		const ready = selected_attributes.every((n) => (quick_fill_values[n] || []).length);
		const combo_count = ready ? cartesian(quick_fill_values).length : 0;
		$picker.html(`<div class="kqs-value-section">${blocks}
			<div class="kqs-variant-builder-actions">
				<span class="kqs-combo-preview ${ready ? "" : "text-muted"}">${
					ready
						? __("{0} combination(s) ready", [combo_count])
						: __("Select at least one value for each attribute")
				}</span>
				<button type="button" class="btn btn-default btn-sm kqs-add-variants-from-selection"${
					ready && combo_count ? "" : " disabled"
				}>${__("Add {0} variants to table", [combo_count || 0])}</button>
			</div>
		</div>`);

		bind_pill_click($picker, ".kqs-value-pill", function () {
			const attr = String($(this).attr("data-attr") || "");
			const value = read_pill_data_value($(this));
			const list = quick_fill_values[attr] || (quick_fill_values[attr] = []);
			const idx = list.findIndex((s) => normalize_attribute_value(s) === value);
			if (idx >= 0) list.splice(idx, 1);
			else list.push(value);
			render_value_pickers();
		});
		$picker.find(".kqs-add-variants-from-selection").on("click", function () {
			if ($(this).prop("disabled")) return;
			capture_new_from_dom();
			const existing = existing_combo_set();
			const combos = cartesian(quick_fill_values);
			let added = 0;
			combos.forEach((attrs) => {
				const key = combo_key(attrs);
				if (existing.has(key)) return;
				new_variant_rows.push({
					attributes: attrs,
					sku: default_sku(attrs),
					rate: form.get_value("default_rate") || 0,
					barcode: "",
					qty: 0,
				});
				existing.add(key);
				added += 1;
			});
			if (!added) {
				frappe.msgprint(__("All selected combinations already exist."));
			} else {
				frappe.show_alert({
					message: __("{0} new variant row(s) added. Review, then Save Changes.", [added]),
					indicator: "blue",
				});
			}
			render_new_variant_grid();
		});
	}

	function render_new_variant_grid() {
		const $grid = form.get_field("new_variant_grid").$wrapper;
		if (!selected_attributes.length) {
			$grid.empty();
			return;
		}
		if (!new_variant_rows.length) {
			$grid.html(
				`<p class="text-muted">${__(
					"No new variants queued. Pick values above and add them to the table."
				)}</p>`
			);
			return;
		}
		const rows = new_variant_rows
			.map((row, idx) => {
				const label = selected_attributes.map((n) => `${n}: ${row.attributes[n]}`).join(", ");
				return `<tr data-idx="${idx}">
					<td>${frappe.utils.escape_html(label)}</td>
					<td><input type="text" class="form-control input-sm kqs-new-sku" value="${frappe.utils.escape_html(
						row.sku || ""
					)}" /></td>
					<td><input type="number" min="0" step="0.01" class="form-control input-sm kqs-new-rate" style="width:110px;" value="${
						row.rate || 0
					}" /></td>
					<td><input type="text" class="form-control input-sm kqs-new-barcode" value="${frappe.utils.escape_html(
						row.barcode || ""
					)}" /></td>
					<td><input type="number" min="0" step="1" class="form-control input-sm kqs-new-qty" style="width:90px;" value="${
						row.qty || 0
					}" /></td>
					<td><button type="button" class="btn btn-xs btn-default kqs-new-remove">${__("Remove")}</button></td>
				</tr>`;
			})
			.join("");
		$grid.html(`<table class="table table-bordered table-sm kqs-variant-table">
			<thead><tr>
				<th>${__("Variant")}</th><th>${__("SKU")}</th><th>${__("Price")}</th>
				<th>${__("Barcode")}</th><th>${__("Opening qty")}</th><th></th>
			</tr></thead>
			<tbody>${rows}</tbody>
		</table>
		<p class="text-muted small">${__("Opening qty receives into the warehouse selected above (new variants only).")}</p>`);
		$grid.find(".kqs-new-remove").on("click", function () {
			capture_new_from_dom();
			const idx = parseInt($(this).closest("tr").attr("data-idx"), 10);
			new_variant_rows.splice(idx, 1);
			render_new_variant_grid();
		});
	}

	function render_editor_banner(name, code) {
		form.get_field("editor_banner").$wrapper.html(`
			<div class="kqs-edit-banner alert alert-info" style="margin-bottom:1rem;">
				<strong>${__("Editing")}:</strong> ${frappe.utils.escape_html(name)}
				<span class="text-muted">(${frappe.utils.escape_html(code)})</span>
				<button type="button" class="btn btn-xs btn-default pull-right kqs-change-product">${__(
					"Change product"
				)}</button>
			</div>
		`);
		form.get_field("editor_banner").$wrapper.find(".kqs-change-product").on("click", () => {
			clear_editor();
			$("html, body").animate({ scrollTop: 0 }, 150);
			form.get_field("search_html").$wrapper.find(".kqs-edit-search-input").focus();
		});
	}

	function clear_editor() {
		loaded_code = "";
		selected_categories = [];
		selected_attributes = [];
		quick_fill_values = {};
		existing_variants = [];
		new_variant_rows = [];
		product_images = [];
		main_image_index = null;
		form.set_value("item_name", "");
		form.set_value("style_code", "");
		form.set_value("default_rate", "");
		form.set_value("description", "");
		form.set_value("disabled", 0);
		set_editor_visible(false);
		page.set_primary_action(__("Save Changes"), () => {
			frappe.msgprint(__("Search and open a product first."));
		});
	}

	function apply_loaded_product(payload) {
		const t = payload.template || {};
		loaded_code = t.item_code || t.style_code || "";
		selected_categories = (t.item_groups || []).slice();
		selected_attributes = (t.attributes || []).slice();
		attribute_catalog = (payload.attribute_defs || []).map((a) => ({
			name: a.name,
			values: a.values || [],
		}));
		quick_fill_values = {};
		selected_attributes.forEach((name) => {
			quick_fill_values[name] = [];
		});
		existing_variants = (payload.variants || []).map((v) => ({ ...v }));
		new_variant_rows = [];
		product_images = [];
		main_image_index = null;
		if (t.image) add_product_image(t.image);
		(t.gallery_images || []).forEach(add_product_image);
		if (product_images.length && main_image_index === null) main_image_index = 0;

		set_editor_visible(true);
		const firstVariantRate = (payload.variants || []).find((v) => parseFloat(v.rate) > 0);
		const defaultRate =
			parseFloat(t.standard_rate) ||
			(firstVariantRate ? parseFloat(firstVariantRate.rate) : 0) ||
			0;
		form.set_value("item_name", t.item_name || "");
		form.set_value("style_code", t.style_code || loaded_code);
		form.set_value("default_rate", defaultRate);
		form.set_value("stock_uom", t.stock_uom || "");
		form.set_value("description", t.description || "");
		form.set_value("disabled", t.disabled ? 1 : 0);

		render_editor_banner(t.item_name || loaded_code, loaded_code);
		render_product_images();
		render_category_pills(category_sections);
		render_existing_grid();
		render_value_pickers();
		render_new_variant_grid();
		setup_page_actions();

		const $banner = form.get_field("editor_banner").$wrapper;
		if ($banner.length) {
			$("html, body").animate({ scrollTop: Math.max(0, $banner.offset().top - 70) }, 200);
		}
	}

	function load_product(item_code) {
		const code = String(item_code || "").trim();
		if (!code) return;
		frappe.call({
			method: "kqs_retail.api.product_setup.get_product_for_edit",
			args: { item_code: code },
			freeze: true,
			freeze_message: __("Loading product…"),
			callback(r) {
				if (r.exc || !r.message) return;
				apply_loaded_product(r.message);
			},
		});
	}

	function render_search() {
		const $search = form.get_field("search_html").$wrapper;
		$search.html(`
			<div class="kqs-edit-search mb-3">
				<input type="search" class="form-control kqs-edit-search-input"
					placeholder="${__("Search by name, style code, or barcode…")}" />
				<div class="kqs-edit-search-results mt-2"></div>
			</div>
		`);
		$search.find(".kqs-edit-search-input").on(
			"input",
			frappe.utils.debounce(function () {
				run_search($(this).val() || "");
			}, 300)
		);
	}

	function run_search(query) {
		const $results = form.get_field("search_html").$wrapper.find(".kqs-edit-search-results");
		if (!(query || "").trim()) {
			$results.html(`<p class="text-muted">${__("Type to find a product.")}</p>`);
			return;
		}
		frappe.call({
			method: "kqs_retail.api.product_setup.search_products_for_edit",
			args: { query, start: 0, limit: 30 },
			callback(r) {
				if (r.exc) return;
				const items = (r.message && r.message.items) || [];
				if (!items.length) {
					$results.html(`<p class="text-muted">${__("No products found.")}</p>`);
					return;
				}
				const rows = items
					.map((row) => {
						const hint = row.has_variants
							? `<span class="indicator-pill gray">${__("Has variants")}</span>`
							: `<span class="indicator-pill blue">${__("Standalone")}</span>`;
						return `<tr class="kqs-edit-search-row" data-code="${frappe.utils.escape_html(
							row.item_code
						)}" style="cursor:pointer;">
							<td style="width:48px;"><img src="${image_preview_url(row.image)}" class="kqs-edit-thumb" alt="" /></td>
							<td>
								<div class="bold">${frappe.utils.escape_html(row.item_name)}</div>
								<div class="text-muted small">${__("Style")}: ${frappe.utils.escape_html(row.item_code)}</div>
							</td>
							<td>${frappe.utils.escape_html(row.item_group || "")}</td>
							<td>${hint}</td>
						</tr>`;
					})
					.join("");
				$results.html(`<table class="table table-hover table-bordered"><tbody>${rows}</tbody></table>`);
				$results.find(".kqs-edit-search-row").on("click", function () {
					load_product(String($(this).attr("data-code") || ""));
				});
			},
		});
	}

	function save_all() {
		if (!editor_ready || !loaded_code || save_in_progress) {
			frappe.msgprint(__("Search and open a product first."));
			return;
		}
		capture_existing_from_dom();
		capture_new_from_dom();

		const item_name = (form.get_value("item_name") || "").trim();
		if (!item_name) {
			frappe.msgprint(__("Enter product name."));
			return;
		}
		if (!selected_categories.length) {
			frappe.msgprint(__("Select at least one category."));
			return;
		}
		if (new_variant_rows.some((r) => (r.qty || 0) > 0) && !form.get_value("warehouse")) {
			frappe.msgprint(__("Select a warehouse when entering opening quantities on new variants."));
			return;
		}

		save_in_progress = true;
		const chain = [];

		chain.push(
			() =>
				new Promise((resolve, reject) => {
					frappe.call({
						method: "kqs_retail.api.product_setup.update_product",
						args: {
							template: loaded_code,
							item_name,
							description: form.get_value("description") || "",
							item_groups: JSON.stringify(selected_categories),
							item_group: selected_categories[0],
							product_image: get_main_product_image(),
							gallery_images: JSON.stringify(get_gallery_product_images()),
							standard_rate: form.get_value("default_rate"),
							stock_uom: form.get_value("stock_uom") || "",
							disabled: form.get_value("disabled") ? 1 : 0,
						},
						callback(r) {
							if (r.exc) reject(r.exc);
							else resolve();
						},
						error: reject,
					});
				})
		);

		existing_variants.forEach((v) => {
			chain.push(
				() =>
					new Promise((resolve, reject) => {
						frappe.call({
							method: "kqs_retail.api.product_setup.update_variant",
							args: {
								item_code: v.item_code,
								barcode: v.barcode || "",
								rate: v.rate,
								image: v.image || "",
								disabled: v.disabled ? 1 : 0,
							},
							callback(r) {
								if (r.exc) reject(r.exc);
								else resolve();
							},
							error: reject,
						});
					})
			);
		});

		if (new_variant_rows.length) {
			chain.push(
				() =>
					new Promise((resolve, reject) => {
						frappe.call({
							method: "kqs_retail.api.product_setup.add_variants_to_product",
							args: {
								template: loaded_code,
								variants_json: JSON.stringify(new_variant_rows),
								receive_warehouse: form.get_value("warehouse") || "",
							},
							callback(r) {
								if (r.exc) reject(r.exc);
								else resolve();
							},
							error: reject,
						});
					})
			);
		}

		chain
			.reduce((p, fn) => p.then(fn), Promise.resolve())
			.then(() => {
				frappe.show_alert({ message: __("Product updated."), indicator: "green" });
				load_product(loaded_code);
			})
			.catch(() => {})
			.finally(() => {
				save_in_progress = false;
			});
	}

	function setup_page_actions() {
		if (page.clear_menu) page.clear_menu();
		page.set_primary_action(__("Save Changes"), save_all);
		if (page.set_secondary_action) {
			page.set_secondary_action(__("Receive Stock"), () => frappe.set_route("receive-stock"));
		}
		if (page.add_menu_item) {
			page.add_menu_item(__("Add Product"), () => frappe.set_route("quick-add-product"));
			page.add_menu_item(__("Assign to Branch"), () => frappe.set_route("assign-to-branch"));
		}
	}

	function load_defaults() {
		frappe.call({
			method: "kqs_retail.api.product_setup.get_add_product_defaults",
			callback(r) {
				if (r.message?.stock_uom && !form.get_value("stock_uom")) {
					form.set_value("stock_uom", r.message.stock_uom);
				}
				if (r.message?.warehouse) {
					form.set_value("warehouse", r.message.warehouse);
				}
			},
		});
	}

	frappe.call({
		method: "kqs_retail.api.product_setup.list_product_category_sections",
		callback(r) {
			category_sections = (r.message && r.message.sections) || [];
			if (editor_ready) render_category_pills(category_sections);
		},
	});

	render_search();
	set_editor_visible(false);
	load_defaults();
	setup_page_actions();
	inject_styles();

	wrapper.kqs_edit_form = form;

	function inject_styles() {
		if ($("#kqs-edit-product-style").length) return;
		// Reuse Add Product visual language (same class names).
		$("head").append(`<style id="kqs-edit-product-style">
			.kqs-edit-thumb { width:40px; height:40px; object-fit:cover; border-radius:4px; }
			.kqs-edit-variant-thumb { width:36px; height:36px; object-fit:cover; border-radius:4px; margin-right:6px; vertical-align:middle; }
			.kqs-v-image-cell { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
			.kqs-product-header-section {
				display:flex; flex-wrap:wrap; gap:1rem; align-items:flex-start; margin-bottom:0.25rem;
			}
			.kqs-product-header-section > .form-column { flex:1; min-width:0; padding:0; }
			.kqs-product-header-left { flex:1.2; }
			.kqs-product-header-right { flex:0 0 auto; }
			.kqs-product-header-right [data-fieldname="product_images_picker"] > .control-label { display:none; }
			.kqs-product-images { width:auto; max-width:112px; }
			.kqs-product-images-title { font-size:11px; font-weight:600; margin-bottom:0.35rem; }
			.kqs-featured-slot {
				display:block; width:112px; height:112px; padding:0; border:2px dashed #bdbdbd;
				border-radius:6px; background:#fafafa; cursor:pointer; overflow:hidden;
			}
			.kqs-featured-slot.has-image { border-style:solid; border-color:#171717; background:#fff; }
			.kqs-featured-img { width:100%; height:100%; object-fit:cover; display:block; }
			.kqs-image-placeholder-inner {
				display:flex; flex-direction:column; align-items:center; justify-content:center;
				height:100%; color:#737373; gap:0.2rem;
			}
			.kqs-image-placeholder-icon { font-size:1.35rem; font-weight:300; }
			.kqs-image-placeholder-text { font-size:10px; font-weight:500; }
			.kqs-thumb-strip { display:flex; flex-wrap:wrap; gap:0.3rem; margin-top:0.35rem; }
			.kqs-thumb-tile {
				position:relative; width:40px; height:40px; padding:0; border:2px solid #d4d4d4;
				border-radius:4px; background:#fafafa; cursor:pointer; overflow:hidden;
			}
			.kqs-thumb-tile.is-main { border-color:#000; box-shadow:0 0 0 1px #000; }
			.kqs-thumb-tile.kqs-thumb-add {
				display:flex; align-items:center; justify-content:center; border-style:dashed; color:#737373;
			}
			.kqs-thumb-img { width:100%; height:100%; object-fit:cover; display:block; }
			.kqs-thumb-badge {
				position:absolute; left:0; right:0; bottom:0; background:rgba(0,0,0,0.75);
				color:#fff; font-size:8px; font-weight:600; text-align:center;
			}
			.kqs-thumb-remove {
				position:absolute; top:0; right:0; width:14px; height:14px; line-height:12px;
				text-align:center; font-size:11px; background:rgba(255,255,255,0.95);
				border:1px solid #e2e2e2; border-radius:3px; cursor:pointer;
			}
			.kqs-image-library-grid {
				display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr));
				gap:10px; max-height:min(60vh,420px); overflow-y:auto;
			}
			.kqs-lib-tile {
				display:block; width:100%; aspect-ratio:1; padding:0; border:2px solid #d4d4d4;
				border-radius:6px; background:#f5f5f5; cursor:pointer; overflow:hidden;
			}
			.kqs-lib-tile.selected { border-color:#171717; box-shadow:0 0 0 2px #171717; }
			.kqs-lib-tile img { width:100%; height:100%; object-fit:cover; display:block; }
			.kqs-category-shell {
				border:1px solid var(--border-color,#e2e2e2); border-radius:8px; background:#fafafa; overflow:hidden;
			}
			.kqs-dept-tabs {
				display:flex; flex-wrap:wrap; gap:0.35rem; padding:0.5rem; background:#fff;
				border-bottom:1px solid var(--border-color,#e2e2e2);
			}
			.kqs-dept-tab {
				border:1.5px solid #d4d4d4; border-radius:999px; background:#fff; color:#171717;
				font-size:13px; font-weight:600; padding:0.4rem 0.85rem; cursor:pointer;
			}
			.kqs-dept-tab.active { background:#000; border-color:#000; color:#fff; }
			.kqs-dept-panel { padding:0.65rem 0.75rem 0.75rem; max-height:420px; overflow-y:auto; }
			.kqs-category-subgroup-card {
				background:#fff; border:1px solid var(--border-color,#e2e2e2); border-radius:6px;
				padding:0.55rem 0.65rem 0.65rem; margin-bottom:0.55rem;
			}
			.kqs-category-subtitle {
				font-size:12px; font-weight:700; margin:0 0 0.4rem; text-transform:uppercase; letter-spacing:0.04em;
			}
			.kqs-pill-row { display:flex; flex-wrap:wrap; gap:0.375rem; }
			.kqs-pill {
				display:inline-flex; align-items:center; border:2px solid #000; border-radius:999px;
				font-size:13px; padding:0.375rem 0.75rem; font-weight:500; background:#fff; cursor:pointer;
			}
			.kqs-pill-sm { font-size:11px; padding:0.25rem 0.55rem; border-width:1.5px; }
			.kqs-edit-product-form button.kqs-pill.active,
			.kqs-add-product-form button.kqs-pill.active {
				background:#000 !important; color:#fff !important; border-color:#000 !important;
			}
			.kqs-value-block { margin-bottom:1.25rem; }
			.kqs-value-header { display:flex; justify-content:space-between; gap:0.75rem; margin-bottom:0.5rem; }
			.kqs-value-label { font-weight:600; font-size:13px; }
			.kqs-variant-builder-actions {
				display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between;
				gap:0.75rem; padding-top:0.75rem; margin-top:0.5rem;
				border-top:1px solid var(--border-color,#e2e2e2);
			}
			.kqs-variant-table input.form-control { min-width:0; }
		</style>`);
	}
};

frappe.pages["edit-product"].on_page_show = function (wrapper) {
	if (frappe.app.sidebar) {
		frappe.app.sidebar.setup("Stock");
	}
};
