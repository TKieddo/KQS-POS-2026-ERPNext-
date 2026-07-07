# Spike: Store Credit at POS (ERPNext v16)

**Date:** 2026-06-30  
**ERPNext:** v16.25.0  
**Site:** `frontend` (Docker dev)

## Questions tested

1. Can ERPNext POS natively apply return credit on a new sale?
2. Does return credit land on Walk-in when the original sale was Walk-in?
3. How should KQS allocate credit notes to a new invoice?

## Findings

### 1. Native POS credit application — **No**

ERPNext POS has no balance banner or credit-note allocation at checkout. `get_outstanding_reference_documents` and Payment Reconciliation support credit notes, but the POS payment screen does not call them.

**KQS approach:** Whitelisted API `get_store_credit_balance` + **Store Credit** mode of payment on POS profiles. On submit, `prepare_store_credit_before_submit` strips Store Credit payment rows (leaving cash/mobile for the remainder) and `allocate_store_credit_on_invoice_submit` runs Payment Reconciliation (`reconcile_dr_cr_note`) to link return credit notes to the new invoice.

### 2. Walk-in return customer — **Must reassign**

POS return loads the **original invoice customer**. If the sale was Walk-in, the credit note is created on Walk-in unless changed.

**KQS approach:** Menu **Return for store credit** → find/create customer (name + phone) → `set_return_credit_customer` caches customer per user session → `apply_return_credit_customer` on `before_submit` of return invoice swaps customer off Walk-in.

### 3. Credit balance source

Unallocated return credit notes appear in Payment Reconciliation `payments` rows (`get_dr_or_cr_notes`). Sum of those amounts = **available store credit**.

Programmatic test: `bench --site frontend execute kqs_retail.setup.spike_store_credit.run_spike`

## Manual POS return test (cashier)

See [exchange-rules.md](exchange-rules.md) — section **POS cashier steps — return against receipt**.

Verify as `cashier@kqs.local`:

| Step | Expected |
|------|----------|
| Recent Orders → Return (partial qty) | Credit note; stock increases |
| Recent Orders → Return (full) | Full credit note |
| Return for store credit menu + named customer | CN on named customer, not Walk-in |
| New sale + Store Credit payment | Balance decreases; invoice paid |

## Files

| Area | Path |
|------|------|
| Policy | `docs/exchange-rules.md` |
| Balance + allocation | `kqs_retail/utils/store_credit.py` |
| POS APIs | `kqs_retail/api/store_credit.py` |
| Mode of Payment setup | `kqs_retail/setup/store_credit.py` |
| POS UI | `kqs_retail/public/js/point_of_sale.js` |
