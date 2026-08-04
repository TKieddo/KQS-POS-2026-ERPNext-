# Offline / local-cache (single till, short outages)

> Shipped for **short outages** (minutes to a few hours). **Multiple tills** may cache and sell offline for the same store.
> Online detection waits for **3 failed pings** (~45s apart) before flipping to offline — brief Wi‑Fi blips stay online.
> Stock can briefly double-sell if two tills are offline at once — sync ASAP when the network returns.
> Card (Speedpoint) and M-Pesa are **record-only** modes of payment — devices stay standalone.

## What works offline

| Flow | Behaviour |
|------|-----------|
| Catalog / search / barcode | **IndexedDB** when offline (or when online `get_items` fails) |
| Walk-in / named sales | Queued in outbox → Sales Invoice on sync (POS Profile accounts/taxes applied) |
| Layby list / detail | From cache; create/pay/cancel/forfeit/amend queued |
| Returns list / open receipt | From cached receipts **with line items** (pulled while online); submit queued |
| AR collect | Queued; server revalidates on sync |
| Closing | **Blocked** until outbox empty; tap banner → **Retry sync** dialog |

Orange banner shows Online / Offline and pending count. **Tap the banner** to open the sync queue / retry UI.

## Ops rules (cashiers)

1. Open the till **while online** at least once so the catalog, laybys, and receipts refresh.
2. Any till may work offline; prefer reconnecting soon so stock stays accurate across tablets.
3. Take Card on Speedpoint / M-Pesa on the phone as usual; enter the same amounts (and optional reference) on the till.
4. When the network returns, wait until pending clears (or tap banner → Retry) before cash-up.
5. Do not return an `OFFLINE-…` sale until it has synced to a real invoice number.

## Architecture

```
Tablet IndexedDB (catalog, laybys, receipts+lines, outbox)
        │ pull / push
        ▼
kqs_retail.offline.api  →  Sales Invoice / Layby / PE / returns
Warehouse Offline Lease  →  last-till telemetry (does not block)
Offline Sync Log         →  client_uuid idempotency (+ retry clears Failed)
```

### Server APIs

| Method | Role |
|--------|------|
| `kqs_retail.offline.api.ping_offline` | Reachability |
| `kqs_retail.offline.api.pull_offline_bundle` | Catalog + laybys + receipts (with lines) + MOPs |
| `kqs_retail.offline.api.push_offline_event` | Idempotent outbox apply |
| `kqs_retail.offline.api.retry_failed_offline_events` | Clear Failed logs so UUID can re-push |
| `kqs_retail.offline.api.acquire_offline_lease` | Exclusive short lease |
| `kqs_retail.offline.api.release_offline_lease` | Release lease |

### Client files

`kqs_retail/public/js/offline/` — `db.js`, `network.js`, `stock_local.js`, `catalog.js`, `sync_pull.js`, `sync_push.js`, `sync_ui.js`, `bridge.js`, `sw_register.js`  
Service worker: `public/js/kqs_offline_sw.js` (caches `/assets/kqs_retail/` assets only — not full Desk shell).

## Smoke test (manual)

1. Open POS online → offline cache refresh waits ~2.5s then runs in the background (UI stays usable; skips re-pull if cache is under 30 minutes old).
2. DevTools → Network → Offline.
3. Search catalog / add item from cache → sell Cash + Card.
4. Open Layby hub → see cached laybys → create/pay if needed.
5. Open Returns → pick a **synced** receipt from cache → queue return.
6. Go online → banner syncs (or tap → Retry) → check **Offline Sync Log**.
7. With a failed event, try Close → blocked → Retry → then close.

## Remaining limits (honest)

- Multi-till offline is allowed; not multi-day offline (stock risk rises with longer outages)
- Hard refresh of Desk `/app/point-of-sale` mid-outage may fail (SW is assets-only)
- Offline SI is custom create (hardened with POS Profile defaults) — still verify tax/rounding on your site
- Returns need receipt lines from last online pull; brand-new unsynced `OFFLINE-` sales cannot be returned yet
- Must run `bench migrate` + hard refresh after deploy

## Deploy notes

```bash
bench --site <site> migrate
bench clear-cache
```

Then hard-refresh POS tablets (`Ctrl+Shift+R`).
