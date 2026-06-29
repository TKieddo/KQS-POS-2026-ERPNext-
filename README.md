# KQS POS

Custom retail stack for KQS apparel and footwear stores, built on **ERPNext Point of Sale**.

## Architecture

| Component | Path | Role |
|-----------|------|------|
| **kqs_retail** | `kqs_retail/` | Frappe app — layby, stock APIs, POS extensions, manager pages |
| **docker** | `docker/` | Local ERPNext dev environment |

**Do not fork ERPNext.** Install upstream [frappe/erpnext](https://github.com/frappe/erpnext) via bench/Docker; extend via `kqs_retail`.

## Prerequisites

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows)
2. [Git](https://git-scm.com/)

## Quick start (local ERPNext)

```powershell
cd docker
.\setup-dev.ps1
```

Then open **http://localhost:8080/app/point-of-sale** — login `Administrator` / password from setup output.

Seed demo data (warehouses, items, cashier users):

```bash
docker compose -f docker/compose.dev.yml exec backend bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
```

Or run smoke tests:

```powershell
scripts\run-smoke-test.bat
```

## Test users (after seed)

| User | Password | Lands on |
|------|----------|----------|
| `cashier@kqs.local` | `kqs123` | Point of Sale |
| `manager@kqs.local` | `kqs123` | KQS Retail workspace |
| `Administrator` | (setup) | Full Desk |

## Repo layout

```
KQS POS/
├── kqs_retail/     # Frappe custom app
├── docs/           # Business rules & setup guides
├── docker/         # Dev Docker Compose
└── scripts/        # ERPNext setup & smoke-test helpers
```

## Documentation

- [POS feature checklist](docs/pos-feature-checklist.md) — tick off standard POS capabilities as you go
- [Layby business rules](docs/layby-rules.md)
- [Store & warehouse setup](docs/store-setup.md)
- [Installation](docs/INSTALL.md)
- [Deployment (staging)](docs/deployment.md)
- [Backup (code vs site data)](docs/backup.md)

## GitHub

Code is hosted at [TKieddo/KQS-POS-2026-ERPNext-](https://github.com/TKieddo/KQS-POS-2026-ERPNext-). Run `.\scripts\backup-dev-site.ps1` weekly for live site data (products, sales).

Proprietary — KQS. ERPNext is AGPLv3.
