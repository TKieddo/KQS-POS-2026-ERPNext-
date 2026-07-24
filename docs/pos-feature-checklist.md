# KQS POS — Feature Checklist

Standard point-of-sale capabilities for KQS apparel/footwear stores.  
Tick items as you complete them: change `[ ]` to `[x]`.

**Last updated:** 2026-07-06

---

## How to use

| Mark | Meaning |
|------|---------|
| `[ ]` | Not done yet |
| `[x]` | Done and verified in your store |
| *(ERPNext)* | Built into ERPNext — configure in Desk, no custom code |
| *(KQS)* | Custom work in `kqs_retail` |
| *(Configure)* | Exists — you still need setup, design, or testing |

**Main till URL:** `/app/point-of-sale`  
**Manager workspace:** KQS Retail (`/app/layby-agreement` workspace)

---

## 1. Register & daily operations

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Cashier login (dedicated account, not Administrator) | *(KQS)* Cashier → lands on POS |
| [ ] | Open register / opening float | *(ERPNext)* POS Opening Entry |
| [ ] | Close register / cash up | *(ERPNext)* POS Closing Entry |
| [ ] | Count cash vs system totals | *(ERPNext)* Closing entry reconciliation |
| [ ] | Multiple payment methods (Cash, Bank, Mpesa, Eco-Cash, Store Credit) | *(KQS)* Synced on migrate |
| [ ] | Split payment (e.g. part cash, part mobile money) | *(KQS)* Cashier enters each amount |
| [ ] | Change / balance calculation from tendered amount | *(KQS)* No auto-fill on payment rows |
| [ ] | Hold / park sale | *(ERPNext)* Draft invoice |
| [ ] | Void line or void sale | *(ERPNext)* Permissions + cancel draft |
| [ ] | Manager override (discount, price change) | *(ERPNext)* Role permissions |
| [ ] | Audit trail (who sold what, when) | *(ERPNext)* User on each invoice |

---

## 2. Sales at the till

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Product search | *(ERPNext)* POS item grid |
| [ ] | Barcode scan | *(ERPNext)* USB scanner + item barcodes |
| [ ] | Size / colour variants on screen | *(KQS)* Attribute badges on POS |
| [ ] | Change quantity | *(ERPNext)* |
| [ ] | Line discount | *(ERPNext)* |
| [ ] | Order discount | *(ERPNext)* |
| [ ] | Price override | *(ERPNext)* Role permission |
| [ ] | Tax on sale | *(ERPNext)* Company / item tax setup |
| [ ] | Rounded totals | *(ERPNext)* Company setting |
| [ ] | Walk-in customer (no account needed) | *(KQS)* Seeded customer |
| [ ] | Named customer on sale | *(ERPNext)* Customer field on POS |
| [ ] | Customer lookup or quick create | *(ERPNext)* |
| [ ] | Stock quantity visible at till | *(ERPNext)* On-hand qty |
| [ ] | Sellable qty (minus layby holds) | *(KQS)* API exists; POS uses on-hand today |
| [ ] | Out-of-stock warning | *(ERPNext)* |
| [ ] | Sale reduces store stock | *(ERPNext)* POS Profile → Update Stock |

---

## 3. Returns, refunds & exchanges

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Return against original receipt | *(ERPNext)* POS → past orders → Return — see [exchange-rules.md](exchange-rules.md) |
| [ ] | Partial return (some items only) | *(ERPNext)* |
| [ ] | Refund to original payment method | *(ERPNext)* Credit note — policy: exchange or store credit only |
| [ ] | Store credit / account balance at POS | *(KQS)* Store Credit MOP + balance banner + allocation |
| [ ] | Return for store credit (named customer) | *(KQS)* **Return** on receipt → Customer Link (select or create) |
| [ ] | Exchange (return + new sale linked) | Deferred — use return + credit + later sale |
| [ ] | Return without receipt (policy) | Desk only — see [exchange-rules.md](exchange-rules.md) |

---

## 3b. Customer account (amount owed)

| Done | Feature | Notes |
|:----:|---------|-------|
| [x] | **Customer Account** at till | *(KQS)* POS menu — search customers, balances, history, collect Cash / M-Pesa / Eco-Cash; posts Payment Entry (Receive) |
| [ ] | Sell on account at checkout | *(KQS)* On Account payment tile + credit limit — see [customer-account.md](customer-account.md) |
| [ ] | POS account banner (Owes / Credit / Layby) | *(KQS)* Named customer selected |

