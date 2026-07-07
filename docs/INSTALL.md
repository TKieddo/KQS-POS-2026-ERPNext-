# Prerequisites — Windows

Install these before running `docker\setup-dev.ps1`:

## 1. Docker Desktop (required for ERPNext)

```powershell
winget install Docker.DockerDesktop
```

Restart your PC after install. Open Docker Desktop and wait until it shows **Running**.

## 2. Git (required for version control)

```powershell
winget install Git.Git
```

Close and reopen your terminal after install.

## Verify

```powershell
docker --version
git --version
```

## Start ERPNext

```powershell
cd "C:\Users\tsebi\Documents\KQS POS\docker"
.\setup-dev.ps1
```

First run downloads images (~2GB) and creates site `frontend` with password `admin`.

## Seed KQS demo data

```powershell
cd "C:\Users\tsebi\Documents\KQS POS\scripts"
.\run-smoke-test.bat
```

## After code changes (migrate / build)

`bench` runs **inside Docker**, not on Windows PowerShell directly:

```powershell
cd "C:\Users\tsebi\Documents\KQS POS\docker"
docker compose -f compose.dev.yml exec backend bench --site frontend migrate
docker compose -f compose.dev.yml exec backend bench build
```

Built assets are written to shared Docker volumes (`frappe-dist`, `erpnext-dist`) that nginx uses automatically — no manual copy step. Then hard-refresh the browser (`Ctrl+Shift+R`).

Restarting Docker (`docker compose up -d` or PC reboot) also keeps CSS working; the stack rebuilds assets only when `assets.json` and the dist volume are out of sync.

## Open Point of Sale

**http://localhost:8080/app/point-of-sale**

| User | Password | Use |
|------|----------|-----|
| `cashier@kqs.local` | `kqs123` | Store tablet (POS + layby) |
| `manager@kqs.local` | `kqs123` | Add Product, Assign to Branch, layby |
| `Administrator` | `admin` | Setup only — not on tills |

Never use Administrator on store tablets.
