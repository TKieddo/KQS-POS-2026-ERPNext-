# KQS POS — Handoff: December rush (CSV import + POS search + stock visibility + speed)

> Open this repo on the **other computer**, start a **new Cursor chat**, paste the prompt at the bottom.  
> Do **not** rewrite bulk-import / owner-permissions / till-join logic unless a bug is proven. Extend only.

---

## Mission (what the business needs now)

1. **Import stock from another POS system** — map their export → KQS Bulk Stock Import CSV → review → Approve & publish into the correct branch warehouse.
2. **Fix POS search** — typing a full product name often finds nothing; short style/name returns too many unrelated hits. Search must feel precise and usable at the till.
3. **Stock visibility for cashiers** — hard to tell if something still has qty. Make zero / low stock unmistakable (card treatment), without hiding sellable items by accident.
4. **Speed for December rush** — search, cart clear, and checkout feel slow. Target: catalog search usable under ~2 s on store Wi‑Fi; UI must not freeze/jank on every keystroke or clear.

---

## Stack & hard constraints (do not violate)

| Rule | Detail |
|------|--------|
| Custom app only | All code in `kqs_retail/`. **Never fork/patch ERPNext core.** |
| Till UI | ERPNext Point of Sale `/app/point-of-sale`, extended via `hooks.py` `page_js` + override of `get_items`. |
| Stock truth | Always **sellable qty** = on-hand − layby reservations (`kqs_layby.stock_reservation`), not raw Bin alone. |
| Warehouses | Stock is **per warehouse**. Publish / receive into the chosen branch only. “Unassigned” usually means wrong warehouse filter or stock only at MKG (Mokhotlong). |
| Scope | Smallest correct diffs. No drive-by refactors. No commits unless asked. |
| Deploy | Prefer local Docker smoke first; production via existing `_deploy_prod_vps.py` / VPS pull when user asks. |

Local Docker: `docker/compose.dev.yml`, site `frontend`, URL **http://localhost:8080** (not `http://frontend:8080`).  
Manager: `manager@kqs.local` / `kqs123`. Production: `https://pos.kqsfootwear.com`.

---

## What is already done (do not break)

### Bulk Stock Import (CSV + paper)
- Page: `/app/bulk-stock-import` — draft → review → **Approve & publish**.
- CSV columns: `name,style,size,color,qty,price,barcode,category` — see [`docs/bulk-stock-import.md`](bulk-stock-import.md).
- **Idempotency (deployed):** Material Receipt remarks `KQSBI|{batch}|{row}|{item}`; batch `published_skus`; commit lock; Done rows hidden; autosave cannot wipe `applied`. Same-batch republish must **not** double qty.
- Receive-into banner + publish log with Open Item / style search hints.

### Owner Desk access (Matsebiso)
- `setup/owner_users.py` — `matsebiso@kqsfootwear.com` is business owner (not Cashier).
- Stock Reconciliation granted to **KQS Store Manager** + System Manager (`setup/stock_permissions.py`).
- Migrate must **not** strip Stock Manager from owners who also had Cashier (`cashier_permissions` skips `DESK_OVERRIDE_ROLES`).

### Multi-computer till (one branch)
- **Managers/owners** can **join** an already-open Mokhotlong (etc.) till — no close required.
- **Cashiers** cannot join another user’s opening (blocked by design).
- Same login on 2 PCs resumes that user’s open till.
- Docs: [`docs/cashier-permissions.md`](cashier-permissions.md) § Managers opening Point of Sale.

### POS item API (current)
- Hook: `erpnext...get_items` → [`kqs_retail/api/pos.py`](../kqs_retail/kqs_retail/api/pos.py) `get_items`.
- Today: call ERPNext search, then attach variant attrs, then rewrite qty to sellable (may still hit Bin **per item** when ERPNext omits qty — **likely N+1 / slowness**).

---

## Workstream A — CSV from another POS system

**Goal:** Staff can take an export from the old/other system and land stock in KQS without inventing a second importer.

### Procedure (ops + light tooling if needed)
1. Export from the other system (whatever columns they have).
2. Map into KQS template:
   ```text
   name,style,size,color,qty,price,barcode,category
   ```
3. Bulk Stock Import → Parse CSV → set **Receive into (branch)** carefully → fix Needs match → Approve & publish.
4. If stock should be at another store: **Assign to Branch** after publish (do not re-Approve to “move”).

### Agent tasks
- Document a short mapping cheat-sheet in `docs/bulk-stock-import.md` (other-system → KQS columns). If they provide a sample CSV, add a **one-shot converter script** under `scripts/` (stdlib only) that writes KQS CSV — do not build a second UI.
- Reuse existing publish path; do **not** bypass idempotency.

---

## Workstream B — POS search quality (broken / hard)

**Symptoms**
- Full product name → few/no results.
- Short style/name → too many hits; hard to pick the right one.
- Paper names like “Spiderman” may never be on Item (e.g. style `RT7476` named only “T-Shirt … Purple”) — search cannot invent missing text.

**Chosen approach (implement this)**
1. **Keep** ERPNext `get_items` as the base fetch (hook stays).
2. **Improve ranking in `kqs_retail.api.pos.get_items` (or thin wrapper):**
   - Tokenize search (`spiderman purple` → AND-ish preference: all tokens preferred).
   - Score: exact item_code / style prefix ≫ item_name prefix ≫ contains; prefer variants that match size/colour tokens.
   - Sort results by score before return; keep `page_length` capped.
