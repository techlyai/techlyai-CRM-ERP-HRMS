param([ValidateSet('prepare','start','stop','status')][string]$Action='start')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$composeFile=Join-Path $projectRoot 'compose.yaml'
$localRoot=Join-Path $projectRoot '.local'
$passwordFile=Join-Path $localRoot 'docker-postgres-password'
$envFile=Join-Path $projectRoot '.env.database'

if ($Action -in @('prepare','start')) {
 if (!(Test-Path -LiteralPath $passwordFile)) {
  if (Test-Path -LiteralPath $envFile) {throw '.env.database already exists. Refusing to replace another database connection. Review it before Docker setup.'}
  New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
  $secretBytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($secretBytes)
  $rng.Dispose()
  $dbPassword=([BitConverter]::ToString($secretBytes)).Replace('-','').ToLowerInvariant()
  [IO.File]::WriteAllText($passwordFile,$dbPassword,[Text.UTF8Encoding]::new($false))
 } else {
  $dbPassword=[IO.File]::ReadAllText($passwordFile).Trim()
  if ($dbPassword -notmatch '^[a-f0-9]{64}$') {throw 'Unexpected Docker password file format. Existing credentials have been preserved.'}
 }
 $expected="DATABASE_ADMIN_URL=postgresql://techly_owner:$dbPassword@127.0.0.1:55432/techly"
 if (Test-Path -LiteralPath $envFile) {
  if ([IO.File]::ReadAllText($envFile).Trim() -ne $expected) {throw '.env.database does not match this Docker database. Existing connection has been preserved.'}
 } else {
  [IO.File]::WriteAllText($envFile,$expected+"`n",[Text.UTF8Encoding]::new($false))
 }
 if ($Action -eq 'prepare') {
  Write-Output 'Docker configuration prepared. The generated database-owner password is stored privately in .local; no application user exists yet.'
  exit
 }
}

$previousErrorAction=$ErrorActionPreference
try {
 $ErrorActionPreference='Continue'
 & docker info --format '{{.ServerVersion}}' 2>$null
 $dockerStatus=$LASTEXITCODE
} finally {$ErrorActionPreference=$previousErrorAction}
if ($dockerStatus -ne 0) {throw 'Docker engine is unavailable. Open Docker Desktop and wait until its engine is running, then retry npm run db:docker:start.'}
switch ($Action) {
 'start' {
  & docker compose --file $composeFile up -d --wait --wait-timeout 60 postgres
  if ($LASTEXITCODE -ne 0) {throw 'PostgreSQL container did not become healthy. Inspect docker compose logs postgres. No data has been deleted.'}
  Write-Output 'PostgreSQL is ready on 127.0.0.1:55432. Run npm run db:setup, then npm run create-admin.'
 }
 'stop' {& docker compose --file $composeFile stop postgres}
 'status' {& docker compose --file $composeFile ps postgres}
}
if ($LASTEXITCODE -ne 0) {throw 'Docker Compose command failed.'}
