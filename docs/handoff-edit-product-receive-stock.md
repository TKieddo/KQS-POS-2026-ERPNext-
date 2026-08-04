# KQS POS — Handoff: Manager Edit Product + Receive Stock (production)

> Paste this prompt into a **new Cursor chat** in the KQS POS repo to implement the work below. Update this file when scope or decisions change.

## Mission

Implement **two manager features** in `kqs_retail` to close critical catalog/stock gaps. Both must be **production-ready**: Desk pages, whitelisted APIs, permissions, edge cases, docs, cashier isolation, and wire into existing KQS Retail workspace / Stock sidebar.

Also audit related inventory gaps and either implement P0 fully or document as explicit out-of-scope with ERPNext fallback — **no half-built features**.

### P0 (must ship in this work)

1. **Edit Product / Variants** — load an existing template; edit details; **add new variants** (new size/colour combinations) without deleting the product; edit price/barcode/image/disable per variant.
2. **Receive Stock** — for products that **already exist**, receive qty into a warehouse (default Central), then manager uses existing **Assign to Branch** to push to stores.

### Context (why)

- **Add Product** (`/app/quick-add-product`) is **create-only**. After save the form clears. There is **nowhere in KQS UI** to add a new Size/Color to a parent template — managers currently must delete or use awkward ERPNext Item forms.
- **Assign to Branch** only **transfers** stock that already exists at the source. It does **not** create inbound stock for existing SKUs.
- Opening qty on Add Product is the only KQS receive path today (`_receipt_stock` → Material Receipt). Daily “more stock arrived” has no KQS page.

---

## Repo & stack

- Workspace: KQS POS monorepo; custom app `kqs_retail/` only — **never fork ERPNext**.
- Local: Docker `docker/compose.dev.yml`, site `frontend`, manager `manager@kqs.local` / `kqs123`.
- Follow `.cursor/rules` (kqs-core, security, performance, maintainability).
- Policy docs first when behavior changes: `docs/store-setup.md`, `docs/pos-feature-checklist.md` §6–8, `docs/cashier-permissions.md`.

---

## Current state (do not re-invent)

### Exists

| Feature | Path / API |
|---------|------------|
| Add Product (create) | Page `kqs_layby/page/quick_add_product/`; API `create_product_with_variants` in `api/product_setup.py` |
| Opening receive on create | `_receipt_stock()` → Stock Entry Material Receipt |
| Assign to Branch | Page `kqs_layby/page/assign_to_branch/`; API `assign_stock_to_branch` in `api/stock_transfer.py` |
| Warehouses | `utils/warehouses.py` — Central + KQS branches only |
| Categories / attributes | `list_product_category_sections`, `list_item_attributes` |
| Delete/disable | `delete_items` + Item list JS |
| Manager pages roles | System Manager, KQS Store Manager, Stock Manager |
| Catalog DocPerms | `setup/catalog_permissions.py` (Item, Item Group, Item Attribute) |
| Cashier block | `permissions/cashier_desk.py` — no Stock browsing |

### Missing (confirmed)

- No `get_product` / `update_product` / `add_variants_to_template` / `receive_stock` APIs
- No edit-product or receive-stock Desk pages
- Checklist §6: Receive goods, stock take, price update after create — unchecked / ERPNext-only
- Stock Entry create/submit for `KQS Store Manager` may rely on seed/`ignore_permissions` — **harden**

### Must-read files

1. `kqs_retail/kqs_retail/api/product_setup.py`
2. `kqs_retail/kqs_retail/kqs_layby/page/quick_add_product/quick_add_product.js`
3. `kqs_retail/kqs_retail/api/stock_transfer.py`
4. `kqs_retail/kqs_retail/kqs_layby/page/assign_to_branch/assign_to_branch.js`
5. `kqs_retail/kqs_retail/utils/warehouses.py`, `utils/items.py`, `utils/item_delete.py`
6. `kqs_retail/kqs_retail/setup/catalog_permissions.py`, `manager_permissions.py`, `cashier_permissions.py`
7. `kqs_retail/kqs_retail/setup/stock_sidebar.py`, workspace `kqs_layby/workspace/kqs_retail/`
8. `docs/store-setup.md`, `docs/pos-feature-checklist.md` §6–8, `docs/cashier-permissions.md`
9. `hooks.py` (`after_migrate`, page_js, permission queries)

