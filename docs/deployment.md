# KQS POS — Staging & Production Deployment

## Local development

```powershell
cd docker
.\setup-dev.ps1
```

- ERPNext + POS: http://localhost:8080/app/point-of-sale
- Login: `Administrator` / `admin` (setup only) or `cashier@kqs.local` / `kqs123` (after seed)

```powershell
scripts\run-smoke-test.bat
```

## Staging on Railway

1. Push `KQS POS` to GitHub (include `kqs_retail` in repo).
2. Deploy [ERPNext Railway template](https://railway.com/deploy/erpnext) or use `docker/compose.dev.yml` as reference.
3. After deploy, install custom app on the bench container:

```bash
bench get-app https://github.com/TKieddo/KQS-POS-2026-ERPNext- --branch main --resolve-deps
bench --site $SITE install-app kqs_retail
bench --site $SITE migrate
bench build --production
```

**Do not** run `seed_kqs_demo.seed` on staging or production — that is dev-only demo data.

## Production (recommended)

| Component | Host |
|-----------|------|
| ERPNext + MariaDB + Redis | VPS (Hostinger KVM 2, Hetzner CX23, etc.) |
| Backups | `bench --site all backup --with-files` daily cron |

### Clean production install (no demo data)

After ERPNext site creation, install only the custom app. `migrate` runs KQS setup hooks (roles, custom fields, payment defaults) — **not** demo products or users.

```bash
bench get-app https://github.com/TKieddo/KQS-POS-2026-ERPNext- --branch main --resolve-deps
bench --site YOUR_SITE install-app kqs_retail
bench --site YOUR_SITE migrate
bench build --production
```

Then configure manually (see [store-setup.md](store-setup.md)):

1. Company, warehouses, POS profiles
2. Real cashier/manager users (not `cashier@kqs.local`)
3. Modes of payment (Cash, Bank, Mpesa, Eco-Cash)
4. `bench --site YOUR_SITE execute kqs_retail.setup.seed_kqs_demo.sync_pos_payment_methods` — syncs payment tiles only; safe on production

**Never run on production:**

```bash
# DEV ONLY — creates demo users, sample shoes, test stock
bench --site YOUR_SITE execute kqs_retail.setup.seed_kqs_demo.seed
```

### VPS quick outline

1. Ubuntu 24.04, Docker or native `bench`
2. Clone monorepo, `bench get-app` for `kqs_retail`
3. TLS via Caddy or Nginx + Let's Encrypt
4. Store tablets bookmark `https://erp.yourdomain.com/app/point-of-sale`

### Updating KQS code on Hostinger VPS (see changes live)

Editing files only on your Windows PC does **not** update Hostinger. Push to GitHub, then pull on the VPS.

```bash
# SSH into the VPS, then (paths vary — use your bench / app location):
cd /path/to/frappe-bench

# If kqs_retail was installed via get-app from GitHub:
cd apps/kqs_retail
git pull origin main   # or your branch
cd ../..

bench --site YOUR_SITE migrate
bench build --app kqs_retail
bench --site YOUR_SITE clear-cache
# optional if workers stick to old code:
bench restart
```

Then hard-refresh the browser (`Ctrl+Shift+R`).

**Never** edit ERPNext core on the VPS. All KQS changes belong in `apps/kqs_retail` only.

If the app is a monorepo subdirectory (this repo), pull the monorepo on the VPS and ensure `apps/kqs_retail` is that folder (symlink or `bench get-app` from the same GitHub repo).

## Tablet testing checklist

POS supports **short offline** on a **single till** (cached catalog + outbox). See [offline-local-cache.md](offline-local-cache.md). Prefer stable store Wi-Fi; use offline for blips only.

- [ ] Login as a real cashier user from store Wi-Fi → lands on POS
- [ ] Offline smoke: airplane mode → cash/card sale → reconnect → sync (Offline Sync Log)
- [ ] Cannot close till with pending offline outbox
- [ ] Normal sale + return via ERPNext POS
- [ ] Create layby with deposit (Layby button on checkout)
- [ ] Layby Lookup & Pay from POS menu
- [ ] Complete layby → Sales Invoice created
- [ ] Manager: Add Product → Assign to Branch → stock appears in POS

## Files in this repo

| Path | Purpose |
|------|---------|
| `docker/compose.dev.yml` | Local ERPNext + kqs_retail mount |
| `docker/setup-dev.ps1` | Windows start script |
| `scripts/docker-init-site.sh` | Site creation + app install |
| `scripts/run-smoke-test.bat` | Seed + automated smoke tests |
| `kqs_retail/` | Frappe custom app |
