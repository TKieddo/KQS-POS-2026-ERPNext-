# Backup & restore

## What GitHub stores (this repo)

| Included | Not included |
|----------|----------------|
| `kqs_retail/` — all customizations (layby, POS JS, APIs, pages) | ERPNext / Frappe core (installed from Docker image `v16.25.0`) |
| `docker/` — how to run the stack locally | Live database (products, sales, customers) |
| `docs/`, `scripts/` | Uploaded images/files in the site |
| Cursor project rules (`.cursor/rules/`) | Passwords and `.env` secrets |

**GitHub = your source code and configuration.** After a PC reset, clone the repo and run `docker\setup-dev.ps1` to get ERPNext + `kqs_retail` back.

## What needs a separate backup (live site data)

Your running ERPNext site lives in Docker volumes (`sites`, database). Back that up regularly:

```powershell
.\scripts\backup-dev-site.ps1
```

Output goes to `backups/` (gitignored). Each run creates a folder with four files:

- `*-database.sql.gz` — products, customers, sales, laybys
- `*-site_config_backup.json` — site settings
- `*-files.tar` — public uploads (product images)
- `*-private-files.tar` — private attachments

Copy the whole folder to cloud storage.

### Restore (dev)

1. Start the stack: `cd docker; .\setup-dev.ps1`
2. Copy all four backup files into the container’s `sites/frontend/private/backups/`
3. Run: `bench --site frontend restore /path/to/*-database.sql.gz`

## Push code to GitHub

```powershell
cd "C:\Users\tsebi\Documents\KQS POS"
git add -A
git commit -m "your message"
git push origin main
```

Remote: https://github.com/TKieddo/KQS-POS-2026-ERPNext-
