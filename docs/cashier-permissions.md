# KQS Cashier — Permissions & Security

How cashier access works and **where to configure it in Desk** when you add staff or new till features.

**Rule of thumb:** Cashiers use **Point of Sale only** (`/app/point-of-sale`). Managers use **KQS Retail** workspace. Policy numbers (layby %, return window) live in **KQS Retail Settings** — that is *not* the same as user permissions.

---

## Quick reference — where to go in Desk

| What you want to change | Where in Desk | Who should do it |
|-------------------------|---------------|------------------|
| Create / disable a cashier login | **Users** → open user → **Roles** | HQ admin / System Manager |
| Assign till + company scope | **Users** → **User Permissions** | HQ admin |
| Add a new DocType permission for all cashiers | **Role Permission Manager** (role: `KQS Cashier`) **or** code + migrate | Developer, then admin verifies |
| Layby %, return window, receipts | **KQS Retail Settings** (Selling sidebar or KQS Retail workspace) | Store manager |
| POS payment methods on a till | **POS Profile** | Store manager |
| Re-apply KQS cashier defaults after upgrade | `bench execute kqs_retail.setup.cashier_permissions.ensure` | Developer / ops |

**Users path:** Desk → search **User** → open `cashier@…` (or your cashier email).

**KQS Retail Settings path:** Desk → **KQS Retail** workspace → **KQS Retail Settings** shortcut, or **Selling → KQS Retail Settings**.

**Role Permission Manager path:** Desk → search **Role Permission Manager** → Role = `KQS Cashier`.

---

## Cashier user checklist (UI)

When onboarding a new cashier:

1. **User → New**
   - Email / username they will log in with
   - **Send Welcome Email** off (set password manually if needed)

2. **Roles** tab — assign **only**:
   - `KQS Cashier`
   - Do **not** add `Sales User`, `Sales Manager`, `Stock Manager`, etc. Those unlock Desk workspaces and reports.

3. **User Permissions** — production pattern (**do not** check **Apply To All Document Types**; KQS migrate unchecks it and broad scope causes POS permission errors like blocked Stock Settings):

   **Never** add User Permission on **Warehouse**.

   **POS Profile** (repeat one row per **Applicable For** doctype — same `For Value`, e.g. `Store-01 POS`):

   | Allow | For Value | Apply To All | Applicable For |
   |-------|-----------|--------------|----------------|
   | POS Profile | `Store-01 POS` | **Unchecked** | `POS Invoice` |
   | POS Profile | `Store-01 POS` | **Unchecked** | `Sales Invoice` |
   | POS Profile | `Store-01 POS` | **Unchecked** | `POS Opening Entry` |
   | POS Profile | `Store-01 POS` | **Unchecked** | `POS Closing Entry` |

   **Company** (optional but recommended when using layby / account payments — one row per doctype):

   | Allow | For Value | Apply To All | Applicable For |
   |-------|-----------|--------------|----------------|
   | Company | Your company (e.g. `KQS FOOTWARE`) | **Unchecked** | `Payment Entry` |
   | Company | Your company | **Unchecked** | `Layby Agreement` |
   | Company | Your company | **Unchecked** | `Layby Payment` |

   POS Profile permissions scope past orders and closing to that till. Company permissions scope AR collection and layby. Checkout **role** permissions (`KQS Cashier` DocPerms) are separate — run `cashier_permissions.ensure` after deploy/migrate.

   **Desk path:** search **User Permission** → **New** (easier than the User form child table).

4. **Home Page** = `point-of-sale` (set automatically when you run `cashier_permissions.ensure` or demo seed).

5. **Block Modules** — applied automatically on migrate for all `KQS Cashier` users (Selling, Stock, Accounts, KQS Layby, etc.). You normally **do not** edit this by hand.

6. Bookmark on the tablet: `https://your-site/app/point-of-sale`

---

## What KQS enforces automatically

On every `bench migrate`, `kqs_retail.setup.cashier_permissions.ensure` runs and:

- Sets **Custom DocPerm** rows for role `KQS Cashier` (Sales Invoice, Customer, Layby, POS Closing, etc.)
- Strips forbidden extra roles (`Sales User`, `Sales Manager`, …) from users who have `KQS Cashier`
- Applies **Block Modules** so Desk sidebars stay hidden
- Sets **home page** to Point of Sale

