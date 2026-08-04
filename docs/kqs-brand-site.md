# KQS brand site (`kqs-web`)

Public artistic teaser for **KQS FOOTWARE** — youthful streetwear and sneakers, Lesotho. Separate from the Frappe POS app.

## Why separate

Motion, typography, and art direction need a freer stack than ERPNext Website. POS stays in `kqs_retail`; the brand site lives in [`kqs-web/`](../kqs-web/).

## Deploy

See [`kqs-web/README.md`](../kqs-web/README.md).

Quick path (first time will open a browser login):

```bash
cd kqs-web
npx vercel login
npx vercel --prod
```

You get a `*.vercel.app` HTTPS URL immediately — use it for API / platform signups until DNS is ready.

**Domain `kqsfootwear`:** Vercel → Project → **Settings → Domains** → add your full host (e.g. `kqsfootwear.com` or `www.kqsfootwear.com`). Copy the `A` / `CNAME` records Vercel shows into your DNS panel. Wait for SSL.

**Monorepo:** set Vercel **Root Directory** to `kqs-web`.

## Swap AI / placeholder looks

| What | Where |
|---|---|
| Images | `kqs-web/public/looks/*.png` |
| Names + coming-soon lines | `kqs-web/src/data/looks.ts` |
| Logo | `kqs-web/public/kqs-logo.png` |

Tap any look → artistic “unreleased” reveal (not a product detail page).

v1 UI is a **studio masonry** (Agora-adjacent irregular tiles) — filters in the header, no conventional category/PDP tree, minimal copy.

## Future catalog hook

When real SKUs ship:

1. Reuse sellable qty from `kqs_retail` stock APIs (same source as POS — on-hand minus reservations).
2. Replace static `LOOKS` with a fetch that maps Item + image + price.
3. Keep the visual-first UX; do not slide into conventional category / PDP trees unless product needs it.

v1 has **zero** POS dependency so the URL works for platform signups before inventory is ready.