3. **Debounce** POS search input in `point_of_sale.js` (e.g. 200–300 ms) so every keystroke does not fire a full warehouse query.
4. **Display:** show **style/code + colour/size** on the card clearly so short-search clutter is scannable.
5. If name search still fails because catalog names omit marketing words: optional later — searchable custom field / description; do not block December on OCR fantasy names.

**Do not:** load full catalog into the browser on every keystroke; do not remove warehouse scoping.

---

## Workstream C — Quantity visibility (cashiers)

**Symptoms:** Cashiers cannot tell quickly if something is still sellable.

**Chosen approach**
1. Qty on each item card must be **sellable** (already intended) and **visually dominant**.
2. CSS states in POS item grid (`point_of_sale.js` / POS CSS extensions):
   - **qty ≤ 0:** muted/grey card + clear badge **Out of stock** (still searchable so staff know it exists elsewhere / wrong WH — do not silently hide by default).
   - **qty 1–2:** amber **Low stock** badge (optional threshold).
   - **qty ≥ 3:** normal card; qty number large/high contrast.
3. Optional POS Profile / KQS setting later: “Hide zero-qty in POS” — default **off** for December (hiding confuses “I know we have it” when stock is at another branch).

**Do not:** rely on colour alone without text badge (accessibility).

---

## Workstream D — December performance

**Targets (from project rules)**
- POS catalog API &lt; ~2 s on store Wi‑Fi.
- No unbounded lists; batch Bin/metadata; debounce search.

**Likely causes to fix first (measure, then patch)**
1. **`_apply_sellable_qty_to_pos_items`** — per-item `frappe.db.get_value(Bin…)` when qty missing → **batch Bin query** for all codes in one SQL/`get_all`.
2. **Search spam** — debounce + cancel in-flight requests where possible.
3. **Checkout / clear cart lag** — find freezes in `point_of_sale.js` (large re-renders, synchronous `frappe.call` without freeze messaging, offline cache rebuild). Prefer: keep UI responsive; freeze only true network waits; avoid reloading full item list on clear.
4. Do not “optimize” unrelated Desk pages.

**Verify:** browser Network tab on `get_items` duration; count SQL if needed via bench logging.

---

## Suggested implementation order

1. Batch sellable qty in `api/pos.py` (quick win for speed + correct qty).  
2. Debounce + better ranking/display for search.  
3. Out-of-stock / low-stock card CSS + badges.  
4. CSV mapping doc (+ converter if sample provided).  
5. Smoke on Docker: login → search full name + style → see qty states → add → clear cart → checkout.  
6. Deploy only when user asks.

---

## Key files

| Area | Path |
|------|------|
| POS get_items override | `kqs_retail/kqs_retail/api/pos.py` |
| POS JS UX | `kqs_retail/kqs_retail/public/js/point_of_sale.js` |
| Hooks override | `kqs_retail/kqs_retail/hooks.py` (`get_items`) |
| Sellable / reservations | `kqs_retail/kqs_retail/kqs_layby/stock_reservation.py` |
| Bulk import | `kqs_retail/kqs_retail/api/bulk_import.py`, page `.../bulk_stock_import/` |
| Import docs | `docs/bulk-stock-import.md` |
| Owner / perms | `setup/owner_users.py`, `stock_permissions.py`, `cashier_permissions.py` |
| Rules | `.cursor/rules/kqs-*.mdc`, `coding-*.mdc` |

---

## Test plan (before deploy)

- [ ] Search style `RT7476` → purple size variants appear with correct Mokhotlong sellable qty.  
- [ ] Search multi-word name tokens that exist on item_name → ranked results, not empty.  
- [ ] Short query still limited/ranked (best matches first).  
- [ ] Zero sellable → Out of stock badge / muted card; low qty → Low stock.  
- [ ] Clear cart + checkout under rush: no multi-second blank UI.  
- [ ] Bulk CSV sample → draft → publish once → Approve again → qty **not** doubled.  
- [ ] Manager joins open Mokhotlong till from 2nd PC still works.

---

## Paste into new Cursor chat (other computer)

```
Read and implement docs/handoff-december-pos-search-import.md.

Context: KQS POS is ERPNext + kqs_retail only (never fork ERPNext). Production is pos.kqsfootwear.com. Prior work already shipped: bulk-import idempotency (KQSBI receipts), Matsebiso owner Desk roles, manager multi-PC till join, sellable qty on POS items.

December priorities (in order):
1) Fix POS speed — batch Bin/sellable qty in kqs_retail.api.pos.get_items; debounce search; stop UI freezes on clear/checkout where cheap.
2) Fix POS search ranking/precision (full name + style; too many junk hits on short queries).
3) Clear out-of-stock / low-stock card visuals for cashiers (badge + muted card; don’t hide zero by default).
4) Help import from another POS: document CSV column mapping to name,style,size,color,qty,price,barcode,category; optional scripts/ converter if I provide a sample export — use existing Bulk Stock Import, do not double-receive.

Constraints: smallest diffs; don’t break bulk-import idempotency, owner_users, or till-join; stock always sellable qty; commit/deploy only when I ask. Start by inspecting get_items + POS search call path, then Plan briefly and implement.
```
