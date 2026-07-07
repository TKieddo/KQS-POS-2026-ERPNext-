#Requires -Version 5.1
<#
.SYNOPSIS
  Legacy fallback: copy built assets from backend to frontend when not using
  shared dist volumes (compose.dev.yml now mounts frappe-dist / erpnext-dist).

.USAGE
  cd scripts
  .\sync-frontend-assets.ps1
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $Root "docker\compose.dev.yml"

$backend = docker compose -f $ComposeFile ps -q backend
$frontend = docker compose -f $ComposeFile ps -q frontend
if (-not $backend -or -not $frontend) {
    Write-Error "Start the stack first: docker compose -f docker/compose.dev.yml up -d"
}

$tmp = Join-Path $env:TEMP "kqs-asset-sync"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Write-Host "Copying frappe + erpnext + kqs_retail public assets to frontend..." -ForegroundColor Cyan

docker cp "${backend}:/home/frappe/frappe-bench/apps/frappe/frappe/public/dist" $tmp\frappe-dist
docker cp "$tmp\frappe-dist\." "${frontend}:/home/frappe/frappe-bench/apps/frappe/frappe/public/dist/"

docker cp "${backend}:/home/frappe/frappe-bench/apps/erpnext/erpnext/public/dist" $tmp\erpnext-dist
docker cp "$tmp\erpnext-dist\." "${frontend}:/home/frappe/frappe-bench/apps/erpnext/erpnext/public/dist/"

docker exec $frontend mkdir -p /home/frappe/frappe-bench/apps/kqs_retail/kqs_retail/public
docker cp "${backend}:/home/frappe/frappe-bench/apps/kqs_retail/kqs_retail/public" $tmp\kqs-public
docker cp "$tmp\kqs-public\." "${frontend}:/home/frappe/frappe-bench/apps/kqs_retail/kqs_retail/public/"

docker compose -f $ComposeFile exec backend bench --site frontend clear-cache | Out-Null

Write-Host "Done. Hard-refresh the browser (Ctrl+Shift+R)." -ForegroundColor Green