---

## Feature 1 — Edit Product / Variants (P0)

### UX goals

- Manager opens **Edit Product** (new page or mode on Add Product — prefer clear UX; either `/app/edit-product` or Add Product with “Edit existing” search).
- Search/select by name, style code, barcode, or mobile-friendly list of templates (`has_variants=1` or standalone).
- Load:
  - Template: name, style/SKU (read-only after create), categories, description, images, default rate, attributes used
  - Existing variants table: SKU, attribute values (read-only), barcode, rate, image, enabled/disabled, current qty by warehouse (optional summary)
- Actions:
  - **Update** template fields (name, categories, images, description, default rate)
  - **Update** existing variant: barcode, rate, image, disable/enable (`disabled`)
  - **Add variants**: select new attribute values (only combinations that do not already exist) → create new Item variants under same template (same patterns as `create_product_with_variants` matrix)
  - Optional: receive opening qty for **new** variants only into Central
- Do **not** allow changing Size/Color on an existing sold variant SKU (immutable attributes) — add a new SKU instead.
- Do **not** require delete-to-fix.

### APIs (suggested)

```
get_product_for_edit(item_code_or_template) -> dict
update_product(template, fields...) -> dict
add_variants_to_product(template, variants_json, receive_warehouse?, ...) -> dict
update_variant(item_code, barcode?, rate?, image?, disabled?) -> dict
```

Reuse helpers from `product_setup.py` (`_ensure_item_attributes`, `_default_variant_code`, `_receipt_stock`, image/category helpers). Prefer extending that module over a parallel model.

### Scenarios

| Scenario | Expected |
|----------|----------|
| Add Size 11 to existing shoe | New variant SKU created; old variants untouched |
| Duplicate attribute combination | Reject with clear error |
| Edit rate after POS sales | Updates Item/standard_rate (and Item Price if KQS uses it — match create path) |
| Disable variant | Hidden/unavailable for new sales; history preserved |
| Template without variants → add first attributes | Either support carefully or block with message “use Add Product for new styles” — pick one and document |
| Cashier calls API | PermissionError |
| Walk-in / non-stock item | Out of scope |

---

## Feature 2 — Receive Stock (P0)

### UX goals

- New manager page e.g. `/app/receive-stock` (name consistent with KQS pages).
- Copy patterns from Assign to Branch (warehouse pickers, product search, variant qty grid).
- Flow:
  1. Target warehouse (default **Central**)
  2. Search existing products (templates expand to variants; include **zero-stock** items — unlike Assign which only shows in-stock at source)
  3. Enter receive qty (+ optional rate/valuation)
  4. Submit → Stock Entry **Material Receipt** (reuse `_receipt_stock` pattern, batch multi-item preferred)
  5. Success message: “Received. Use Assign to Branch to send to stores.”
- Link from KQS Retail workspace + Stock sidebar + optional button from Edit Product / Add Product.

### APIs (suggested)

```
search_products_for_receive(query, warehouse?) -> list  # include zero qty
get_receive_lines(item_or_template, warehouse) -> variants with on-hand
receive_stock(warehouse, items_json, company?) -> { stock_entry }
```

Use `is_kqs_store_warehouse` / `get_kqs_warehouse_names` — never allow receive into random ERPNext demo warehouses.

### Scenarios

| Scenario | Expected |
|----------|----------|
| More Nike Red Size 6 arrived | Receive into Central → Assign to Store-01 |
| Receive directly into Store-01 | Allowed if warehouse is KQS branch (manager choice) — document default = Central |
| Qty 0 / negative | Reject |
| Unknown item | Reject |
| Concurrent receive | Idempotent enough; standard SE submit |
| Valuation rate 0 | Prefer rate from Item or require > 0 like create path |
| Layby reserved stock | Receiving increases on-hand; do not touch reservations |

---

## Permissions & security (mandatory)