Policy reference: [customer-account.md](customer-account.md)

---

## 4. Layby / layaway

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Open layby from till | *(KQS)* Layby button on cart |
| [ ] | Minimum deposit rule (e.g. 20%) | *(KQS)* KQS Retail Settings |
| [ ] | Stock reserved while layby active | *(KQS)* Stock Reservation Entry |
| [x] | Installment payments at till | *(KQS)* Layby Lookup & Pay full-screen hub (POS menu) |
| [x] | Search layby (name, agreement number) | *(KQS)* Left panel in Layby hub |
| [x] | Auto-complete when fully paid | *(KQS)* Creates Sales Invoice |
| [x] | Cancel layby from till | *(KQS)* Layby hub → dedicated Cancel screen |
| [x] | Refund on cancel (7-day / 50% policy) | *(KQS)* Payment Entry Pay from till |
| [x] | Change items on active layby | *(KQS)* Layby hub → dedicated Change item flow |
| [x] | Overdue / forfeit handling | *(KQS)* Layby hub Forfeit screen + Overdue report |

Policy reference: [layby-rules.md](layby-rules.md)

---

## 5. Receipts & printing

| Done | Feature | Notes |
|:----:|---------|-------|
| [x] | Sale receipt — print | *(KQS)* Three formats: Classic / Columns / Hybrid — set on POS Profile |
| [ ] | Sale receipt — email | *(ERPNext)* After checkout |
| [ ] | Reprint past receipt | *(ERPNext)* POS past orders |
| [x] | Custom layout (logo, footer, terms) | *(KQS)* Thermal formats; policy in KQS Retail Settings; address on POS Profile |
| [ ] | Letter head / company logo | *(Configure)* Setup → Letter Head (not used on thermal formats) |
| [x] | Thermal paper width (e.g. 80mm) | *(KQS)* 72mm printable CSS in receipt formats |
| [ ] | Direct thermal print (QZ Tray, no preview) | *(ERPNext)* Optional |
| [ ] | Cash drawer open on sale | *(ERPNext)* Optional via QZ / printer |
| [ ] | Layby — customer receipt | *(Configure)* Format + KQS Retail Settings |
| [ ] | Layby — store / reserve slip | *(Configure)* Format + KQS Retail Settings |
| [ ] | Layby — completion receipt | *(Configure)* Sales Invoice format + Settings |
| [ ] | Auto-print layby receipts at till | *(KQS)* After create / pay / complete |

