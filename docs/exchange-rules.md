# KQS Returns, Store Credit & Exchange — Business Rules

> Configure these rules before returns and store credit go live. Update this doc when policy changes.

Policy reference for layby-specific rules: [layby-rules.md](layby-rules.md)

## Overview

KQS does **not** use a separate “Exchange” document. Operational “exchange” at the till is:

1. **Return** against the original receipt (stock back, credit note)
2. **Store credit** on the customer’s account (if they shop later), or **same-visit replacement** (new sale)
3. **Redeem credit** on a later POS sale via **Store Credit** payment mode

Week-later returns are normal — credit stays on the named customer until they buy again.

---

## Standard sale returns (paid at till)

| Rule | Value |
|------|-------|
| Window | **7 days** from sale date |
| Receipt | **Required** |
| Cash / card refund | **No** — customer chooses **exchange** (replacement item) or **store credit** |
| Store credit | **Named customer** required (name + mobile). Credit redeemable on later POS sale |
| Walk-in original sale | At return, cashier **finds or creates Customer** — credit goes to **that person**, not Walk-in Customer |
| Same store | Returns accepted at the **same store** that sold the item (unless HQ policy changes) |
| Credit expiry | **12 months** from credit note date (manager may extend — note on customer) |

### Cashier decision at return

| Customer wants | Cashier action | System records |
|----------------|----------------|----------------|
| Different item now (same visit) | Return lines → new POS sale → pay net difference | Return credit note + new sales invoice |
| Shop later | Return lines → **store credit** to named account | Credit note on customer |
| Money back | **Not offered** per policy — explain exchange or store credit |

---

## Layby returns / exchanges

See also [layby-rules.md](layby-rules.md) for deposits and cancellation.

| Rule | Value |
|------|-------|
| General exchange on layby | **Not allowed** while agreement is active |
| Size exchange exception | **Same item / style, different size only** — body size may change since layby opened |
| Approval | **Manager discretion** for exceptions; document reason in Layby Agreement notes |
| Completed layby | Treated as a **normal sale** — 7-day return rules apply to the completion invoice |

---

## POS cashier steps — return against receipt

**Prerequisites:** Register open (POS Opening Entry). Cashier logged in as **KQS Cashier** (not Administrator).

### Full or partial return

1. Open **Point of Sale** (`/app/point-of-sale`).
2. Tap **Recent Orders** (or equivalent past-orders menu).
3. Find the original sale by receipt number, date, or customer.
4. Select the invoice → **Return**.
5. Adjust quantities on lines to return (partial) or leave all lines (full return).
6. **Store credit path:** tap **Return for store credit** (KQS) or proceed with return, then:
   - Enter customer **name** and **mobile** (find existing or quick-create).
   - Confirm credit is assigned to **that customer**, not Walk-in.
7. **Do not** refund cash unless HQ overrides policy.
8. Submit return — verify:
   - Credit note / return invoice created
   - Stock quantity increased in store warehouse
   - Customer credit balance increased (Desk → Customer → Credit limit / outstanding, or KQS balance banner on next sale)

### Return without receipt

- **Not at POS** in v1 — escalate to manager; manual credit note in Desk per policy.

---

## POS cashier steps — redeem store credit

1. Start new sale; add items.
2. Select **named customer** (lookup by phone). Store Credit row is disabled for Walk-in.
3. Payment screen shows **Available credit: LSL X** (if balance &gt; 0).
4. Add **Store Credit** payment row; enter amount (max = min(balance, amount due)).
5. Add Cash / Mpesa / Eco-Cash for any remainder.
6. Submit invoice — credit balance should decrease.

---

## Receipt & customer communication

| Item | Where to configure |
|------|-------------------|
| Footer text (“Exchanges within 7 days with receipt…”) | Setup → **Print Format** on Sales Invoice / POS |
| Internal policy notes | **KQS Retail Settings** (when return fields are added) |
| This document | `docs/exchange-rules.md` — source of truth for training |

---

## System behaviour (KQS + ERPNext)

| Step | ERPNext native | KQS custom |
|------|----------------|------------|
| Return against receipt | Yes — POS Recent Orders | Return-for-credit customer picker |
| Credit note / stock back | Yes | Reassign customer off Walk-in when crediting account |
| Store Credit mode of payment | Mode of Payment in Desk | Synced to all POS Profiles on migrate |
| Show balance at checkout | No | POS banner + API |
| Apply credit on submit | Partial / version-dependent | Allocation API if needed |

---

## Reporting & liability

- Open customer credits are a **liability** — monitor via credit note / customer outstanding reports.
- Returns summary: standard ERPNext credit note reports.

---

## Version

- **v1.0** — 2026-06-30 — initial rules; store credit at POS in `kqs_retail`
