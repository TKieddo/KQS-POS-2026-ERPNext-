# KQS Layby — Business Rules

> Configure these rules before layby goes live. Update this doc when policy changes.

## Overview

Layby lets customers reserve apparel/footwear with a deposit and pay installments before taking goods home. Stock is **held** at the store warehouse while the agreement is active.

## Financial rules

| Rule | Value |
|------|-------|
| Minimum deposit | **20%** of layby total |
| Installment frequency | **Monthly** (or weekly by cashier override) |
| Maximum term | **90 days** from first deposit |
| Late payment grace | **7 days** after due date |
| Late fee | **None** (first version) |
| Currency | Company default (LSL / ZAR — set in ERPNext Company) |

## Stock rules

| Rule | Value |
|------|-------|
| Stock held at | **Same warehouse as POS Profile** (store where layby opened) |
| Reservation | On **Active** status — qty reserved via Stock Reservation Entry |
| Sellable qty | On-hand minus reserved (for POS and future website) |
| Transfer while on layby | **Not allowed** — complete or cancel layby first |
| Multi-store layby | **No** — items must be from one store warehouse |

## Status workflow

```
Draft → Active → Completed
              ↘ Cancelled
              ↘ Forfeited (terms breached after grace period)
```

| Status | Meaning |
|--------|---------|
| **Draft** | Cart saved, no deposit yet — no stock hold |
| **Active** | Deposit received — stock reserved |
| **Completed** | Balance paid — converts to Sales Invoice / customer collects |
| **Cancelled** | Customer cancels — release stock, refund per policy below |
| **Forfeited** | Terms breached — release stock, deposit handling per policy |

## Cancellation & refund

| Scenario | Deposit | Stock |
|----------|---------|-------|
| Customer cancel within 7 days of opening | **Full refund** | Released |
| Customer cancel after 7 days | **50% refund** | Released |
| Forfeited (no payment after grace) | **Forfeited (no refund)** | Released for resale |
| Store cancel (error) | **Full refund** | Released |

### Till steps — cancel (active layby)

1. **Point of Sale** → menu **⋯ → Layby Lookup & Pay** (full-screen hub — not a small popup)
2. Search and select the agreement in the left list
3. Tap **Cancel layby** — opens a dedicated screen (not stacked buttons on a popup)
4. Review paid amount, refund %, refund amount, and retained (forfeit) amount
5. Choose **Customer cancel** or **Store error (100%)** — store error is manager-only
6. Select refund method: **Customer account** (default — store credit) or **Cash / M-Pesa / Eco-Cash** (till payout when required)
7. Tap **Confirm cancel & refund** — stock hold released

Use **cancel** when the customer wants money back and is leaving. Do **not** cancel-and-reopen to swap items — use **Change item** instead.

### Till steps — amend item (active layby)

| Change type | Who | Steps |
|-------------|-----|-------|
| Size / colour (same style) | Cashier | Hub → select agreement → **Change item** → pick line → search variant |
| Full product swap | Manager | Same, tick **Full product swap** → any in-stock SKU |

Stock hold moves automatically: old SKU released, new SKU reserved. No Stock Entry until layby completes.

If the new item costs less and the customer already overpaid: **Keep on layby** (credit toward balance) or **Refund cash** (manager/cashier choice).

### Manager steps — forfeit (overdue)

1. **KQS Retail** workspace → **Layby Overdue** report (or POS Layby hub → **Forfeit layby**)
2. Enter required note — customer receives **0%** refund
3. Status → **Forfeited**, stock released for resale

Completed laybys (customer collected goods) use **Returns & Store Credit** — not these flows.

## Completion

1. Final payment recorded on **Layby Payment**
2. Balance must be **zero**
3. System creates **Sales Invoice** (POS) linked to agreement
4. Stock reservation **released**; invoice consumes stock
5. Customer receives goods / receipt

## POS behaviour

- **New layby**: cashier selects items → customer → deposit payment → print agreement
- **Installment**: lookup by phone / agreement ID / customer name → record payment
- **Complete**: auto when balance = 0
- **Cancel**: Layby Lookup hub → select agreement → **Cancel layby** (dedicated screen)
- **Change item**: Layby Lookup hub → **Change item** (dedicated screen per step)
- **Forfeit**: manager only — Layby Lookup hub → **Forfeit layby**, or Layby Overdue report
- **Completed layby returns**: **Returns & Store Credit** — see [exchange-rules.md](exchange-rules.md)

## Reporting

- **Layby Open Summary** — active agreements by store
- **Layby Deposits Held** — liability (`paid_amount` on Active)
- **Layby Overdue** — past due + grace, for forfeit review
- **Layby Forfeited Cancelled** — closed agreements with refund/forfeit amounts

## Version

- **v1.0** — 2026-06-26 — initial rules for `kqs_retail` implementation
- **v1.1** — 2026-07-06 — Phase B: till cancel/amend/forfeit + layby reports
