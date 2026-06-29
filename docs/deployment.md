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
bench get-app https://github.com/YOUR_ORG/kqs-pos --branch main --resolve-deps
bench --site $SITE install-app kqs_retail
bench --site $SITE execute kqs_retail.setup.seed_kqs_demo.seed
```

## Production (recommended)

| Component | Host |
|-----------|------|
| ERPNext + MariaDB + Redis | VPS (Hetzner CPX31 ~$15/mo) |
| Backups | `bench --site all backup --with-files` daily cron |

### VPS quick outline

1. Ubuntu 24.04, Docker or native `bench`
2. Clone monorepo, `bench get-app` for `kqs_retail`
3. TLS via Caddy or Nginx + Let's Encrypt
4. Store tablets bookmark `https://erp.yourdomain.com/app/point-of-sale`

## Tablet testing checklist

- [ ] Login as `cashier@kqs.local` from store Wi-Fi → lands on POS
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
