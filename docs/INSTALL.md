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

## Open Point of Sale

**http://localhost:8080/app/point-of-sale**

| User | Password | Use |
|------|----------|-----|
| `cashier@kqs.local` | `kqs123` | Store tablet (POS + layby) |
| `manager@kqs.local` | `kqs123` | Add Product, Assign to Branch, layby |
| `Administrator` | `admin` | Setup only — not on tills |

Never use Administrator on store tablets.
