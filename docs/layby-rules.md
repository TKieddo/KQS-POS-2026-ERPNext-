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

## Completion

1. Final payment recorded on **Layby Payment**
2. Balance must be **zero**
3. System creates **Sales Invoice** (POS) linked to agreement
4. Stock reservation **released**; invoice consumes stock
5. Customer receives goods / receipt

## POS behaviour

- **New layby**: cashier selects items → customer → deposit payment → print agreement
- **Installment**: lookup by phone / agreement ID / customer name → record payment
- **Complete**: auto when balance = 0, or cashier taps **Complete**
- **Exchange on layby item**: cancel line + add new line (manager PIN in v2)

## Reporting

- Open laybys by store
- Deposits held (liability)
- Forfeited laybys
- Aging (overdue installments)

## Version

- **v1.0** — 2026-06-26 — initial rules for `kqs_retail` implementation