1. Pages: roles `System Manager`, `KQS Store Manager`, `Stock Manager` only — **not** `KQS Cashier`.
2. Extend `catalog_permissions.ensure` (or dedicated `stock_permissions.ensure`) so **KQS Store Manager** has real DocPerms for:
   - Stock Entry: read, write, create, submit (Material Receipt / Material Transfer as needed)
   - Item: already via catalog_permissions — verify write on variants
   - Warehouse, UOM, Bin, File: read as needed
3. Optionally Stock Reconciliation later (P1) — if not implemented, do not grant half UI.
4. **Stop relying on `ignore_permissions=True` for production paths** where possible; check `frappe.has_permission` / role helpers. If keep ignore_permissions for SE submit, **hard-gate** at start of every whitelist with manager-role check (same pattern as cashier guards).
5. Cashiers: no page access; API deny; Stock module stays blocked.
6. Run on migrate: `after_migrate` → ensure permissions.
7. Never commit secrets.

---

## P1 gaps — decide explicitly (implement or document)

| Gap | Recommendation |
|-----|----------------|
| Stock take / cycle count | Thin KQS UI over Stock Reconciliation **or** leave ERPNext + doc how-to |
| Supplier Purchase Receipt | Optional; Material Receipt is enough for v1 receive |
| Price list bulk update | Include in Edit Product rates for v1 |
| Low stock alerts | Out of scope unless trivial |
| Transfer qty vs sellable (layby holds) | Improve Assign to Branch to warn/use sellable qty — strongly recommended if touching stock_transfer |
| Server-side qty check on Assign | Add before submit |

Update `docs/pos-feature-checklist.md` §6 checkboxes honestly after smoke test.

---

## Production readiness checklist (agent must complete)

- [x] New/updated DocType Page JSON + JS + workspace shortcuts + stock_sidebar
- [x] All APIs `@frappe.whitelist()`, typed, validated, role-gated, errors via `_()`
- [x] Permissions ensure + migrate hook
- [x] Cashiers cannot open pages or call APIs
- [ ] Works with Central + Store-01/Store-02 from seed *(smoke on Docker)*
- [x] Variants: add new combinations without delete
- [ ] Receive then Assign to Branch end-to-end on Docker
- [ ] POS catalog shows new qty after receive+assign (hard refresh)
- [x] Docs: `store-setup.md` manager daily flow updated; checklist §6 updated
- [x] No ERPNext core patches; smallest correct diffs; copyright headers on new files
- [ ] Manual smoke as `manager@kqs.local` and verify cashier still POS-only

### P0 implementation status

**Implemented** (this handoff):

- Pages: `/app/edit-product`, `/app/receive-stock`
- APIs in `product_setup.py` + `stock_receive.py`
- `assert_stock_manager` + `stock_permissions.ensure` on migrate
- Assign uses sellable qty server-side
- P1 stock take / supplier PR / low-stock: documented ERPNext fallbacks (not built)

### Manual smoke script

1. Login manager → Edit Product → add one new size to existing seeded item → save
2. Receive Stock → qty into Central for that variant → submit
3. Assign to Branch → Central → Store-01 → qty → submit
4. Login cashier POS Store-01 → item appears with sellable qty
5. Login cashier → confirm no Edit/Receive/Assign pages
6. Try duplicate variant combo → clear error

---

## Implementation style

- Match existing Desk page patterns (Assign to Branch / Add Product).
- Prefer extending `product_setup.py` + `stock_transfer.py` (or `api/stock_receive.py` if cleaner).
- Configuration over hardcoding warehouses.
- Comments only for non-obvious business rules.
- Do not commit unless asked.

## First steps for the agent

1. Read must-read files above.
2. Propose page names + API list in a short plan.
3. Implement Edit Product APIs + UI.
4. Implement Receive Stock APIs + UI.
5. Harden permissions.
6. Update docs + smoke on Docker.

---

## How to start a new chat

1. Open a new Cursor chat in this repo.
2. Paste:

```
Implement the handoff in docs/handoff-edit-product-receive-stock.md.
Start in Plan mode first, then implement P0 (Edit Product + Receive Stock) production-ready.
```

3. Optionally attach this file as context.
