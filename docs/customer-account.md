# KQS Customer Account — Business Rules

> Defines how customer balances work at KQS stores. Update this doc when policy changes, then code.

## Three balance types (do not mix them up)

| Type | Meaning | Who owes whom | Where tracked |
|------|---------|---------------|---------------|
| **AR / Amount owed** | Unpaid on-account / credit sales | Customer owes **store** | Sum of open invoice `outstanding_amount` (+ On Account rows if legacy) |
| **Store credit** | Unspent return credits | Store owes **customer** | Return credit notes (Sales/POS Invoice, `is_return`) |
| **Layby balance** | Installments before pickup | Customer owes **store** (layby terms) | **Layby Agreement** (`balance_amount`) — not AR until completed |

Cashiers see all three on the **POS account banner** when a named customer is selected. Managers see the same numbers on **Selling → Customer** dashboard.

**Owes never goes negative** and is **not reduced by store credit.** Return credits belong under **Credit** only. **On Account** at checkout **adds** to Owes (the unpaid portion of that sale). Paying old debt later uses **Payment Entry (Receive)** in Desk or cash on a future sale — not the On Account tile.

## Store credit

- Policy: [exchange-rules.md](exchange-rules.md)
- Only **named customers** — never Walk-in Customer
- Balance = sum of unallocated return credit notes
- Redeemed at POS via **Store Credit** mode of payment

## Layby

- Policy: [layby-rules.md](layby-rules.md)
- Separate from AR and store credit until layby **completes** (then Sales Invoice is created)
- Open laybys visible on Customer dashboard and POS banner

## Sell on account (loyal customers, pay later)

Loyal customers may take goods now and pay the remainder later. This posts **Accounts Receivable** (same as ERPNext credit sales).

### Eligibility

| Rule | Value |
|------|-------|
| Customer | Named customer only — **not** Walk-in |
| **Allow account sales** | Manager must enable **Allow Account Sales** on Customer form |
| **Credit limit** | Manager sets **Credit Limit** per company on Customer form |
| Headroom | `AR outstanding + this sale unpaid amount` must not exceed credit limit |

### At POS

1. Select eligible customer → banner shows current **Owes** (AR) and **Credit available** (limit minus AR).
2. Add items → checkout → enter amounts on payment tiles: **Cash** / **M-Pesa** / **Store Credit** as needed.
3. For the debt portion, enter an amount on the **On Account** payment tile (not automatic from leftover cash).
4. **Complete order** when payments cover the sale. Cash/card/mobile may exceed the total (change is calculated and printed on the receipt). With **On Account**, rows must still match the sale (no change mixed with debt).
5. Customer pays later via **Customer Account** (POS menu) or **Payment Entry (Receive)** in Desk.

### Manager setup

1. **Selling → Customer** → open customer
2. Enable **Allow Account Sales** (KQS field)
3. Add row in **Credit Limit** table: Company + limit amount
4. Save

### Blocks

- Walk-in Customer
- Allow Account Sales not checked
- No credit limit row for company
- Sale would exceed credit limit (cashier must collect more or manager raises limit)

## Collecting what customers owe

| Method | Where |
|--------|-------|
| **Customer Account** | **POS menu** — search customer, view history & balances, Cash / M-Pesa / Eco-Cash, Record Payment |
| Payment Entry (Receive) | Desk → Accounts → Payment Entry (managers / back office) |
| Accounts Receivable report | Desk → Accounts → Accounts Receivable |

Cashiers collect outstanding balances at the till via **Customer Account**. Each collection posts a standard **Payment Entry (Receive)** allocated to open invoices (oldest first). The same Payment Entry appears in Desk — no duplicate records.

**Not automatic at checkout:** completing a new POS sale does **not** auto-clear old invoices. The **On Account** tile only defers part of **this** sale. Paying previous debt requires **Customer Account** or a Desk Payment Entry.

**Store credit cannot reduce Owes** — return credits apply only via the Store Credit payment tile on new sales.

## Reporting

| Report | Purpose |
|--------|---------|
| **Accounts Receivable** (ERPNext) | Invoice-level outstanding |
| **Customer Account Summary** (KQS) | Per customer: AR, store credit, layby balance |
| **Layby Agreement** list | Open laybys filter by customer |

## Access by role

| Role | POS banner | Customer form | Reports |
|------|------------|---------------|---------|
| KQS Cashier | Yes | No (Desk guard) | No |
| KQS Store Manager | Yes | Yes | KQS Retail workspace |
| System Manager / Accounts | Yes | Yes | All |

## Version

- **v1.0** — 2026-07-01 — customer account summary API, Desk dashboard, POS banner, sell-on-account at POS