**Server-side** (not visible in UI, defined in code):

- Cashiers cannot run Desk **reports** or open **workspace** pages via API
- Desk **list** views for Items, Stock Entries, etc. are empty for cashiers
- Sales / POS invoices in lists are filtered to their POS Profile (when User Permission is set)
- App launcher: cashiers see **Point of Sale** only, not **KQS Retail**

**Client-side backup:** `cashier_desk_guard.js` redirects any non-POS route back to the till.

---

## Adding a new permission for cashiers in the future

### A. New till feature that uses an existing DocType (e.g. new payment flow on Sales Invoice)

Usually **no UI change** — existing `KQS Cashier` perms on `Sales Invoice` / `Payment Entry` already cover it. Test as `cashier@…` on POS.

### B. New DocType cashiers must read/write from POS

1. **Developer:** add the DocType + role row in `kqs_retail/setup/cashier_permissions.py` (`_CASHIER_PERMS` list).
2. Run:
   ```bash
   bench --site YOUR_SITE execute kqs_retail.setup.cashier_permissions.ensure
   ```
   Or `bench migrate` (runs `ensure` via `after_migrate` hook).
3. **Admin:** optional check in **Role Permission Manager** → `KQS Cashier` → confirm the new DocType row exists.

Prefer **whitelisted APIs** in `kqs_retail/api/` (like returns and layby) so business rules stay server-side; keep DocPerms as small as possible.

### C. Let cashiers open a new Desk page (discouraged)

Only if you truly need Desk (not POS):

1. Add Page role in the Page doc (Developer / Customize Form).
2. Add route to `boot.py` → `kqs_cashier_allowed_routes` (code change).
3. Document the exception here.

Default policy: **new cashier features belong in POS**, not Desk.

### D. Manager-only feature

Use role `KQS Store Manager` in `kqs_retail/setup/manager_permissions.py` — **not** `KQS Cashier`.

Managers opening **ERPNext Settings** need read on settings singles (e.g. Global Defaults). KQS adds these on migrate via `manager_permissions.ensure`. HQ admins use **System Manager** for full Setup access.

---

## ERPNext Settings — “Page global-defaults not found”

ERPNext routes **ERPNext Settings → Global Defaults** to `/desk/global-defaults`. Frappe only registers that slug for doctypes in `boot.user.can_read`. **Global Defaults** is a `read_only` single, so users with **read-only** DocPerm are excluded from `can_read` and the desk router looks for a missing Page instead.

Run:

```bash
bench --site YOUR_SITE execute kqs_retail.setup.manager_permissions.ensure
```

Then **log out and log back in** (boot cache). The fix grants **write** on Global Defaults to **System Manager** (Administrator) and **KQS Store Manager**. Cashiers are unaffected.

---

## Close register (cash up)

Cashiers use the standard **POS Closing Entry** Desk form (full cash-up screen) when closing the till. The **Desk sidebar stays hidden** on that page — they cannot browse Selling, Stock, or other modules from there. After submit, they return to Point of Sale.

Allowed cashier routes: `/app/point-of-sale` and `/app/pos-closing-entry/...` only.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Cashier sees KQS Retail app / Selling sidebar | Extra role (`Sales User`, etc.) | User → Roles → remove extras; run `cashier_permissions.ensure` |
| Cashier can open Stock / reports | Same as above, or logged in as manager | Check roles; hard-refresh browser |
| POS checkout permission error | Missing DocPerm on a DocType | Run `cashier_permissions.ensure`; check Role Permission Manager |
| Cashier sees another store’s invoices in Desk | Missing User Permission on POS Profile | User → User Permissions → POS Profile |
| After app update, old POS behaviour | Stale JS cache | Hard refresh; guard busts POS page cache on version bump |

**Re-apply all cashier defaults:**

```bash
bench --site YOUR_SITE execute kqs_retail.setup.cashier_permissions.ensure
```

**Demo seed** (dev Docker):

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
```

---

## Related docs

- [store-setup.md](store-setup.md) — warehouses, POS profiles, demo users
- [layby-rules.md](layby-rules.md) — layby policy (KQS Retail Settings)
- [pos-feature-checklist.md](pos-feature-checklist.md) — feature status
