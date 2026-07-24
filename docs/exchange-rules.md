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
| Window | **30 days** from sale date (configurable — see below) |
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
| Completed layby | Treated as a **normal sale** — 30-day return rules apply to the completion invoice |

---

## POS cashier steps — return against receipt

**Use the dedicated Returns page** — not POS checkout. Credit is added to the customer account; they spend it on a later POS sale.

**Prerequisites:** Register open (POS Opening Entry). Cashier logged in as **KQS Cashier**.

### Full or partial return (store credit)

1. Open **Point of Sale** → menu **⋯ → Returns & Store Credit** (stays on the till — no Desk sidebar).
2. Search by receipt number, customer name, or mobile — shows **this store's** paid sales from the last **30 days** (any cashier on this store's tills).
3. Select the receipt → tick items and quantities to return.
4. **Continue** → choose **Customer to credit** (search, select, or **+** create). Not Walk-in.
5. Tap **Credit customer account** — no payment screen, no cash refund.
6. Confirm success: credit note created, store credit balance shown.
7. **Later:** customer shops at **Point of Sale** → select their name → use **Store Credit** payment mode.

### Same-visit exchange (replacement item now)

1. Complete the return on **Returns & Store Credit** (steps above) **or** return all lines first.
2. Open **Point of Sale** → new sale → add replacement items.
3. Select the same customer → pay net amount (Store Credit + Cash/Mpesa as needed).

### Reprint receipt only

POS menu **⋯ → Recent Orders** — view/print past sales (no return from this screen).

### Return without receipt

- **Not at POS** in v1 — escalate to manager; manual credit note in Desk per policy.

---

## Configuring return windows (managers)

**Desk → Selling → KQS Retail Settings** (or search **KQS Retail Settings** in the Awesome Bar).

Under **Returns & Store Credit**:

| Field | Purpose | Default |
|-------|---------|---------|
| **Return Acceptance (Days)** | How old a sale can be and still be returned (7, 14, etc.) | 14 |
| **Receipt Search Window (Days)** | How far back cashiers can **find** receipts in Returns & Store Credit | 30 |

Receipts older than **Return Acceptance** appear in search (if within the search window) but are marked **Past return window** and cannot be processed.

Managers with **KQS Store Manager**, **Sales Manager**, or **System Manager** can edit these values. Cashiers see the active policy on the Returns screen chips.

---

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
| Printed exchange / return terms | **KQS Retail Settings → Sale Receipt Footer** (title + text) |
| Branch address / phone / FB / web on slip | **POS Profile → KQS Receipt Contact** (per till) |
| Internal policy notes | **KQS Retail Settings → Notes** |
| Return window (system enforcement) | **KQS Retail Settings → Return Acceptance (Days)** |
| This document | `docs/exchange-rules.md` — source of truth for training |

---

## System behaviour (KQS + ERPNext)

| Step | ERPNext native | KQS custom |
|------|----------------|------------|
| Return against receipt | Yes — POS Recent Orders | **Returns & Store Credit** page (`/app/kqs-returns`) |
| Credit note / stock back | Yes | Reassign customer off Walk-in when crediting account |
| Store Credit mode of payment | Mode of Payment in Desk | Synced to all POS Profiles on migrate |
| Show balance at checkout | No | POS banner + API |
| Apply credit on submit | Partial / version-dependent | Allocation API if needed |

Spike notes (ERPNext v16): [spike-store-credit-pos.md](spike-store-credit-pos.md)

---

## Reporting & liability

- Open customer credits are a **liability** — monitor via credit note / customer outstanding reports.
- Returns summary: standard ERPNext credit note reports.
- Customer AR, store credit, laybys: [customer-account.md](customer-account.md) and **Customer Account Summary** report.

---

## Version

- **v1.0** — 2026-06-30 — initial rules; store credit at POS in `kqs_retail`
