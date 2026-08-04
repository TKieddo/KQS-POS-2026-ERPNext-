# KQS FOOTWARE — Brand site

Youthful premium streetwear & sneakers teaser for **KQS FOOTWARE** (Kabeli Quality Shoes, Lesotho). Visual-first — no cart, no conventional product pages.

## Local

```bash
cd kqs-web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy (Vercel)

First time (browser login):

```bash
cd kqs-web
npx vercel login
npx vercel --prod
```

That prints a live `*.vercel.app` URL (HTTPS) for platform signups.

### Attach domain `kqsfootwear`

1. Vercel → Project → **Settings → Domains** → add `kqsfootwear.com` (or `.co.ls` / whatever you own).
2. At your DNS host, add the records Vercel shows (usually `A` / `CNAME`).
3. Wait for HTTPS; switch APIs/platforms to the custom domain when ready.

If this repo is the monorepo, set Vercel **Root Directory** to **`kqs-web`**.

## Swap look images

1. Replace files under `public/looks/` (keep filenames or update `src/data/looks.ts`).
2. Edit copy in `src/data/looks.ts` (`line`, `sub`, `name`).
3. Redeploy.

## Future: real catalog

When stock is live, wire sellable qty from the POS APIs in `kqs_retail` (see `docs/kqs-brand-site.md`) — do not invent a parallel inventory model.
