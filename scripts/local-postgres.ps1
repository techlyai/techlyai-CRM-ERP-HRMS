param([ValidateSet('start','stop')][string]$Action='start',[string]$PostgresBin='C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRoot=Join-Path $projectRoot '.local'
$dataRoot=Join-Path $localRoot 'postgres'
$envFile=Join-Path $projectRoot '.env.database'
$pgCtl=Join-Path $PostgresBin 'pg_ctl.exe'
$initDb=Join-Path $PostgresBin 'initdb.exe'
$postgres=Join-Path $PostgresBin 'postgres.exe'
foreach ($required in @($pgCtl,$initDb,$postgres)) {
 if (!(Test-Path -LiteralPath $required)) {throw "PostgreSQL installation is incomplete: $required is missing. Repair PostgreSQL or provide -PostgresBin pointing to a complete installation."}
}
& $postgres --version
if ($LASTEXITCODE -ne 0) {throw 'PostgreSQL cannot start. Repair its installation and runtime DLL dependencies.'}
if ($Action -eq 'stop') {
 & $pgCtl stop -D $dataRoot -m fast
 if ($LASTEXITCODE -ne 0) {throw 'Could not stop the local Techly database.'}
 exit
}
New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
if (!(Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) {
 if (Test-Path -LiteralPath $envFile) {throw '.env.database already exists. Review that connection before initializing another cluster.'}
 if ((Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue)) {throw 'Port 55432 is in use; refusing to initialize over an unknown server.'}
 $secretBytes=New-Object byte[] 32
 $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 $rng.GetBytes($secretBytes)
 $rng.Dispose()
 $dbPassword=([BitConverter]::ToString($secretBytes)).Replace('-','').ToLowerInvariant()
 $passwordFile=Join-Path $localRoot 'init-password.tmp'
 [IO.File]::WriteAllText($passwordFile,$dbPassword,[Text.UTF8Encoding]::new($false))
 try {
  & $initDb -D $dataRoot -U techly_owner --encoding=UTF8 --locale=C --auth=scram-sha-256 "--pwfile=$passwordFile"
  if ($LASTEXITCODE -ne 0) {throw 'PostgreSQL initialization failed.'}
 } finally {Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue}
 [IO.File]::AppendAllText((Join-Path $dataRoot 'postgresql.conf'),"`nlisten_addresses = '127.0.0.1'`nport = 55432`n",[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText($envFile,"DATABASE_ADMIN_URL=postgresql://techly_owner:$dbPassword@127.0.0.1:55432/techly`n",[Text.UTF8Encoding]::new($false))
}
& $pgCtl status -D $dataRoot | Out-Null
if ($LASTEXITCODE -ne 0) {
 $log=Join-Path $localRoot 'postgres.log'
 # Hidden native server; no external service or unrelated data directory is changed.
 Start-Process -FilePath $postgres -ArgumentList @('-D',('"'+$dataRoot+'"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localRoot 'postgres-stdout.log') -RedirectStandardError $log
 for ($attempt=0;$attempt -lt 20;$attempt++) {
  Start-Sleep -Milliseconds 500
  & $pgCtl status -D $dataRoot | Out-Null
  if ($LASTEXITCODE -eq 0) {break}
 }
 if ($LASTEXITCODE -ne 0) {throw "Database failed to start. See $log"}
}
Push-Location $projectRoot
try {
 & node --env-file=.env.database scripts/ensure-local-database.cjs
 if ($LASTEXITCODE -ne 0) {throw 'Could not create the dedicated Techly database.'}
} finally {Pop-Location}
Write-Output 'Local PostgreSQL is ready on 127.0.0.1:55432. Run npm run db:setup, then npm run create-admin.'
