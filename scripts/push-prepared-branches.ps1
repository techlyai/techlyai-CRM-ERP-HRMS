# Compatibility entry point: the requested deployment now uses ONLY backend.
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'push-backend.ps1')
