$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publishRoot=Join-Path $projectRoot 'artifacts/github-publish'
$expectedRemote='https://github.com/techlyai/techlyai-CRM-ERP-HRMS.git'
if (!(Test-Path -LiteralPath (Join-Path $publishRoot '.git'))) {throw 'Prepared repository is missing. Prepare the source checkout before publishing.'}
$remote=& git -C $publishRoot remote get-url origin
if ($LASTEXITCODE -ne 0 -or $remote.Trim() -ne $expectedRemote) {throw 'Unexpected destination; no branches were pushed.'}
$changes=& git -C $publishRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) {throw 'Prepared checkout has uncommitted changes. Review and commit them before publishing.'}
foreach ($branch in @('frontend','backend')) {
 & git -C $publishRoot rev-parse --verify "refs/heads/$branch" | Out-Null
 if ($LASTEXITCODE -ne 0) {throw "Missing local branch: $branch"}
}
& git -C $publishRoot push --atomic --set-upstream origin frontend backend
if ($LASTEXITCODE -ne 0) {throw 'Push failed. Check GitHub write access/network connectivity. No force push was attempted.'}
& git -C $publishRoot ls-remote --heads origin frontend backend
if ($LASTEXITCODE -ne 0) {throw 'Push completed but remote verification failed.'}
