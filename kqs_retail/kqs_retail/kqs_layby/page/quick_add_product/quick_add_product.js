frappe.pages["quick-add-product"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Add Product"),
		single_column: true,
	});

	let selected_categories = [];
	let active_department_key = "";
	let category_sections = [];
	let variant_rows = [];
	let attribute_catalog = [];
	let selected_attributes = [];
	let quick_fill_values = {};
	let product_images = [];
	let main_image_index = null;
	let attribute_value_images = {};
	let save_in_progress = false;

	const form = new frappe.ui.FieldGroup({
		body: page.body,
		card_layout: true,
		fields: [
			{
				fieldtype: "Section Break",
				description: __(
					"Create catalog items with variants. Opening stock is received into the selected warehouse; use Assign to Branch to move stock to stores later."
				),
			},
			{ fieldname: "item_name", fieldtype: "Data", label: __("Product Name"), reqd: 1 },
			{
				fieldname: "style_code",
				fieldtype: "Data",
				label: __("SKU / Style number"),
				reqd: 1,
				description: __("Parent code for this product. Variants use this unless you enter a SKU per row."),
				onchange: () => {
					render_grid();
				},
			},
			{ fieldtype: "Column Break" },
			{ fieldname: "product_images_picker", fieldtype: "HTML", label: __("Product images") },
			{ fieldtype: "Section Break", label: __("Details") },
			{
				fieldname: "default_rate",
				fieldtype: "Currency",
				label: __("Price"),
				description: __("Default price for all variants. Override per variant in the table if needed."),
				onchange: () => {
					sync_rows_from_dom();
					render_grid();
				},
			},
			{
				fieldname: "stock_uom",
				fieldtype: "Link",
				options: "UOM",
				label: __("Unit of measure"),
				reqd: 1,
				description: __("Default is Piece. Change when the product is sold by pair, weight, etc."),
			},
			{ fieldname: "item_group", fieldtype: "Data", hidden: 1 },
			{
				fieldname: "category_picker",
				fieldtype: "HTML",
				label: __("Category"),
				reqd: 1,
				description: __("Select at least one category. Tap again to remove; you can choose more than one."),
			},
			{ fieldname: "description", fieldtype: "Small Text", label: __("Description") },
			{
				fieldname: "warehouse",
				fieldtype: "Link",
				options: "Warehouse",
				label: __("Receive stock into"),
				description: __("Default is Central. Opening quantities below are received into this warehouse."),
				get_query() {
					return { query: "kqs_retail.api.stock_transfer.kqs_warehouse_query" };
				},
			},
			{
				fieldname: "has_variants",
				fieldtype: "Check",
				label: __("Has variants"),
				onchange: () => {
					variant_rows = [];
					selected_attributes = [];
					quick_fill_values = {};
					attribute_value_images = {};
					toggle_variant_sections();
					render_attribute_pills();
					render_value_pickers();
					render_grid();
				},
			},
			{
				fieldname: "variant_attributes_section",
				fieldtype: "Section Break",
				label: __("1. Variant attributes"),
				description: __(
					"Tap the attributes that define this product's variants (e.g. Size, Color). Values come from Stock → Item Attribute."
				),
			},
			{ fieldname: "attribute_picker", fieldtype: "HTML", label: __("Attributes") },
			{ fieldname: "attribute_manage_link", fieldtype: "HTML" },
			{
				fieldname: "quick_fill_section",
				fieldtype: "Section Break",
				label: __("2. Select values"),
				description: __(
					"Tap the values you stock for each attribute, then use Add to variant table. Nothing is saved until you click Save Product."
				),
			},
			{ fieldname: "quick_fill_picker", fieldtype: "HTML" },
			{ fieldtype: "Section Break", label: __("3. Variants") },
			{ fieldname: "variant_grid", fieldtype: "HTML" },
		],
	});
	form.make();
	form.wrapper.addClass("kqs-add-product-form");
	prevent_accidental_form_submit();
	mount_product_header_layout();
	$(page.body).css({ paddingTop: "1.5rem", paddingBottom: "1rem" });
	form.wrapper.css("padding-bottom", "3rem");

	function prevent_accidental_form_submit() {
		// Enter in a field must not trigger the page Save Product action.
		const block_enter = (e) => {
			if (e.key !== "Enter" || e.shiftKey) return;
			const tag = (e.target && e.target.tagName || "").toLowerCase();
			if (tag === "textarea") return;
			e.preventDefault();
			e.stopPropagation();
			if (typeof e.stopImmediatePropagation === "function") {
				e.stopImmediatePropagation();
			}
		};
		form.wrapper.on("keydown", block_enter);
		$(page.body).on("keydown", block_enter);
		if (page.wrapper && page.wrapper[0]) {
			page.wrapper[0].addEventListener("keydown", block_enter, true);
		}
	}

	function bind_pill_click($root, selector, handler) {
		$root.find(selector).on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			handler.call(this, e);
		});
	}

	function mount_product_header_layout() {
		const $section = form.wrapper.find(".form-section").first();
		if (!$section.length) return;
		$section.addClass("kqs-product-header-section");
		const $columns = $section.find("> .form-column");
		if ($columns.length >= 2) {
			$columns.eq(0).addClass("kqs-product-header-left");
			$columns.eq(1).addClass("kqs-product-header-right");
		}
	}

	function attribute_values(name) {
		const attr = attribute_catalog.find((a) => a.name === name);
		return (attr && attr.values) || [];
	}

	// Item Attribute values are strings; jQuery .data() coerces numeric data-value to Number.
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

	function catalog_value_image(attr_name, value) {
		const attr = attribute_catalog.find((a) => a.name === attr_name);
		const from_catalog = attr && attr.value_images && attr.value_images[value];
		const local =
			attribute_value_images[attr_name] && attribute_value_images[attr_name][value];
		return local || from_catalog || "";
	}

	function set_attribute_value_image(attr_name, value, url) {
		if (!attribute_value_images[attr_name]) {
			attribute_value_images[attr_name] = {};
		}
		if (url) {
			attribute_value_images[attr_name][value] = url;
		} else {
			delete attribute_value_images[attr_name][value];
			if (!Object.keys(attribute_value_images[attr_name]).length) {
				delete attribute_value_images[attr_name];
			}
		}
	}

	function normalize_uploaded_file_url(file_doc, response) {
		if (typeof file_doc === "string" && file_doc) return file_doc;
		if (file_doc && file_doc.dataurl) return file_doc.dataurl;
		if (file_doc && file_doc.file_url) return file_doc.file_url;
		if (file_doc && file_doc.doc && file_doc.doc.file_url) return file_doc.doc.file_url;

		const r = response || file_doc;
		if (r && typeof r === "object") {
			const msg = r.message;
			if (msg && msg.file_url) return msg.file_url;
			if (msg && msg.url) return msg.url;
			if (r.file_url) return r.file_url;
		}
		return "";
	}

	function product_images_container() {
		const field = form.get_field("product_images_picker");
		if (!field || !field.$wrapper) return $();
		return field.$wrapper;
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
		let library_has_more = false;
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
				const urls = dialog.$wrapper.find(".kqs-lib-tile.selected").map(function () {
					return $(this).data("url");
				}).get();
				if (!urls.length) {
					frappe.msgprint(__("Select at least one image from the library, or upload a new file."));
					return;
				}
				urls.forEach((url) => on_url(url));
				dialog.hide();
			},
		});

		function render_picker_body() {
			const $body = dialog.fields_dict.picker_body.$wrapper;
			const multi_hint = allow_multiple
				? __("Tap images to select. Existing files are reused — nothing is uploaded again.")
				: __("Tap an image to use it. Picking from the library does not create a duplicate file.");

			$body.html(`
				<div class="kqs-image-picker">
					<p class="text-muted small mb-2">${multi_hint}</p>
					<div class="kqs-image-picker-toolbar flex align-center justify-between mb-3">
						<input type="search" class="form-control input-sm kqs-lib-search"
							placeholder="${__("Search images…")}" value="${frappe.utils.escape_html(library_search)}"
							style="max-width:240px;" />
						<button type="button" class="btn btn-default btn-sm kqs-lib-upload">
							<i class="fa fa-upload"></i> ${__("Upload new")}
						</button>
					</div>
					<div class="kqs-image-library-grid kqs-lib-grid"></div>
					<div class="kqs-lib-footer mt-2">
						<button type="button" class="btn btn-default btn-sm kqs-lib-more" style="display:none;">
							${__("Load more")}
						</button>
						<span class="text-muted small kqs-lib-status"></span>
					</div>
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
					library_start = 0;
					load_library_images($body, true);
				}, 300)
			);

			$body.find(".kqs-lib-more").on("click", () => {
				load_library_images($body, false);
			});

			$body.off("click", ".kqs-lib-tile").on("click", ".kqs-lib-tile", function () {
				const url = $(this).data("url");
				if (!url) return;
				if (!allow_multiple) {
					on_url(url);
					dialog.hide();
					return;
				}
				const key = normalize_image_key(url);
				if ($(this).hasClass("selected")) {
					$(this).removeClass("selected");
					selected_keys.delete(key);
				} else {
					$(this).addClass("selected");
					selected_keys.add(key);
				}
				update_selection_label($body);
			});

			load_library_images($body, true);
		}

		function update_selection_label($body) {
			const n = $body.find(".kqs-lib-tile.selected").length;
			if (!allow_multiple) return;
			const label = n ? __("Add selected ({0})", [n]) : __("Add selected");
			const $btn = dialog.$wrapper.find(".btn-modal-primary");
			if ($btn.length) $btn.text(label);
		}

		function load_library_images($body, reset) {
			if (reset) {
				library_start = 0;
				$body.find(".kqs-lib-grid").empty();
			}
			$body.find(".kqs-lib-status").text(__("Loading…"));
			frappe.call({
				method: "kqs_retail.api.product_setup.list_image_library",
				args: {
					search: library_search,
					start: library_start,
					limit: 48,
				},
				callback(r) {
					if (r.exc) return;
					const msg = r.message || {};
					const images = msg.images || [];
					library_has_more = !!msg.has_more;
					library_start += images.length;

					const $grid = $body.find(".kqs-lib-grid");
					if (reset && !images.length) {
						$grid.html(
							`<p class="text-muted small">${__(
								"No images in the library yet. Use Upload new to add one."
							)}</p>`
						);
					} else {
						const tiles = images
							.map((file) => {
								const url = file.file_url || "";
								const key = normalize_image_key(url);
								const selected = selected_keys.has(key) ? " selected" : "";
								const label = frappe.utils.escape_html(
									file.file_name || file.name || ""
								);
								return `<button type="button" class="kqs-lib-tile${selected}" data-url="${frappe.utils.escape_html(
									url
								)}" title="${label}">
									<img src="${frappe.utils.escape_html(image_preview_url(url))}" alt="" />
									<span class="kqs-lib-tile-name">${label}</span>
								</button>`;
							})
							.join("");
						if (reset) $grid.html(tiles);
						else $grid.append(tiles);
					}

					$body.find(".kqs-lib-more").toggle(library_has_more);
					$body.find(".kqs-lib-status").text(
						images.length
							? __("Showing recent images from your file library.")
							: ""
					);
					update_selection_label($body);
				},
			});
		}

		if (allow_multiple) {
			dialog.set_secondary_action_label(__("Upload new"));
			dialog.set_secondary_action(() => {
				open_upload_image_dialog((url) => {
					on_url(url);
					dialog.hide();
				}, true);
			});
		}

		dialog.show();
		render_picker_body();
	}

	function open_image_uploader(callback, allow_multiple = false) {
		open_image_picker(callback, { allow_multiple });
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
		if (main_image_index === null) {
			main_image_index = product_images.length;
		}
		product_images.push(url);
	}

	function add_product_images(urls) {
		(urls || []).forEach(add_product_image);
		render_product_images();
	}

	function remove_product_image(idx) {
		product_images.splice(idx, 1);
		if (!product_images.length) {
			main_image_index = null;
		} else if (main_image_index === idx) {
			main_image_index = 0;
		} else if (main_image_index !== null && main_image_index > idx) {
			main_image_index -= 1;
		}
		render_product_images();
	}

	function set_main_product_image(idx) {
		if (idx >= 0 && idx < product_images.length) {
			main_image_index = idx;
			render_product_images();
		}
	}

	function open_product_image_uploader() {
		open_image_picker((url) => add_product_images([url]), { allow_multiple: true });
	}

	function render_product_images() {
		const field = form.get_field("product_images_picker");
		if (!field) return;
		const $wrap = product_images_container();
		if (!$wrap.length) return;
		const main_url = get_main_product_image();
		const has_images = product_images.length > 0;

		const featured_html = main_url
			? `<img src="${frappe.utils.escape_html(image_preview_url(main_url))}" alt="" class="kqs-featured-img" />`
			: `<div class="kqs-image-placeholder-inner">
					<span class="kqs-image-placeholder-icon">+</span>
					<span class="kqs-image-placeholder-text">${__("Add photos")}</span>
				</div>`;

		const thumbs = product_images
			.map((url, idx) => {
				const is_main = idx === main_image_index;
				return `<button type="button" class="kqs-thumb-tile${is_main ? " is-main" : ""}" data-idx="${idx}" title="${__(
					"Set as main image"
				)}">
					<img src="${frappe.utils.escape_html(image_preview_url(url))}" alt="" class="kqs-thumb-img" />
					${is_main ? `<span class="kqs-thumb-badge">${__("Main")}</span>` : ""}
					<span type="button" class="kqs-thumb-remove" data-idx="${idx}" title="${__("Remove")}">×</span>
				</button>`;
			})
			.join("");

		$wrap.html(`<div class="kqs-product-images">
			<div class="kqs-product-images-title">${__("Product images")}</div>
			<button type="button" class="kqs-featured-slot${has_images ? " has-image" : " is-empty"}">
				${featured_html}
			</button>
			<div class="kqs-thumb-strip">
				${thumbs}
				<button type="button" class="kqs-thumb-tile kqs-thumb-add" title="${__("Upload more images")}">
					<span class="kqs-image-placeholder-icon">+</span>
				</button>
			</div>
			<p class="kqs-image-hint text-muted small mb-0">${__(
				has_images
					? __("Tap a thumbnail to set main. Full photo quality is kept.")
					: __("Add photos — full resolution from your phone is kept.")
			)}</p>
		</div>`);

		$wrap.find(".kqs-featured-slot.is-empty, .kqs-thumb-add").on("click", function (e) {
			if ($(e.target).closest(".kqs-thumb-remove").length) return;
			open_product_image_uploader();
		});
		$wrap.find(".kqs-thumb-tile:not(.kqs-thumb-add)").on("click", function (e) {
			if ($(e.target).closest(".kqs-thumb-remove").length) return;
			set_main_product_image(Number($(this).data("idx")));
		});
		$wrap.find(".kqs-thumb-remove").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			remove_product_image(Number($(this).data("idx")));
		});
	}

	function swatch_rows_html(attr_name, selected_values) {
		if (!selected_values.length) return "";
		const rows = selected_values
			.map((value) => {
				const image = catalog_value_image(attr_name, value);
				return `<div class="kqs-swatch-row" data-attr="${frappe.utils.escape_html(
					attr_name
				)}" data-value="${frappe.utils.escape_html(value)}">
					<span class="kqs-swatch-label">${frappe.utils.escape_html(value)}</span>
					<div class="kqs-swatch-preview">
						<img src="${image_preview_url(image)}" alt="" class="kqs-swatch-img" />
					</div>
					<button type="button" class="btn btn-default btn-xs kqs-swatch-upload">${__(
						image ? __("Change") : __("Upload")
					)}</button>
					${
						image
							? `<button type="button" class="btn btn-default btn-xs kqs-swatch-clear" title="${__(
									"Remove image"
								)}">×</button>`
							: ""
					}
				</div>`;
			})
			.join("");
		return `<div class="kqs-swatch-block">
			<div class="text-muted small mb-1">${__(
				"Optional swatch images for selected values (shown on variants in POS)"
			)}</div>
			<div class="kqs-swatch-list">${rows}</div>
		</div>`;
	}

	function sync_category_form_value() {
		form.set_value("item_group", selected_categories[0] || "");
	}

	function update_category_pill_states() {
		const $picker = form.get_field("category_picker").$wrapper;
		$picker.find(".kqs-category-pill").each(function () {
			$(this).toggleClass("active", selected_categories.includes($(this).data("name")));
		});
		update_category_selection_summary($picker);
		sync_category_form_value();
	}

	function update_category_selection_summary($picker) {
		const $summary = $picker.find(".kqs-category-selection-summary");
		if (!selected_categories.length) {
			$summary.remove();
			return;
		}
		const label =
			selected_categories.length === 1
				? __("1 category selected")
				: __("{0} categories selected", [selected_categories.length]);
		if ($summary.length) {
			$summary.text(label);
		} else {
			$picker.find(".kqs-category-shell").prepend(
				`<p class="text-muted small mb-2 kqs-category-selection-summary">${label}</p>`
			);
		}
	}

	function toggle_category(name) {
		if (!name) return;
		const idx = selected_categories.indexOf(name);
		if (idx >= 0) {
			selected_categories.splice(idx, 1);
		} else {
			selected_categories.push(name);
		}
		update_category_pill_states();
	}

	function render_category_pills(sections) {
		const $picker = form.get_field("category_picker").$wrapper;
		category_sections = sections || [];

		if (!category_sections.length) {
			$picker.html(`<p class="text-muted">${__(
				"No categories yet. Use Manage categories below to add Item Groups under Women, Men, Kids, Home & Living, or General Care & Extras."
			)}</p>${category_manage_link_html()}`);
			bind_category_manage_link($picker);
			return;
		}

		if (
			!active_department_key ||
			!category_sections.some((section) => section.key === active_department_key)
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

		const active_section =
			category_sections.find((section) => section.key === active_department_key) ||
			category_sections[0];

		$picker.html(`<div class="kqs-category-shell">
			<div class="kqs-dept-tabs" role="tablist">${tabs_html}</div>
			<div class="kqs-dept-panel">${render_department_categories(active_section)}</div>
		</div>${category_manage_link_html()}`);

		update_category_pill_states();
		bind_category_events($picker);
		bind_category_manage_link($picker);
		bind_department_tabs($picker);
	}

	function render_department_categories(section) {
		const subgroups = (section && section.subgroups) || [];
		if (!subgroups.length) {
			return `<p class="text-muted small mb-0">${__(
				"No categories in this department yet."
			)}</p>`;
		}

		if (section.key === "unisex" || (subgroups.length === 1 && subgroups[0].categories?.length === 1)) {
			return `<div class="kqs-pill-row kqs-pill-row-sm kqs-unisex-pills">${pills_html(
				subgroups[0].categories || []
			)}</div>`;
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

	function pills_html(categories) {
		if (!categories.length) {
			return `<span class="text-muted small">${__("No categories yet.")}</span>`;
		}
		return categories
			.map(
				(cat) =>
					`<button type="button" class="kqs-pill kqs-pill-sm kqs-category-pill" data-name="${frappe.utils.escape_html(
						cat.name
					)}">${frappe.utils.escape_html(cat.title || cat.item_group_name || cat.name)}</button>`
			)
			.join("");
	}

	function bind_department_tabs($root) {
		$root.find(".kqs-dept-tab").on("click", function () {
			active_department_key = $(this).data("key");
			render_category_pills(category_sections);
		});
	}

	function category_manage_link_html() {
		return `<p class="text-muted small kqs-manage-wrap mt-3 mb-0">
			${__("Add or edit categories:")}
			<a href="#" class="kqs-manage-categories">${__("Stock → Item Group")}</a>
		</p>`;
	}

	function render_attribute_manage_link() {
		const $wrap = form.get_field("attribute_manage_link").$wrapper;
		$wrap.html(`<p class="text-muted small mb-0">
			${__("Add or edit attributes and values:")}
			<a href="#" class="kqs-manage-attributes">${__("Stock → Item Attribute")}</a>
		</p>`);
		$wrap.find(".kqs-manage-attributes").on("click", (e) => {
			e.preventDefault();
			frappe.set_route("List", "Item Attribute");
		});
	}

	function bind_category_manage_link($root) {
		$root.find(".kqs-manage-categories").on("click", (e) => {
			e.preventDefault();
			frappe.set_route("Tree", "Item Group");
		});
	}

	function bind_category_events($root) {
		bind_pill_click($root, ".kqs-category-pill", function () {
			toggle_category($(this).data("name"));
		});
	}

	function normalize_category_sections(sections) {
		return (sections || []).map((section) => {
			let subgroups = section.subgroups || [];
			if (!subgroups.length && section.categories && section.categories.length) {
				subgroups = [
					{
						name: section.parent || section.key,
						title: __("Categories"),
						categories: section.categories,
					},
				];
			}
			return { ...section, subgroups };
		});
	}

	function load_categories() {
		frappe.call({
			method: "kqs_retail.api.product_setup.list_product_category_sections",
			callback(r) {
				if (r.exc) return;
				const payload = r.message || {};
				const sections = payload.sections || (Array.isArray(payload) ? payload : []);
				render_category_pills(normalize_category_sections(sections));
			},
			error() {
				frappe.msgprint(__("Could not load categories. Refresh the page or check Item Groups."));
			},
		});
	}

	function load_item_attributes() {
		frappe.call({
			method: "kqs_retail.api.product_setup.list_item_attributes",
			callback(r) {
				if (r.exc) return;
				attribute_catalog = (r.message && r.message.attributes) || [];
				const valid = new Set(attribute_catalog.map((a) => a.name));
				selected_attributes = selected_attributes.filter((name) => valid.has(name));
				render_attribute_pills();
				render_value_pickers();
				render_grid();
			},
		});
	}

	function render_attribute_pills() {
		const $picker = form.get_field("attribute_picker").$wrapper;
		if (!form.get_value("has_variants")) {
			$picker.empty();
			return;
		}
		if (!attribute_catalog.length) {
			$picker.html(`<p class="text-muted small mb-0">${__(
				"No Item Attributes yet. Add them under Stock → Item Attribute, then refresh this page."
			)}</p>`);
			return;
		}
		const pills = attribute_catalog
			.map((attr) => {
				const active = selected_attributes.includes(attr.name) ? " active" : "";
				const count = (attr.values || []).length;
				const hint = count ? ` (${count})` : "";
				return `<button type="button" class="kqs-pill kqs-attribute-pill${active}" data-name="${frappe.utils.escape_html(
					attr.name
				)}" title="${frappe.utils.escape_html(
					count
						? __("{0} values defined", [count])
						: __("No values defined yet")
				)}">${frappe.utils.escape_html(attr.name)}${hint ? `<span class="text-muted">${hint}</span>` : ""}</button>`;
			})
			.join("");
		$picker.html(`<div class="kqs-pill-row">${pills}</div>`);
		bind_attribute_events($picker);
	}

	function bind_attribute_events($root) {
		bind_pill_click($root, ".kqs-attribute-pill", function () {
			toggle_attribute($(this).data("name"));
		});
	}

	function toggle_attribute(name) {
		if (!name) return;
		const prev = selected_attributes.slice();
		const idx = selected_attributes.indexOf(name);
		if (idx >= 0) {
			selected_attributes.splice(idx, 1);
			delete quick_fill_values[name];
			delete attribute_value_images[name];
		} else {
			selected_attributes.push(name);
		}
		const changed =
			prev.length !== selected_attributes.length ||
			prev.some((n, i) => n !== selected_attributes[i]);
		if (changed) {
			variant_rows = [];
		}
		render_attribute_pills();
		render_value_pickers();
		render_grid();
	}

	function toggle_value(attr_name, value) {
		if (!attr_name) return;
		value = normalize_attribute_value(value);
		if (!value) return;
		if (!quick_fill_values[attr_name]) {
			quick_fill_values[attr_name] = [];
		}
		const selected = quick_fill_values[attr_name];
		const idx = selected.findIndex((v) => normalize_attribute_value(v) === value);
		if (idx >= 0) {
			selected.splice(idx, 1);
		} else {
			selected.push(value);
		}
		render_value_pickers();
	}

	function all_attribute_values_selected() {
		if (!selected_attributes.length) return false;
		return selected_attributes.every((name) => selected_value_count(name) > 0);
	}

	function sync_variant_grid_from_selection() {
		if (!form.get_value("has_variants") || !selected_attributes.length) {
			return;
		}

		if (!all_attribute_values_selected()) {
			variant_rows = [];
			render_grid();
			return;
		}

		if (variant_rows.length) {
			sync_rows_from_dom();
		}

		const selections = {};
		selected_attributes.forEach((name) => {
			selections[name] = quick_fill_values[name].slice();
		});
		const combos = cartesian_combinations(selections);
		const by_key = new Map();
		const manual_incomplete = [];

		variant_rows.forEach((row) => {
			const attrs = row.attributes || {};
			const complete = selected_attributes.every((name) => attrs[name]);
			if (complete) {
				by_key.set(row_key(attrs), row);
			} else {
				manual_incomplete.push(row);
			}
		});

		const synced_rows = combos.map((attrs) => {
			const key = row_key(attrs);
			const existing = by_key.get(key);
			if (existing) {
				return existing;
			}
			return {
				attributes: { ...attrs },
				sku: default_variant_sku(attrs),
				rate: "",
				barcode: "",
				qty: "",
			};
		});

		variant_rows = [...synced_rows, ...manual_incomplete];
		render_grid();
	}

	function selected_value_count(attr_name) {
		return (quick_fill_values[attr_name] || []).length;
	}

	function combination_count() {
		if (!selected_attributes.length) return 0;
		let count = 1;
		for (const name of selected_attributes) {
			const vals = quick_fill_values[name] || [];
			if (!vals.length) return 0;
			count *= vals.length;
		}
		return count;
	}

	function combination_preview_text() {
		if (!selected_attributes.length) return "";
		const parts = selected_attributes.map((name) => {
			const n = selected_value_count(name);
			return n ? `${n} ${name}` : null;
		});
		if (parts.some((p) => !p)) {
			return __("Select at least one value for each attribute.");
		}
		const total = combination_count();
		return __("{0} = {1} variant combinations", [parts.join(" × "), total]);
	}

	function load_defaults() {
		frappe.call({
			method: "kqs_retail.api.product_setup.get_add_product_defaults",
			callback(r) {
				if (r.exc) return;
				const defaults = r.message || {};
				if (defaults.warehouse) {
					form.set_value("warehouse", defaults.warehouse);
				} else {
					frappe.call({
						method: "kqs_retail.api.stock_transfer.get_transfer_defaults",
						callback(r2) {
							if (r2.exc) return;
							const wh = r2.message?.source_warehouse || r2.message?.warehouse;
							if (wh) form.set_value("warehouse", wh);
						},
					});
				}
				if (defaults.stock_uom) {
					form.set_value("stock_uom", defaults.stock_uom);
				}
			},
		});
	}

	function toggle_field_visibility(fieldname, visible) {
		const field = form.fields_dict[fieldname];
		if (!field || !field.$wrapper) return;
		const $target =
			field.df.fieldtype === "Section Break"
				? field.$wrapper.closest(".section-body, .form-section, .frappe-control").first()
				: field.$wrapper.closest(".frappe-control");
		if ($target.length) {
			$target.toggle(visible);
		} else {
			field.$wrapper.toggle(visible);
		}
	}

	function toggle_variant_sections() {
		const show = !!form.get_value("has_variants");
		[
			"variant_attributes_section",
			"attribute_picker",
			"attribute_manage_link",
			"quick_fill_section",
			"quick_fill_picker",
		].forEach((name) => toggle_field_visibility(name, show));
		if (show) {
			render_attribute_pills();
			render_value_pickers();
		}
	}

	function render_value_pickers() {
		const $picker = form.get_field("quick_fill_picker").$wrapper;
		if (!form.get_value("has_variants") || !selected_attributes.length) {
			$picker.empty();
			return;
		}
		if (!attribute_catalog.length) {
			$picker.html(`<p class="text-muted small">${__(
				"No Item Attributes found. Add attributes under Stock → Item Attribute."
			)}</p>`);
			return;
		}

		const blocks = selected_attributes
			.map((name) => {
				const values = attribute_values(name);
				const selected = quick_fill_values[name] || [];
				if (!values.length) {
					return `<div class="kqs-value-block">
						<div class="kqs-value-label">${frappe.utils.escape_html(name)}</div>
						<p class="text-muted small mb-0">${__(
							"No values defined. Add values on this Item Attribute first."
						)}</p>
					</div>`;
				}
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
				const count_hint =
					selected.length > 0
						? `<span class="kqs-value-count kqs-value-count-active">${__("{0} selected", [selected.length])}</span>`
						: `<span class="kqs-value-count text-muted">${__("Tap values to select")}</span>`;
				return `<div class="kqs-value-block">
					<div class="kqs-value-header">
						<div class="kqs-value-label">${frappe.utils.escape_html(name)}</div>
						${count_hint}
					</div>
					<div class="kqs-pill-row kqs-pill-row-sm">${pills}</div>
					${swatch_rows_html(name, selected)}
				</div>`;
			})
			.join("");

		const preview = combination_preview_text();
		const combo_count = combination_count();
		const can_add = combo_count > 0;
		const actions = `<div class="kqs-variant-builder-actions">
			<span class="kqs-combo-preview${can_add ? "" : " text-muted"}">${frappe.utils.escape_html(preview)}</span>
			<button type="button" class="btn btn-default btn-sm kqs-add-variants-from-selection"${can_add ? "" : " disabled"}>${__(
				"Add {0} variants to table",
				[combo_count || 0]
			)}</button>
		</div>`;

		$picker.html(`<div class="kqs-value-section">${blocks}${actions}</div>`);
		bind_value_picker_events($picker);
	}

	function bind_value_picker_events($root) {
		bind_pill_click($root, ".kqs-value-pill", function () {
			toggle_value($(this).data("attr"), read_pill_data_value($(this)));
		});
		$root.find(".kqs-add-variants-from-selection").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			if ($(this).prop("disabled")) return;
			add_variants_from_selection();
		});
		$root.find(".kqs-swatch-upload").on("click", function () {
			const $row = $(this).closest(".kqs-swatch-row");
			const attr_name = $row.data("attr");
			const value = read_pill_data_value($row);
			open_image_uploader((url) => {
				set_attribute_value_image(attr_name, value, url);
				render_value_pickers();
			});
		});
		$root.find(".kqs-swatch-clear").on("click", function () {
			const $row = $(this).closest(".kqs-swatch-row");
			set_attribute_value_image($row.data("attr"), read_pill_data_value($row), "");
			render_value_pickers();
		});
	}

	function collect_attribute_value_images_payload() {
		const payload = {};
		Object.keys(attribute_value_images).forEach((attr_name) => {
			const values = attribute_value_images[attr_name];
			if (!values) return;
			const mapped = {};
			Object.keys(values).forEach((value) => {
				if (values[value]) mapped[value] = values[value];
			});
			if (Object.keys(mapped).length) payload[attr_name] = mapped;
		});
		return payload;
	}

	function select_html(className, attrName, options, value) {
		const normalized = value === null || value === undefined ? "" : String(value);
		const opts = [`<option value="">${__("Select")}</option>`]
			.concat(
				options.map((opt) => {
					const opt_str = String(opt);
					const selected = opt_str === normalized ? " selected" : "";
					return `<option value="${frappe.utils.escape_html(opt_str)}"${selected}>${frappe.utils.escape_html(
						opt_str
					)}</option>`;
				})
			)
			.join("");
		return `<select class="form-control input-sm ${className}" data-attr="${frappe.utils.escape_html(
			attrName
		)}">${opts}</select>`;
	}

	function attr_cell_html(attr_name, value) {
		const normalized = value === null || value === undefined ? "" : String(value).trim();
		if (normalized) {
			return `<td class="kqs-attr-cell" data-attr="${frappe.utils.escape_html(attr_name)}">
				<span class="kqs-attr-value">${frappe.utils.escape_html(normalized)}</span>
			</td>`;
		}
		return `<td class="kqs-attr-cell" data-attr="${frappe.utils.escape_html(attr_name)}">${select_html(
			"kqs-attr-select",
			attr_name,
			attribute_values(attr_name),
			""
		)}</td>`;
	}

	function empty_attributes() {
		const attrs = {};
		selected_attributes.forEach((name) => {
			attrs[name] = "";
		});
		return attrs;
	}

	function default_variant_sku(attributes) {
		const base = (form.get_value("style_code") || "").trim();
		if (!base) return "";
		const parts = selected_attributes
			.map((name) => attributes[name])
			.filter(Boolean)
			.map((v) => String(v).replace(/\s+/g, "-"));
		return parts.length ? `${base}-${parts.join("-")}` : base;
	}

	function row_key(attributes) {
		return selected_attributes.map((name) => `${name}=${attributes[name] || ""}`).join("|");
	}

	function get_default_rate() {
		const value = form.get_value("default_rate");
		return value === null || value === undefined || value === "" ? "" : String(value);
	}

	function display_rate(row) {
		if (row.rate !== "" && row.rate !== null && row.rate !== undefined) {
			return row.rate;
		}
		return get_default_rate();
	}

	function resolve_rate(row) {
		const custom = row.rate !== "" && row.rate !== null && row.rate !== undefined;
		if (custom) {
			return parseFloat(row.rate) || 0;
		}
		return parseFloat(get_default_rate()) || 0;
	}

	function read_rows_from_dom() {
		const default_rate = get_default_rate();
		const rows = [];
		form.get_field("variant_grid").$wrapper.find(".kqs-variant-row").each(function () {
			const attributes = {};
			const $row = $(this);
			selected_attributes.forEach((name) => {
				const $cell = $row.find(`.kqs-attr-cell[data-attr="${CSS.escape(name)}"]`);
				const $select = $cell.find(".kqs-attr-select");
				if ($select.length) {
					attributes[name] = $select.val() || "";
				} else {
					attributes[name] = ($cell.find(".kqs-attr-value").text() || "").trim();
				}
			});
			const raw_rate = $(this).find(".kqs-rate").val();
			const rate_str = raw_rate === null || raw_rate === undefined ? "" : String(raw_rate);
			const uses_default =
				rate_str === "" || (default_rate !== "" && rate_str === default_rate);
			const raw_qty = $(this).find(".kqs-qty").val();
			rows.push({
				attributes,
				sku: $(this).find(".kqs-sku").val() || "",
				rate: uses_default ? "" : rate_str,
				barcode: $(this).find(".kqs-barcode").val() || "",
				qty: raw_qty === null || raw_qty === undefined || raw_qty === "" ? "" : String(raw_qty),
			});
		});
		return rows;
	}

	function sync_rows_from_dom() {
		if (form.get_value("has_variants")) {
			variant_rows = read_rows_from_dom();
		}
	}

	function add_variant_row(preset_attributes = null) {
		sync_rows_from_dom();
		variant_rows.push({
			attributes: preset_attributes || empty_attributes(),
			sku: "",
			rate: "",
			barcode: "",
			qty: "",
		});
		render_grid();
	}

	function cartesian_combinations(selections) {
		const keys = Object.keys(selections);
		if (!keys.length) return [];
		let combos = [{}];
		keys.forEach((key) => {
			const values = selections[key];
			if (!values.length) return;
			const next = [];
			combos.forEach((combo) => {
				values.forEach((value) => {
					next.push({ ...combo, [key]: value });
				});
			});
			combos = next;
		});
		return combos.filter((combo) => Object.keys(combo).length === keys.length);
	}

	function add_variants_from_selection() {
		if (!all_attribute_values_selected()) {
			frappe.msgprint(__("Select at least one value for each attribute first."));
			return;
		}
		sync_variant_grid_from_selection();
		if (variant_rows.length) {
			frappe.show_alert({
				message: __("{0} variant row(s) added to the table. Review them, then click Save Product.", [
					variant_rows.length,
				]),
				indicator: "blue",
			});
		}
		render_grid();
	}

	function remove_variant_row(idx) {
		sync_rows_from_dom();
		variant_rows.splice(idx, 1);
		render_grid();
	}

	function render_grid() {
		const $grid = form.get_field("variant_grid").$wrapper;
		const has_variants = form.get_value("has_variants");

		if (!has_variants) {
			const saved = read_rows_from_dom()[0] || {};
			$grid.html(`
				<table class="table table-bordered table-sm kqs-variant-table">
					<thead><tr>
						<th>${__("Product")}</th>
						<th>${__("Barcode")}</th>
						<th style="width:100px;">${__("Qty")}</th>
					</tr></thead>
					<tbody>
						<tr class="kqs-variant-row" data-idx="0">
							<td>${frappe.utils.escape_html(form.get_value("item_name") || __("Product"))}</td>
							<td><input type="text" class="form-control input-sm kqs-barcode" placeholder="${__("Barcode")}"
								value="${frappe.utils.escape_html(saved.barcode || "")}" style="min-width:120px;" /></td>
							<td><input type="number" min="0" step="1" class="form-control input-sm kqs-qty" placeholder="${__("Qty")}"
								value="${frappe.utils.escape_html(saved.qty || "")}" style="width:100px;" /></td>
						</tr>
					</tbody>
				</table>
				<p class="text-muted small mb-0">${__("Price is set above. Opening qty is optional.")}</p>
			`);
			return;
		}

		const toolbar = `<div class="kqs-variant-toolbar mb-2">
			<button type="button" class="btn btn-default btn-sm kqs-add-variant">${__("+ Add single variant")}</button>
		</div>`;

		if (!selected_attributes.length) {
			$grid.html(
				`${toolbar}<p class="text-muted">${__(
					"Select variant attributes in step 1, then pick values in step 2."
				)}</p>`
			);
			bind_variant_toolbar($grid);
			return;
		}

		if (!variant_rows.length) {
			const hint = all_attribute_values_selected()
				? __("Click Add to variant table above to build rows from your selected values.")
				: __("Select at least one value for each attribute, then click Add to variant table.");
			$grid.html(`${toolbar}<p class="text-muted">${hint}</p>`);
			bind_variant_toolbar($grid);
			return;
		}

		const default_rate = get_default_rate();
		const attr_headers = selected_attributes
			.map((name) => `<th>${frappe.utils.escape_html(name)}</th>`)
			.join("");

		const body = variant_rows
			.map((row, idx) => {
				const attrs = row.attributes || empty_attributes();
				const default_sku = default_variant_sku(attrs);
				const rate_value = display_rate(row);
				const rate_placeholder = default_rate
					? __("Default: {0}", [default_rate])
					: __("Price");
				const attr_cells = selected_attributes
					.map((name) => attr_cell_html(name, attrs[name]))
					.join("");
				return `<tr class="kqs-variant-row" data-idx="${idx}">
					${attr_cells}
					<td><input type="text" class="form-control input-sm kqs-sku"
						placeholder="${frappe.utils.escape_html(default_sku)}"
						value="${frappe.utils.escape_html(row.sku || "")}" style="min-width:130px;" /></td>
					<td><input type="number" step="0.01" class="form-control input-sm kqs-rate"
						placeholder="${frappe.utils.escape_html(rate_placeholder)}"
						value="${frappe.utils.escape_html(rate_value)}" style="width:90px;" /></td>
					<td><input type="text" class="form-control input-sm kqs-barcode" placeholder="${__("Barcode")}"
						value="${frappe.utils.escape_html(row.barcode || "")}" style="min-width:110px;" /></td>
					<td><input type="number" min="0" step="1" class="form-control input-sm kqs-qty" placeholder="${__("Qty")}"
						value="${frappe.utils.escape_html(row.qty || "")}" style="width:80px;" /></td>
					<td class="text-right" style="width:40px;">
						<button type="button" class="btn btn-xs btn-default kqs-remove-variant" data-idx="${idx}" title="${__(
							"Remove"
						)}">×</button>
					</td>
				</tr>`;
			})
			.join("");

		$grid.html(`
			${toolbar}
			<table class="table table-bordered table-sm kqs-variant-table">
				<thead><tr>
					${attr_headers}
					<th>${__("SKU")} <span class="text-muted small">${__("(optional)")}</span></th>
					<th>${__("Price")} <span class="text-muted small">${__("(override)")}</span></th>
					<th>${__("Barcode")}</th>
					<th>${__("Qty")}</th>
					<th></th>
				</tr></thead>
				<tbody>${body}</tbody>
			</table>
			<p class="text-muted small mb-0">${__(
				"Only rows listed here are created. Variant prices use the price above unless overridden."
			)}</p>
		`);
		bind_variant_toolbar($grid);
	}

	function bind_variant_toolbar($root) {
		$root.find(".kqs-add-variant").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			add_variant_row();
		});
		$root.find(".kqs-remove-variant").on("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			remove_variant_row(Number($(this).data("idx")));
		});
	}

	function collect_variant_matrix() {
		if (!form.get_value("has_variants")) {
			const $row = form.get_field("variant_grid").$wrapper.find(".kqs-variant-row").first();
			const raw_qty = $row.find(".kqs-qty").val();
			return [
				{
					attributes: {},
					sku: "",
					rate: parseFloat(get_default_rate()) || 0,
					barcode: $row.find(".kqs-barcode").val() || "",
					qty: raw_qty ? parseFloat(raw_qty) || 0 : 0,
				},
			];
		}

		sync_rows_from_dom();
		return variant_rows.map((row) => ({
			attributes: { ...(row.attributes || {}) },
			sku: (row.sku || "").trim() || default_variant_sku(row.attributes || {}),
			rate: resolve_rate(row),
			barcode: row.barcode || "",
			qty: row.qty ? parseFloat(row.qty) || 0 : 0,
		}));
	}

	function has_any_qty(matrix) {
		return matrix.some((row) => (parseFloat(row.qty) || 0) > 0);
	}

	function clear_product_form() {
		form.set_value("item_name", "");
		form.set_value("style_code", "");
		form.set_value("default_rate", "");
		form.set_value("description", "");
		form.set_value("has_variants", 0);
		variant_rows = [];
		selected_attributes = [];
		quick_fill_values = {};
		product_images = [];
		main_image_index = null;
		attribute_value_images = {};
		selected_categories = [];
		sync_category_form_value();
		update_category_pill_states();
		toggle_variant_sections();
		render_attribute_pills();
		render_value_pickers();
		render_product_images();
		render_grid();
		load_defaults();
	}

	function save_product() {
		if (save_in_progress) return;
		if (!(form.get_value("item_name") || "").trim()) {
			frappe.msgprint(__("Enter product name."));
			return;
		}
		if (!selected_categories.length) {
			frappe.msgprint(__("Select at least one category."));
			return;
		}
		if (!(form.get_value("style_code") || "").trim()) {
			frappe.msgprint(__("Enter SKU / Style number."));
			return;
		}
		if (get_default_rate() === "") {
			if (!form.get_value("has_variants")) {
				frappe.msgprint(__("Enter product price."));
				return;
			}
			sync_rows_from_dom();
			const all_custom =
				variant_rows.length > 0 && variant_rows.every((r) => r.rate !== "");
			if (!all_custom) {
				frappe.msgprint(__("Enter default price, or set a price on every variant row."));
				return;
			}
		}
		if (form.get_value("has_variants")) {
			if (!selected_attributes.length) {
				frappe.msgprint(__("Select at least one variant attribute."));
				return;
			}
			sync_rows_from_dom();
			if (!variant_rows.length) {
				frappe.msgprint(__("Add at least one variant row using Add to variant table."));
				return;
			}
			const incomplete = variant_rows.some((r) =>
				selected_attributes.some((name) => !(r.attributes && r.attributes[name]))
			);
			if (incomplete) {
				frappe.msgprint(__("Each variant row needs a value for every selected attribute."));
				return;
			}
			const keys = variant_rows.map((r) => row_key(r.attributes));
			if (new Set(keys).size !== keys.length) {
				frappe.msgprint(__("Remove duplicate attribute combinations."));
				return;
			}
		}

		const variant_matrix = collect_variant_matrix();
		if (!variant_matrix.length) {
			frappe.msgprint(__("Add variant details before saving."));
			return;
		}
		if (has_any_qty(variant_matrix) && !form.get_value("warehouse")) {
			frappe.msgprint(__("Select a warehouse when entering opening quantities."));
			return;
		}
		if (!form.get_value("stock_uom")) {
			frappe.msgprint(__("Select a unit of measure."));
			return;
		}

		save_in_progress = true;
		frappe.call({
			method: "kqs_retail.api.product_setup.create_product_with_variants",
			args: {
				item_name: form.get_value("item_name"),
				style_code: form.get_value("style_code"),
				item_group: selected_categories[0],
				item_groups: JSON.stringify(selected_categories),
				description: form.get_value("description"),
				has_variants: form.get_value("has_variants") ? 1 : 0,
				central_warehouse: form.get_value("warehouse") || "",
				stock_uom: form.get_value("stock_uom") || "",
				product_image: get_main_product_image(),
				gallery_images: JSON.stringify(get_gallery_product_images()),
				attribute_value_images: JSON.stringify(collect_attribute_value_images_payload()),
				variant_attributes: JSON.stringify(
					form.get_value("has_variants") ? selected_attributes : []
				),
				variant_matrix: JSON.stringify(variant_matrix),
			},
			freeze: true,
			callback(r) {
				save_in_progress = false;
				if (!r.exc && r.message) {
					frappe.show_alert({
						message: __("Product {0} created.", [r.message.template]),
						indicator: "green",
					});
					clear_product_form();
				}
			},
			error() {
				save_in_progress = false;
			},
		});
	}

	function setup_page_actions() {
		if (page.clear_menu) {
			page.clear_menu();
		}
		page.set_primary_action(__("Save Product"), save_product);
		if (page.set_secondary_action) {
			page.set_secondary_action(__("Assign to Branch"), () => {
				frappe.set_route("assign-to-branch");
			});
		}
		if (page.add_menu_item) {
			page.add_menu_item(__("Edit Product"), () => frappe.set_route("edit-product"));
			page.add_menu_item(__("Receive Stock"), () => frappe.set_route("receive-stock"));
			page.add_menu_item(__("Manage Item Groups"), () => frappe.set_route("Tree", "Item Group"));
			page.add_menu_item(__("Clear form"), () => {
				frappe.confirm(__("Clear all fields on this form?"), clear_product_form);
			});
		}
	}

	load_categories();
	load_item_attributes();
	load_defaults();
	render_attribute_manage_link();
	render_product_images();
	toggle_variant_sections();
	render_grid();
	setup_page_actions();

	$("#kqs-add-product-style").remove();
	$("head").append(`<style id="kqs-add-product-style">
			.kqs-product-header-section {
				display:flex;
				flex-wrap:wrap;
				gap:1rem;
				align-items:flex-start;
				margin-bottom:0.25rem;
			}
			.kqs-product-header-section > .form-column {
				flex:1;
				min-width:0;
				padding:0;
			}
			.kqs-product-header-left { flex:1.2; max-width:100%; }
			.kqs-product-header-right {
				flex:0 0 auto;
				width:auto;
				max-width:none;
			}
			.kqs-product-header-right [data-fieldname="product_images_picker"] > .control-label {
				display:none;
			}
			.kqs-product-header-right [data-fieldname="product_images_picker"] {
				margin-bottom:0;
			}
			.kqs-product-images {
				width:auto;
				max-width:112px;
			}
			.kqs-product-images-title {
				font-size:11px;
				font-weight:600;
				margin-bottom:0.35rem;
				color:var(--text-color,#171717);
			}
			.kqs-featured-slot {
				display:block;
				width:112px;
				height:112px;
				max-width:112px;
				padding:0;
				border:2px dashed #bdbdbd;
				border-radius:6px;
				background:#fafafa;
				cursor:pointer;
				overflow:hidden;
				position:relative;
				transition:border-color 0.15s ease, background 0.15s ease;
				box-sizing:border-box;
			}
			.kqs-featured-slot:hover {
				border-color:#171717;
				background:#f5f5f5;
			}
			.kqs-featured-slot.has-image {
				border-style:solid;
				border-color:#171717;
				background:#fff;
			}
			.kqs-featured-img {
				width:100%;
				height:100%;
				object-fit:cover;
				display:block;
			}
			.kqs-image-placeholder-inner {
				display:flex;
				flex-direction:column;
				align-items:center;
				justify-content:center;
				height:100%;
				color:#737373;
				gap:0.2rem;
			}
			.kqs-image-placeholder-icon {
				font-size:1.35rem;
				line-height:1;
				font-weight:300;
			}
			.kqs-image-placeholder-text {
				font-size:10px;
				font-weight:500;
			}
			.kqs-thumb-strip {
				display:flex;
				flex-wrap:wrap;
				gap:0.3rem;
				margin-top:0.35rem;
			}
			.kqs-thumb-tile {
				position:relative;
				width:40px;
				height:40px;
				padding:0;
				border:2px solid #d4d4d4;
				border-radius:4px;
				background:#fafafa;
				cursor:pointer;
				overflow:hidden;
				flex-shrink:0;
			}
			.kqs-thumb-tile:hover { border-color:#737373; }
			.kqs-thumb-tile.is-main {
				border-color:#000;
				box-shadow:0 0 0 1px #000;
			}
			.kqs-thumb-tile.kqs-thumb-add {
				display:flex;
				align-items:center;
				justify-content:center;
				border-style:dashed;
				color:#737373;
			}
			.kqs-thumb-tile.kqs-thumb-add .kqs-image-placeholder-icon {
				font-size:1.1rem;
			}
			.kqs-thumb-img {
				width:100%;
				height:100%;
				object-fit:cover;
				display:block;
			}
			.kqs-thumb-badge {
				position:absolute;
				left:0;
				right:0;
				bottom:0;
				background:rgba(0,0,0,0.75);
				color:#fff;
				font-size:8px;
				font-weight:600;
				text-transform:uppercase;
				text-align:center;
				padding:0;
				line-height:1.3;
			}
			.kqs-thumb-remove {
				position:absolute;
				top:0;
				right:0;
				width:14px;
				height:14px;
				line-height:12px;
				text-align:center;
				font-size:11px;
				background:rgba(255,255,255,0.95);
				border:1px solid #e2e2e2;
				border-radius:3px;
				color:#525252;
				cursor:pointer;
				z-index:1;
			}
			.kqs-thumb-remove:hover { background:#fff; color:#000; }
			.kqs-image-hint { margin-top:0.35rem; line-height:1.3; font-size:10px; }
			.kqs-image-picker-toolbar { gap:0.5rem; flex-wrap:wrap; }
			.kqs-image-library-grid {
				display:grid;
				grid-template-columns:repeat(auto-fill, minmax(96px, 1fr));
				gap:10px;
				max-height:min(60vh, 420px);
				overflow-y:auto;
				padding:2px;
			}
			.kqs-lib-tile {
				position:relative;
				display:block;
				width:100%;
				aspect-ratio:1;
				padding:0;
				border:2px solid #d4d4d4;
				border-radius:6px;
				background:#f5f5f5;
				cursor:pointer;
				overflow:hidden;
				text-align:left;
			}
			.kqs-lib-tile:hover { border-color:#737373; }
			.kqs-lib-tile.selected {
				border-color:#171717;
				box-shadow:0 0 0 2px #171717;
			}
			.kqs-lib-tile img {
				width:100%;
				height:100%;
				object-fit:cover;
				display:block;
			}
			.kqs-lib-tile-name {
				position:absolute;
				left:0;
				right:0;
				bottom:0;
				padding:2px 4px;
				font-size:9px;
				line-height:1.2;
				color:#fff;
				background:linear-gradient(transparent, rgba(0,0,0,0.75));
				white-space:nowrap;
				overflow:hidden;
				text-overflow:ellipsis;
			}
			.kqs-category-shell {
				border:1px solid var(--border-color,#e2e2e2);
				border-radius:8px;
				background:#fafafa;
				overflow:hidden;
			}
			.kqs-dept-tabs {
				display:flex;
				flex-wrap:wrap;
				gap:0.35rem;
				padding:0.5rem;
				background:#fff;
				border-bottom:1px solid var(--border-color,#e2e2e2);
			}
			.kqs-dept-tab {
				border:1.5px solid #d4d4d4;
				border-radius:999px;
				background:#fff;
				color:#171717;
				font-size:13px;
				font-weight:600;
				line-height:1.25;
				padding:0.4rem 0.85rem;
				cursor:pointer;
				transition:background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
			}
			.kqs-dept-tab:hover { background:#f5f5f5; border-color:#a3a3a3; }
			.kqs-dept-tab.active {
				background:#000;
				border-color:#000;
				color:#fff;
			}
			.kqs-dept-panel {
				padding:0.65rem 0.75rem 0.75rem;
				max-height:420px;
				overflow-y:auto;
			}
			.kqs-category-subgroup-card {
				background:#fff;
				border:1px solid var(--border-color,#e2e2e2);
				border-radius:6px;
				padding:0.55rem 0.65rem 0.65rem;
				margin-bottom:0.55rem;
			}
			.kqs-category-subgroup-card:last-child { margin-bottom:0; }
			.kqs-category-row { display:flex; gap:1.5rem; margin-bottom:1rem; }
			.kqs-category-col { flex:1; min-width:0; }
			.kqs-category-section { margin-bottom:0.75rem; }
			.kqs-category-subgroup { margin-bottom:0.5rem; }
			.kqs-category-subgroup:last-child { margin-bottom:0; }
			.kqs-category-subtitle {
				font-size:12px;
				font-weight:700;
				color:#171717;
				margin:0 0 0.4rem;
				text-transform:uppercase;
				letter-spacing:0.04em;
			}
			.kqs-category-title {
				display:inline-block;
				background:#171717;
				color:#fff;
				font-weight:600;
				font-size:12px;
				line-height:1.2;
				padding:0.3rem 0.75rem;
				border-radius:999px;
				margin-bottom:0.5rem;
				text-transform:uppercase;
				letter-spacing:0.04em;
			}
			[data-fieldname="category_picker"] .control-input,
			[data-fieldname="category_picker"] .like-disabled-input {
				overflow:visible;
				max-height:none;
			}
			.kqs-pill-row { display:flex; flex-wrap:wrap; gap:0.375rem; }
			.kqs-pill-row-sm { gap:0.3rem; }
			.kqs-pill {
				display:inline-flex;
				align-items:center;
				border:2px solid #000;
				border-radius:999px;
				font-size:13px;
				line-height:1.25;
				padding:0.375rem 0.75rem;
				font-weight:500;
				background:#fff;
				color:#171717;
				cursor:pointer;
				box-shadow:none;
				transition:background 0.12s ease, color 0.12s ease;
			}
			.kqs-pill-sm {
				font-size:11px;
				line-height:1.2;
				padding:0.25rem 0.55rem;
				border-width:1.5px;
				font-weight:500;
			}
			.kqs-category-pill {
				font-size:12px;
				line-height:1.25;
				padding:0.3rem 0.62rem;
			}
			.kqs-add-product-form button.kqs-pill {
				-webkit-appearance: none;
				appearance: none;
				font-family: inherit;
			}
			.kqs-pill:hover { background:#f5f5f5; }
			.kqs-add-product-form button.kqs-pill.active,
			.kqs-add-product-form button.kqs-pill.kqs-value-pill.active,
			.kqs-add-product-form button.kqs-pill.kqs-attribute-pill.active,
			.kqs-add-product-form button.kqs-pill.kqs-category-pill.active {
				background:#000 !important;
				color:#fff !important;
				border-color:#000 !important;
			}
			.kqs-add-product-form button.kqs-pill.active:hover {
				background:#171717 !important;
			}
			.kqs-add-product-form button.kqs-pill.active .text-muted {
				color:rgba(255,255,255,0.78) !important;
			}
			.kqs-value-count-active {
				font-weight:600;
				color:var(--text-color,#171717);
			}
			.kqs-value-section { margin-top:0.25rem; }
			.kqs-value-block { margin-bottom:1.25rem; }
			.kqs-value-block:last-of-type { margin-bottom:0.75rem; }
			.kqs-value-header {
				display:flex;
				align-items:baseline;
				justify-content:space-between;
				gap:0.75rem;
				margin-bottom:0.5rem;
			}
			.kqs-value-label {
				font-weight:600;
				font-size:13px;
				color:var(--text-color,#171717);
			}
			.kqs-value-count { font-size:12px; }
			.kqs-variant-builder-actions {
				display:flex;
				flex-wrap:wrap;
				align-items:center;
				justify-content:space-between;
				gap:0.75rem;
				padding-top:0.75rem;
				margin-top:0.5rem;
				border-top:1px solid var(--border-color,#e2e2e2);
			}
			.kqs-combo-preview { font-size:13px; font-weight:500; }
			.kqs-swatch-block { margin-top:0.75rem; }
			.kqs-swatch-list { display:flex; flex-direction:column; gap:0.5rem; }
			.kqs-swatch-row {
				display:flex;
				align-items:center;
				gap:0.5rem;
				flex-wrap:wrap;
			}
			.kqs-swatch-label { min-width:4rem; font-size:12px; font-weight:500; }
			.kqs-swatch-preview {
				width:40px;
				height:40px;
				border:1px solid var(--border-color,#e2e2e2);
				border-radius:4px;
				overflow:hidden;
				background:#fafafa;
				flex-shrink:0;
			}
			.kqs-swatch-img { width:100%; height:100%; object-fit:cover; display:block; }
			.kqs-variant-table { font-size:12px; margin-bottom:0.5rem; }
			.kqs-variant-table th { font-weight:500; font-size:11px; }
			.kqs-attr-value {
				display:inline-block;
				padding:0.15rem 0.45rem;
				border-radius:4px;
				background:#f5f5f5;
				font-weight:500;
				font-size:12px;
				line-height:1.3;
			}
			.kqs-variant-toolbar .btn { font-size:12px; }
			.kqs-remove-variant { line-height:1; padding:0 0.4rem; font-size:14px; }
			.kqs-unisex-pills { padding:0.15rem 0; }
			.page-container[data-page-route="quick-add-product"] .page-actions,
			.page-container[data-page-route="quick-add-product"] .standard-actions {
				display:flex !important;
				align-items:center;
				gap:0.5rem;
				visibility:visible !important;
				opacity:1 !important;
			}
			@media (max-width:768px) {
				.kqs-dept-tab { font-size:12px; padding:0.35rem 0.7rem; }
				.kqs-product-header-section { flex-direction:column; }
				.kqs-product-header-right {
					flex:0 0 auto;
					max-width:none;
				}
				.kqs-category-row { flex-direction:column; gap:0.75rem; }
				.kqs-category-title { font-size:11px; padding:0.28rem 0.65rem; }
				.kqs-pill { font-size:12px; padding:0.35rem 0.65rem; }
				.kqs-pill-sm { font-size:10px; padding:0.22rem 0.5rem; }
				.kqs-category-pill { font-size:11px; padding:0.26rem 0.55rem; }
			}
		</style>`);

	wrapper.kqs_add_product_form = form;
	wrapper.kqs_reload_categories = load_categories;
	wrapper.kqs_reload_attributes = load_item_attributes;
	wrapper.kqs_toggle_variant_sections = toggle_variant_sections;
	wrapper.kqs_setup_page_actions = setup_page_actions;
};

frappe.pages["quick-add-product"].on_page_show = function (wrapper) {
	if (frappe.app.sidebar) {
		frappe.app.sidebar.setup("Stock");
	}
	if (wrapper && wrapper.kqs_setup_page_actions) {
		wrapper.kqs_setup_page_actions();
	}
	if (wrapper && wrapper.kqs_reload_categories) {
		wrapper.kqs_reload_categories();
	}
	if (wrapper && wrapper.kqs_reload_attributes) {
		wrapper.kqs_reload_attributes();
	}
	if (wrapper && wrapper.kqs_toggle_variant_sections) {
		wrapper.kqs_toggle_variant_sections();
	}
};
