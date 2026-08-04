# KQS POS — Handoff: finish POS UX + deploy readiness (new chat)

> Paste this into a **new Cursor chat** in the KQS POS repo. Do **not** push/deploy until Edit Product + Receive Stock + the POS UX items below are verified locally (Docker) or clearly fixed.

## Mission

Finish production-ready fixes so we can push to GitHub and deploy to Hostinger. Prior work is largely implemented but has known bugs and UX gaps.

### Must fix (P0)

1. **Edit Product / Receive Stock — numeric item codes**
   - Bug: style codes like `12234` become JS `int` via jQuery `.data("code")` / JSON, then Python `.strip()` crashes or load does nothing.
   - Partial fix already started in this branch:
     - `api/stock_receive.py` uses `cstr(...)`
     - `edit_product.js` / `receive_stock.js` should use `.attr("data-code")` not `.data("code")`
     - `get_product_for_edit` / `update_variant` should use `cstr`
   - Verify end-to-end: search `12` → click **Deviate Pure NITRO / 12234** → editor loads; Receive Stock select same style → qty grid loads → receive works.

2. **Outdated / resume POS Opening**
   - **Done:** open same-day till resumes after browser reload (no Create Opening dialog).
   - **Done:** previous-calendar-day opening auto-routes to POS Closing Entry submit (cashup).
   - Files: `api/pos.py` (`check_opening_entry`, `resolve_pos_opening_entry`), `public/js/point_of_sale.js`, `public/js/cashier_desk_guard.js`, `hooks.py` override.

3. **POS Closing “Not found” for unsaved forms**
   - `Submit Closing` on `new-pos-closing-entry-…` must `prepare_closing_entry` then submit (fix already started in `pos_closing_entry.js`). Verify.

4. **Default Walk-in customer on POS**
   - New cart / after complete order: auto-select configured Walk-in customer (ERPNext default or KQS setting) so cashiers don’t pick a customer every sale.
   - Still allow changing customer when needed.

5. **Add Customer button always visible**
   - In POS customer picker, long customer lists push **Add Customer** off-screen; cashiers must scroll.
   - Pin **Add Customer** (sticky footer / top of party dialog) so it’s always visible without scrolling.

### Also verify (smoke)

- Stuck opening recovery: `POS-OPE-2026-00003` style flow; `setup/recover_pos_opening.py`
- Manager **Close Session** on POS Opening Entry form (`pos_opening_entry.js`)
- Assign to Branch sellable qty check
- Edit Product: add new variant combo; duplicate combo clear error
- Receive Stock → Assign to Branch

### Deploy (only after fixes + smoke)

1. Commit + `git push origin main` to `https://github.com/TKieddo/KQS-POS-2026-ERPNext-.git`
2. On Hostinger VPS:
   ```bash
   cd /path/to/frappe-bench/apps/kqs_retail && git pull origin main
   cd /path/to/frappe-bench
   bench --site YOUR_SITE migrate
   bench build --app kqs_retail
   bench --site YOUR_SITE clear-cache
   bench restart
   ```
3. Close stuck openings if any, then hard-refresh POS.

### Constraints

- Only change `kqs_retail/` (+ docs if policy changes). Never fork ERPNext.
- Smallest correct diffs. Follow `.cursor/rules`.
- Do not commit unless asked.
- Local Docker: `docker/compose.dev.yml`, site `frontend`, `manager@kqs.local` / `kqs123`, `cashier@kqs.local` / `kqs123`.

### First steps for the agent

1. Reproduce Receive Stock + Edit Product with numeric style `12234`; finish any remaining `.data` → `.attr` / `cstr` fixes.
2. Change outdated-opening flow to auto-route to closing form.
3. Implement Walk-in default + sticky Add Customer.
4. Smoke on Docker; summarize what to push/deploy.
5. Do **not** push unless user asks.

## Paste to start

```
Implement the handoff in docs/handoff-pos-ux-edit-receive-deploy.md (or the prompt above if that file is missing).
Start in Plan mode first, then implement P0: fix Edit/Receive numeric codes, outdated POS → direct close, Walk-in default, sticky Add Customer. Do not push until smoke passes.
```
