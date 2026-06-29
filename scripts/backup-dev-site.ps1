# Backup local Docker ERPNext site data (database + files).
# Code lives in GitHub; this script saves your live products, customers, and transactions.
#
# Usage (from repo root):
#   .\scripts\backup-dev-site.ps1
#
# Restores require bench restore inside the backend container — see docs/backup.md

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $RepoRoot "docker\compose.dev.yml"
$OutDir = Join-Path $RepoRoot "backups"
$Stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"

if (-not (Test-Path $ComposeFile)) {
	Write-Error "Compose file not found: $ComposeFile"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Creating ERPNext backup (site: frontend)..."
docker compose -f $ComposeFile exec -T backend `
	bench --site frontend backup --with-files --backup-path /home/frappe/frappe-bench/sites/frontend/private/backups

$container = docker compose -f $ComposeFile ps -q backend
if (-not $container) {
	Write-Error "Backend container is not running. Start Docker dev stack first."
}

$remoteList = docker exec $container bash -c "ls -1t /home/frappe/frappe-bench/sites/frontend/private/backups/*.sql.gz 2>/dev/null | head -1"
$latestSql = ($remoteList | Out-String).Trim()
if (-not $latestSql) {
	Write-Error "No backup file found in container."
}

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($latestSql) -replace '\.sql$', ''
$dest = Join-Path $OutDir "${Stamp}_${baseName}"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

foreach ($ext in @("sql.gz", "json.gz", "tar")) {
	$remote = "/home/frappe/frappe-bench/sites/frontend/private/backups/${baseName}.$ext"
	docker cp "${container}:${remote}" $dest 2>$null
}

Write-Host ""
Write-Host "Backup saved to: $dest"
Write-Host "Copy this folder to cloud storage (OneDrive, Google Drive, etc.). Do not commit backups/ to Git."
