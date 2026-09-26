# KQS retail — feature scenario contracts

> Every customized feature must list happy paths, money/stock effects, permissions, and failure modes **before** shipping. Fix rows marked Gap/Bug; add rows when adding features. Companion to [layby-rules.md](layby-rules.md), [store-setup.md](store-setup.md), [cashier-permissions.md](cashier-permissions.md).

**Status:** OK = intended & implemented · Gap = missing · Bug = wrong behaviour

---

## 1. Catalog lifecycle (Add / Edit / Delete / Re-add)

| Scenario | Intended | Status |
|----------|----------|--------|
| Add product + opening qty | New Item(s); Material Receipt at chosen WH | OK |
| Re-add same style after catalog delete | New Item; **empty** stock; new receipts only | OK |
| Re-add while Item still exists | Block “already exists” | OK |
| Edit name / price / barcode / image / categories | Allowed | OK |
| Edit style number | Immutable after create | OK |
| Add new size/colour | New variant SKU | OK |
| Disable variant | Hidden from POS; history kept | OK |
| Delete from catalog | Zero **all** WH → hard delete or archive `DEL-…` | OK |
| Delete with active layby | **Blocked** until complete/cancel | OK |
| Remove stock from one branch only | Discard sellable at that WH (default) or transfer to Central; per-variant; confirm; Item remains | OK |
| Archive resurfaces on POS | Must not — lists filter `disabled=0` | OK |

---

## 2. Assign to Branch

| Scenario | Intended | Status |
|----------|----------|--------|
| Multi-select + type qtys + click row | Selection & qtys preserved | OK |
| Product Link filter | Add/focus; do not clear others | OK |
| Change source with draft lines | Confirm, then clear | OK |
| Transfer > sellable (layby hold) | Server rejects | OK |
| Stale async reload | Ignore older responses | OK |

---

## 3. Layby + cashup

| Scenario | Intended | Status |
|----------|----------|--------|
| Deposit day | Expected += that day's Layby Payment(s) | OK |
| Installment (not complete) | Expected += installment only | OK |
| Final / complete | Expected += **that day's** payment only; completion SI uses **Layby Settlement** (not Cash) | OK |
| Same-day full pay | Expected += LP sum; SI not till cash | OK |
| Prior deposits on later days | Not in later cashup | OK |
| Cancel till refund same day | Expected − refund PE | OK |
| Historical Cash completion SIs | Excluded via `sales_invoice` link + till rewrite | OK |

---

## 4. POS sell

| Scenario | Intended | Status |
|----------|----------|--------|
| Displayed qty | Sellable (on-hand − layby holds) | OK |
| Sell more than sellable | ERPNext / stock validation | OK (rely on stock) |
| Offline multi-till same SKU | Risk of double-sell | Gap — ops + lease telemetry; see offline-local-cache.md |

---

## 5. Returns / store credit / On Account

| Scenario | Intended | Status |
|----------|----------|--------|
| Return → store credit | Credit note; not cash refund | OK (policy) |
| Redeem store credit | Non-cash MoP; excluded from cashup tender | OK |
| On Account sale | Debt on invoice; collect via Payment Entry | OK |
| Account collect in session | Expected += PE in window | OK |

---

## 6. Permissions

| Scenario | Intended | Status |
|----------|----------|--------|
| Cashier desk | POS (+ allowed routes) only | OK |
| Catalog / Assign / Receive | Stock manager | OK |
| Manager PIN for overrides | v2 — not built | Gap (documented) |

---

## How to use this doc

1. Before coding a feature: add scenario rows (happy + failure + money/stock).
2. Before merge: every new row is OK or explicitly deferred with owner/date.
3. When a store reports a bug: find the row (or add it), fix code, set OK.
