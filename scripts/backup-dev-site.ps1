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
$Site = "frontend"

if (-not (Test-Path $ComposeFile)) {
	Write-Error "Compose file not found: $ComposeFile"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Creating ERPNext backup (site: $Site)..."
docker compose -f $ComposeFile exec -T backend `
	bench --site $Site backup --with-files --backup-path /home/frappe/frappe-bench/sites/$Site/private/backups

$container = docker compose -f $ComposeFile ps -q backend
if (-not $container) {
	Write-Error "Backend container is not running. Start Docker dev stack first."
}

$remoteDir = "/home/frappe/frappe-bench/sites/$Site/private/backups"
$remoteList = docker exec $container bash -c "ls -1t $remoteDir/*.sql.gz 2>/dev/null | head -1"
$latestSql = ($remoteList | Out-String).Trim()
if (-not $latestSql) {
	Write-Error "No backup file found in container."
}

$sqlFile = [System.IO.Path]::GetFileName($latestSql)
if ($sqlFile -notmatch '^(.+)-database\.sql\.gz$') {
	Write-Error "Unexpected backup filename: $sqlFile"
}
$prefix = $Matches[1]

$dest = Join-Path $OutDir "${Stamp}_${prefix}"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$backupFiles = @(
	"${prefix}-database.sql.gz",
	"${prefix}-site_config_backup.json",
	"${prefix}-files.tar",
	"${prefix}-private-files.tar"
)

$copied = @()
$missing = @()
foreach ($name in $backupFiles) {
	$remote = "${remoteDir}/${name}"
	$local = Join-Path $dest $name
	# docker cp prints progress to stderr; do not treat that as a fatal error.
	$null = docker cp "${container}:${remote}" $local 2>&1
	if (Test-Path $local) {
		$copied += $name
	} else {
		$missing += $name
	}
}

Write-Host ""
if ($missing.Count -gt 0) {
	Write-Warning "Some files were not copied: $($missing -join ', ')"
}
Write-Host "Copied $($copied.Count) file(s):"
foreach ($name in $copied) {
	$size = (Get-Item (Join-Path $dest $name)).Length
	Write-Host ("  {0} ({1:N0} bytes)" -f $name, $size)
}
Write-Host ""
Write-Host "Backup saved to: $dest"
Write-Host "Copy this folder to cloud storage (OneDrive, Google Drive, etc.). Do not commit backups/ to Git."

if ($missing.Count -gt 0) {
	exit 1
}
