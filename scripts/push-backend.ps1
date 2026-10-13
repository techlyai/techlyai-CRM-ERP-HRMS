$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publishRoot=Join-Path $projectRoot 'artifacts/github-publish'
$expectedRemote='https://github.com/techlyai/techlyai-CRM-ERP-HRMS.git'
if (!(Test-Path -LiteralPath (Join-Path $publishRoot '.git'))) {throw 'Prepared repository is missing.'}
$remote=& git -C $publishRoot remote get-url origin
if ($LASTEXITCODE -ne 0 -or $remote.Trim() -ne $expectedRemote) {throw 'Unexpected destination; nothing was pushed.'}
$changes=& git -C $publishRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) {throw 'Prepared checkout has uncommitted changes.'}
foreach ($file in @('docker-compose.yml','Dockerfile','src/app/login/page.tsx','src/lib/auth.ts','database/schema.sql','scripts/scheduler.cjs')) {
 & git -C $publishRoot cat-file -e "backend:$file"
 if ($LASTEXITCODE -ne 0) {throw "Backend branch is missing $file"}
}
& git -C $publishRoot push --set-upstream origin backend
if ($LASTEXITCODE -ne 0) {throw 'Backend push failed. Check GitHub access/network connectivity. No force push was attempted.'}
& git -C $publishRoot ls-remote --heads origin backend
if ($LASTEXITCODE -ne 0) {throw 'Push completed but remote verification failed.'}
