# ============================================
# CalTopo Tools – EXE Build Script
# ============================================

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Building CalTopo Tools (EXE)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Sanity check
$specFile = "Caltopo_Tools_v1.spec"

if (-not (Test-Path $specFile)) {
    Write-Error "Spec file not found: $specFile"
}

# Clean previous build artifacts
if (Test-Path ".\build") {
    Write-Host "Removing build folder..." -ForegroundColor Yellow
    Remove-Item ".\build" -Recurse -Force
}

if (Test-Path ".\dist") {
    Write-Host "Removing dist folder..." -ForegroundColor Yellow
    Remove-Item ".\dist" -Recurse -Force
}

# Run PyInstaller
Write-Host "Running PyInstaller..." -ForegroundColor Green
pyinstaller --clean $specFile

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Build complete" -ForegroundColor Cyan
Write-Host " EXE located in .\dist\CalTopo_Tools_v1\" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