**Where to configure:** Retail → POS Profile (sale receipt) · Setup → Print Format · KQS Retail Settings → Layby Receipts · see [store-setup.md](store-setup.md#thermal-sale-receipts-80mm)
---

## 6. Inventory & catalog (manager)

| Done | Feature | Notes |
|:----:|---------|-------|
| [x] | Add product with variants | *(KQS)* `/app/quick-add-product` |
| [x] | Edit product / add variants | *(KQS)* `/app/edit-product` |
| [x] | Product categories (Women, Men, Kids, etc.) | *(KQS)* Item Group seed + pills on Add/Edit Product |
| [x] | Product images | *(KQS)* Add / Edit Product |
| [x] | Set and update prices | *(KQS)* Add Product + Edit Product (`standard_rate`) |
| [x] | Opening stock on new product | *(KQS)* Add Product |
| [x] | Receive stock for existing SKUs | *(KQS)* `/app/receive-stock` → Material Receipt (default Central) |
| [x] | Transfer stock between branches | *(KQS)* `/app/assign-to-branch` (sellable qty) |
| [x] | Central warehouse → store transfer | *(KQS)* Assign to Branch |
| [ ] | Receive goods from supplier (PO) | *(ERPNext)* Purchase Receipt — optional; KQS Receive Stock covers daily inbound |
| [ ] | Stock adjustment / write-off | *(ERPNext)* Stock Reconciliation |
| [ ] | Stock count / cycle count | *(ERPNext)* Stock Reconciliation |
| [x] | Delete or disable products | *(KQS)* Item list + Edit Product disable |
| [ ] | Low stock alerts | Out of scope |

Setup reference: [store-setup.md](store-setup.md)

---

## 7. Multi-store setup

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Company and currency configured | *(ERPNext)* Setup → Company |
| [ ] | Warehouse per store | *(ERPNext)* e.g. Store-01, Store-02 |
| [ ] | POS Profile per till / store | *(ERPNext)* Retail → POS Profile |
| [ ] | Payment methods on every profile | *(KQS)* Runs on migrate |
| [ ] | Different price lists per store (if needed) | *(ERPNext)* Price List on profile |
| [ ] | New store = config only (no code change) | Design goal |

---

## 8. Staff & security

| Done | Feature | Notes |
|:----:|---------|-------|
| [x] | Cashier role — POS only | *(KQS)* `KQS Cashier` — see [cashier-permissions.md](cashier-permissions.md) |
| [x] | Manager role — catalog and stock | *(KQS)* `KQS Store Manager` — Add/Edit Product, Receive Stock, Assign to Branch |
| [ ] | HQ / admin full access | *(ERPNext)* System Manager |
| [ ] | Permissions for refund and discount | *(ERPNext)* Tune per role |
| [ ] | Manager PIN at till | Planned v2 |

---

## 9. Reports & end of day

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Daily sales total | *(ERPNext)* Sales Register |
| [ ] | Sales by payment method | *(ERPNext)* POS Closing Entry |
| [ ] | Sales by cashier | *(ERPNext)* Reports |
| [ ] | Best-selling items | *(ERPNext)* Item reports |
| [ ] | Returns summary | *(ERPNext)* Credit note reports |
| [ ] | End-of-day / Z-report print | *(ERPNext)* POS Closing Entry |
| [x] | Layby — open agreements list | *(KQS)* Layby Open Summary report |
| [x] | Layby — deposits held (liability) | *(KQS)* Layby Deposits Held report |
| [x] | Layby — overdue list | *(KQS)* Layby Overdue report |
| [x] | Layby — forfeited / cancelled | *(KQS)* Layby Forfeited Cancelled report |
| [ ] | Export to Excel | *(ERPNext)* Any list / report |

---

## 10. Hardware & go-live

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Tablet or PC browser till tested | Bookmark `/app/point-of-sale` |
| [ ] | Receipt printer tested on real paper | Try Classic / Columns / Hybrid on POS Profile; allow pop-ups if blocked |
| [ ] | Barcode scanner tested | USB scanner + barcodes on items |
| [ ] | Store Wi-Fi stable for tablets | See [deployment.md](deployment.md) |
| [ ] | Production server + daily backups | `bench --site all backup --with-files` |
| [ ] | Cashier training / standard procedures | Operational |
| [ ] | Smoke test passed | `scripts\run-smoke-test.bat` |

---

## 11. Future (optional — not v1)

| Done | Feature | Notes |
|:----:|---------|-------|
| [ ] | Gift cards / store credit | |
| [ ] | Loyalty / points | |
| [ ] | Promotions (BOGO, category % off) | Partial via ERPNext pricing rules |
| [ ] | Online shop (stock sync) | Sellable qty API ready |
| [ ] | SMS receipt or payment reminder | |
| [ ] | Integrated card terminal | |
| [ ] | Customer-facing display | |
| [ ] | Offline mode | ERPNext requires network |

---

## Recommended order (what to do next)

**Phase A — Configure and test (no new code)**  
1. Receipts & printing (section 5)  
2. Open / close register (items 2–4 in section 1)  
3. Returns test (section 3)  
4. Production users and roles (section 8)  
5. Go-live checklist (section 10)

**Phase B — Build before multi-store live** *(implemented 2026-07-06)*  
1. ~~Layby cancel + refund workflow (section 4)~~  
2. ~~Layby reports (section 9)~~  
3. ~~Overdue / forfeit manager action (section 4)~~  
4. ~~Change items on active layby (section 4)~~

**Phase C — v2 when stores are stable**  
1. Exchange linked document (section 3)  
2. Manager PIN (section 8)

---

## Related docs

| Document | Purpose |
|----------|---------|
| [layby-rules.md](layby-rules.md) | Layby business policy |
| [exchange-rules.md](exchange-rules.md) | Returns, store credit, exchange policy |
| [spike-store-credit-pos.md](spike-store-credit-pos.md) | ERPNext v16 store credit spike notes |
| [store-setup.md](store-setup.md) | Warehouses, POS profiles, payments |
| [deployment.md](deployment.md) | Staging, production, tablet checklist |
| [INSTALL.md](INSTALL.md) | Local dev setup |

---

*Tick boxes in your editor or on GitHub. Update **Last updated** when you change policy or ship new features.*
