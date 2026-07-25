# KQS Store & Warehouse Setup

Map each physical store to an ERPNext **Warehouse** and **POS Profile**.

## Company

| Field | Value |
|-------|-------|
| Company name | KQS FOOTWARE (or your company) |
| Abbr | KQS |
| Default currency | Set per your country |
| Country | Lesotho / South Africa (configure in ERPNext) |

## Warehouses

Create in ERPNext: **Stock → Warehouse → New**

| Store | **Warehouse Name** field | **Is Group** | Purpose |
|-------|--------------------------|--------------|---------|
| Central hub | `Central` | **No** | Opening stock from Add Product; transfer source |
| Store 1 | `Store-01` (or your store name) | **No** | Retail floor stock + POS |
| Store 2 | `Store-02` | **No** | Retail floor stock + POS |

ERPNext shows the full name as e.g. `Central - KQS` — that is automatic from company abbr.

**Do not set Parent Warehouse in the UI.** ERPNext only allows *group* warehouses as parents, but group warehouses cannot hold stock. Central must hold stock, so it cannot be a parent — the parent field will clear when you save. The demo seed used the API, not the Desk form; that was misleading in older docs.

KQS discovers branches from:

1. **Any leaf warehouse** for your company (except Central and ERPNext defaults like Finished Goods), and/or
2. **POS Profiles** linked to a store warehouse (recommended — create POS before using Assign to Branch)

**Disable** unused ERPNext demo warehouses (Finished Goods, Stores, etc.) so they do not clutter lists: open each → check **Disabled**.

## POS Profiles

| Profile | Warehouse | Price list | Mode of payment |
|---------|-----------|------------|-----------------|
| Store-01 POS | `Store-01 - KQS` | Standard Selling | Cash, Bank, Mpesa, Eco-Cash |
| Store-02 POS | `Store-02 - KQS` | Standard Selling | Cash, Bank, Mpesa, Eco-Cash |

Create in ERPNext: **Retail → POS Profile → New**

Enable: **Update Stock**, **Allow Print Before Pay** (optional)

### Thermal sale receipts (80mm)

After `bench migrate`, KQS installs thermal Print Formats in the **Columns** style (your chosen till layout), plus Classic / Hybrid for sales if you still want to compare:

| Print Format | DocType | Use |
|--------------|---------|-----|
| **KQS Receipt Columns** | POS Invoice | Default sale receipt (set on POS Profile) |
| **KQS Receipt Columns (SI)** | Sales Invoice | Layby complete / reprints |
| **KQS Layby Customer** | Layby Agreement | Customer layby copy |
| **KQS Layby Reserve** | Layby Agreement | Store hold slip |
| **KQS Account Payment** | Payment Entry | Customer account pay |

Classic / Hybrid sale formats remain available to switch on a POS Profile if needed.

These are linked automatically in **KQS Retail Settings** when those print-format fields are empty.

**Choose one on the till:**

1. **Retail → POS Profile** → open the store profile  
2. Set **Print Format** to **KQS Receipt Columns** (default when blank after migrate)  
3. Under **KQS Receipt Contact**, set this branch’s **address** (under company name), Facebook, WhatsApp, and website  
4. Save → reload `/app/point-of-sale`  
5. Complete a test sale → Print  
6. In the browser print dialog (only if QZ is not used): select the 80mm thermal, margins **None**, scale **100%**, no headers/footers  

**Layby / account pay:** formats are chosen under **KQS Retail Settings → Layby Receipts** and **Account Payment Receipts** (auto-filled to Columns-style formats on migrate).

### Silent printing (no Print click)

POS tries **QZ Tray** first, then the **browser** print window. Chrome launched with `--kiosk-printing` makes that browser fallback silent too.

**Primary — QZ Tray (recommended)**

