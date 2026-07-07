#Requires -Version 5.1
<#
.SYNOPSIS
  Start local ERPNext dev stack for KQS POS.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DockerDir = Join-Path $Root "docker"

function Test-Docker {
    try {
        docker version | Out-Null
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-Docker)) {
    Write-Host ""
    Write-Host "Docker is not installed or not running." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Install Docker Desktop:" -ForegroundColor Cyan
    Write-Host "  winget install Docker.DockerDesktop"
    Write-Host ""
    Write-Host "Or download: https://www.docker.com/products/docker-desktop/"
    Write-Host ""
    Write-Host "After install, restart this script."
    exit 1
}

Set-Location $DockerDir
Write-Host "Starting ERPNext (first run may take 5-15 minutes)..." -ForegroundColor Green
docker compose -f compose.dev.yml up -d

Write-Host ""
Write-Host "Waiting for frontend assets (bench build on first start)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(8)
do {
    Start-Sleep -Seconds 5
    $ready = docker compose -f compose.dev.yml logs frontend 2>$null | Select-String "Dist assets ready"
    if ($ready) { break }
    if ((Get-Date) -gt $deadline) {
        Write-Host "Asset wait timed out - check: docker compose -f compose.dev.yml logs backend frontend" -ForegroundColor Yellow
        break
    }
} while ($true)

Write-Host ""
Write-Host "Follow site creation:" -ForegroundColor Cyan
Write-Host "  docker compose -f compose.dev.yml logs -f create-site"
Write-Host ""
Write-Host "When ready, open: http://localhost:8080" -ForegroundColor Green
Write-Host "Login: Administrator / admin"
Write-Host ""
Write-Host "Seed demo data:" -ForegroundColor Cyan
Write-Host '  docker compose -f compose.dev.yml exec backend bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed'
