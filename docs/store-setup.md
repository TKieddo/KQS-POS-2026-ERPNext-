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

| Store | Warehouse name | Parent | Purpose |
|-------|----------------|--------|---------|
| Central | `Central - KQS` | — | Goods in, allocation hub |
| Store 1 | `Store-01 - KQS` | Central | Retail floor stock |
| Store 2 | `Store-02 - KQS` | Central | Retail floor stock |

Create in ERPNext: **Stock → Warehouse → New**

Branches are ERPNext warehouses — KQS UI discovers them automatically from **Stock → Warehouse** (children of **Central**, or any warehouse linked to a **POS Profile**).

## POS Profiles

| Profile | Warehouse | Price list | Mode of payment |
|---------|-----------|------------|-----------------|
| Store-01 POS | `Store-01 - KQS` | Standard Selling | Cash, Bank, Mpesa, Eco-Cash |
| Store-02 POS | `Store-02 - KQS` | Standard Selling | Cash, Bank, Mpesa, Eco-Cash |

Create in ERPNext: **Retail → POS Profile → New**

Enable: **Update Stock**, **Allow Print Before Pay** (optional)

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

At checkout: tap a payment tile, enter the amount the customer gave on the numpad, then **Complete Order**. Amounts are never pre-filled (KQS disables ERPNext “Set Grand Total to Default Payment Method” on all POS profiles) so change is calculated from what the cashier actually enters.

## Stock flow

```
Supplier → Purchase Receipt → Central warehouse
Central → Stock Entry (Material Transfer) → Store-01 / Store-02
         or KQS Assign to Branch page
Store → POS Sale → stock reduced at store warehouse
Layby Active → qty held via Layby Agreement (sellable = on-hand − active layby lines)
```

## Manager catalog flow (daily use)

1. **Add Product** (`/app/quick-add-product`) — name, category pills (Women | Men, Accessories below), size/color variants, prices
2. **Assign to Branch** (`/app/assign-to-branch`) — transfer stock between warehouses (Central ↔ store, or store ↔ store); pick product, set qty per variant if applicable

Use **Stock → Item** only for admin edge cases.

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

**Add Product** opening qty and **Assign to Branch** only use these warehouses. Other ERPNext warehouses are hidden/disabled, not deleted (safer for demo data).

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
| Store manager | `manager@kqs.local` | `kqs123` | KQS Retail workspace, Add Product, Assign to Branch |
| HQ admin | `Administrator` | (setup) | Full Desk — not for tills |

**Use `cashier@kqs.local` on tablets, never Administrator.**

Cashiers open **http://localhost:8080/app/point-of-sale** (bookmark on each register).

**Cashier roles, User Permissions, and adding new till permissions:** [cashier-permissions.md](cashier-permissions.md)
