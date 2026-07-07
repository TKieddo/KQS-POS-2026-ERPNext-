# KQS Retail — Frappe app for ERPNext

Layby agreements, stock reservation, and retail APIs for KQS POS.

## Install

```bash
bench get-app /path/to/kqs_retail
bench --site [site] install-app kqs_retail
bench --site [site] set-config developer_mode 1
```

## DocTypes

- **Layby Agreement** — customer layby with deposit and installments
- **Layby Payment** — partial payments against an agreement
- **Layby Item** — child table line items

## API

Whitelisted methods in `kqs_retail.api`:

- `get_sellable_stock(item_code, warehouse)`
- `create_layby_from_cart(...)`
- `record_layby_payment(...)`
- `search_layby_agreements(...)` — optional `customer` filter
- `get_customer_account_summary(customer, company)` — AR, store credit, laybys
- `validate_account_sale(customer, grand_total, paid_amount)` — POS sell-on-account check