1. On each till PC, install [QZ Tray](https://qz.io/download/) and leave it running.
2. **KQS Retail Settings → Silent Printing (Till):**
   - Keep **Enable QZ Silent Print on POS** checked
   - Set **QZ Printer Name** to the exact thermal name from Windows/macOS (or leave blank for the OS default)
3. Open POS once and allow the site when QZ asks to connect.
4. When the **Allow / Unknown signature** dialog appears, tick **Remember this decision** (or **Always allow**), then Allow — otherwise QZ asks on every receipt.
5. Complete a test sale — the receipt should print with no browser Print dialog. The KQS logo should appear at the top (QZ inlines it so the printer does not need to fetch `/assets`).

**Stop the Allow dialog permanently (optional, per till or site)**

Unsigned QZ calls show “Unknown signature”. Two options:

1. **Fast (each till):** tick **Remember this decision** once (step 4 above).
2. **Site signing (all tills):** put a QZ-trusted certificate + private key in site config, then restart:

```bash
# on the VPS / bench host — values are PEM text (keep private key secret)
bench --site pos.kqsfootwear.com set-config kqs_qz_certificate "$(cat digital-certificate.txt)"
bench --site pos.kqsfootwear.com set-config kqs_qz_private_key "$(cat private-key.pem)"
```

Generate a machine override cert from QZ Tray (**Advanced → Site Manager**) for free testing, or buy a trusted cert from [qz.io](https://qz.io) for production across many PCs. After config, hard-refresh POS; the Allow modal should stop.

Signing QZ certificates so the “Allow?” prompt never returns after first trust is optional store IT work; v1 works with Frappe’s normal QZ connect plus **Remember this decision**.

**Fallback — Chrome kiosk printing**

If QZ is not installed or not running, POS opens the normal browser print path. To avoid clicking Print:

```text
chrome.exe --kiosk-printing --app=https://YOUR-SITE/app/point-of-sale
```

(Edge: same flag if supported.) Create a desktop shortcut with that target for cashiers.

**Last resort:** allow pop-ups for the site and click Print in the dialog.

**Header:** Company name comes from **Company** in ERPNext (`doc.company`) — not hardcoded. Branch address is from the POS Profile.

**Receipt number:** Series prefix (`ACC-PSINV-` / `ACC-SINV-`) is stripped so only the numeric part prints.

**Policy & tagline (all stores):** **KQS Retail Settings → Sale Receipt Footer**

| Field | Purpose |
|-------|---------|
| Receipt Tagline | e.g. Finest footware (Classic / Hybrid) |
| Receipt Policy Title | Bold heading on the slip |
| Receipt Policy Text | Customer-facing exchange / return terms |

**Social footer (below policy):** Facebook / WhatsApp / website from POS Profile, with icons. Blank WhatsApp falls back to Receipt Phone; blank phone/website fall back to Company.

Change policy in Settings when rules change — do not edit Print Format HTML.

Switch formats anytime by changing the POS Profile field — no code change. Sales Invoice reprints use the matching `… (SI)` format when printing from Desk.

Manual reinstall (if needed):

```bash
bench --site YOUR_SITE execute kqs_retail.setup.pos_profile_fields.ensure_pos_profile_receipt_fields
bench --site YOUR_SITE execute kqs_retail.setup.receipt_print_formats.ensure_receipt_print_formats
bench --site YOUR_SITE migrate
bench --site YOUR_SITE clear-cache
```

### Payment methods (Cash, Bank, Mpesa, Eco-Cash, etc.)

KQS automatically adds these defaults to **every POS Profile** when they exist in ERPNext:

**Cash** (default at checkout), **Bank**, **Mpesa** (or **M-Pesa**), **Eco-Cash** (or **Ecocash**).

This runs on `bench migrate` and can be triggered manually (see below). Existing extra methods on a profile are not removed.

1. **Create the method** (once per company): **Accounting → Mode of Payment → New**
   - Set **Type** (Cash → Cash account; Bank/mobile money → Bank account)
   - Under **Accounts**, add a row for your company and the correct GL account
2. **Sync to all tills** (after adding a new Mode of Payment or a new POS Profile):

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.seed_kqs_demo.sync_pos_payment_methods
```

Or production: `bench --site YOUR_SITE execute kqs_retail.setup.seed_kqs_demo.sync_pos_payment_methods`

3. **Refresh POS**: reload `/app/point-of-sale` or start a new opening entry so the profile picks up the methods.

To change the company-wide default list, edit `KQS_DEFAULT_POS_PAYMENT_MODES` in `kqs_retail/setup/pos_payments.py`.

At checkout: tap a payment tile, enter the amount the customer gave on the numpad, then **Complete Order**. Amounts are never pre-filled (KQS disables ERPNext “Set Grand Total to Default Payment Method” on all POS profiles) so change is calculated from what the cashier actually enters and printed on the receipt (`change_amount`).

## Stock flow

```
Supplier / inbound → Receive Stock (Material Receipt) → Central (or store) warehouse
Central → Assign to Branch (Material Transfer) → Store-01 / Store-02
Store → POS Sale → stock reduced at store warehouse
Layby Active → qty held via Layby Agreement (sellable = on-hand − active layby lines)
```

Supplier **Purchase Receipt** remains available in ERPNext for formal PO receiving; daily “more stock arrived” for existing SKUs uses **Receive Stock**.

## Manager catalog flow (daily use)

1. **Add Product** (`/app/quick-add-product`) — name, category pills, size/color variants, prices, optional opening qty
2. **Edit Product** (`/app/edit-product`) — update name/categories/prices; add new size/colour variants without deleting
3. **Receive Stock** (`/app/receive-stock`) — inbound qty for existing SKUs (default warehouse **Central**)
4. **Assign to Branch** (`/app/assign-to-branch`) — transfer sellable stock between warehouses (Central ↔ store, or store ↔ store)

Use **Stock → Item** only for admin edge cases. Stock take / cycle count: ERPNext **Stock Reconciliation**.

## Product categories (Item Group)

Add Product shows **pill buttons** loaded from ERPNext **Item Group**. Pick a **department tab** (Women, Men, Kids, …), then a **subgroup** card (Clothing, Shoes, Accessories), then tap a **category pill**.

| Tab on page | Item Group department | Subgroups |
|-------------|----------------------|-----------|
| **Women** | `Women` | Clothing, Shoes, Accessories |
| **Men** | `Men` | Clothing, Shoes, Accessories |
| **Kids** | `Kids` | Clothing, Shoes, Accessories |
| **Home & Living** | `Home & Living` | Bedding & Sleep, Household & Plastic Products, Home Extras |
| **General Care & Extras** | `General Care & Extras` | Shoe Care, General Store Items |
| **Unisex** | `Unisex` | Single category — no subgroups (products that are not Men/Women/Kids specific) |

**To add or edit categories:** Desk → **Stock → Item Group** (tree view).

- Top-level departments (`Women`, `Men`, `Kids`, etc.) are **Group** nodes under `All Item Groups`.
- Subgroups (`Clothing`, `Shoes`, …) are **Group** nodes under their department.
- Selectable categories (e.g. `Heels & Pumps`, `Mattresses (Single, Double, Queen, King)`) are **leaf** nodes (`is_group` unchecked).
- Men / Women / Kids use department-prefixed names in ERPNext (e.g. `Women — Clothing`, `Men — Sneakers & Takkies`) because Item Group names must be globally unique. Add Product shows the short label (`Clothing`, `Sneakers & Takkies`) on the pills.
- New pills appear on Add Product after refresh (no code change).

**Seed the full KQS category tree:**

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.item_group_catalog.seed
```

Or as part of full demo setup:

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
```

**Reset catalog (delete all items + retail Item Groups):**

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.reset_product_catalog.reset
```

Keeps ERPNext defaults (`Products` tree). Warehouses, POS, and users are not removed.

## Clean test environment (KQS stores only)

ERPNext install may create extra demo warehouses (e.g. Finished Goods, Stores). To **disable** those and keep only KQS branches:

| Warehouse | Purpose |
|-----------|---------|
| `Central - KQS` | Hub — opening stock from Add Product |
| `Store-01 - KQS` | Store 1 floor + POS |
| `Store-02 - KQS` | Store 2 floor + POS |

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.seed_kqs_demo.cleanup_demo_stores
```

Or re-run full seed (also cleans up):

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
```

**Add Product** opening qty, **Receive Stock**, and **Assign to Branch** only use these warehouses. Other ERPNext warehouses are hidden/disabled, not deleted (safer for demo data).

## Automated setup

Run after ERPNext is running:

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
```

Or from bench directly:

```bash
bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
```

Smoke tests (sale, return, layby):

```powershell
scripts\run-smoke-test.bat
```

## Users (seeded by demo script)

| Role | Login | Password | Access |
|------|-------|----------|--------|
| Cashier | `cashier@kqs.local` | `kqs123` | POS only — `/app/point-of-sale` (see [cashier-permissions.md](cashier-permissions.md)) |
| Store manager | `manager@kqs.local` | `kqs123` | KQS Retail workspace, Add/Edit Product, Receive Stock, Assign to Branch |
| HQ admin | `Administrator` | (setup) | Full Desk — not for tills |

**Use `cashier@kqs.local` on tablets, never Administrator.**

Cashiers open **http://localhost:8080/app/point-of-sale** (bookmark on each register).

**Cashier roles, User Permissions, and adding new till permissions:** [cashier-permissions.md](cashier-permissions.md)
