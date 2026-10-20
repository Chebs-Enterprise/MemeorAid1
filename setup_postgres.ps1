# =============================================================================
#  MemorAid - PostgreSQL database setup
#
#  Creates the `memoraid` role and database required by the document of proof
#  (section 3.5.1), then loads backend/db/schema.sql.
#
#  USAGE - run ONE of these from an elevated PowerShell:
#
#    # A) you know the postgres superuser password
#    .\setup_postgres.ps1 -PostgresPassword 'YOUR_PASSWORD'
#
#    # B) you don't know it - briefly allow local passwordless access
#    .\setup_postgres.ps1 -UseTrustForLocalhost
#
#  STATUS: NOT YET RUN ON THIS MACHINE. The `memoraid` role and database do not
#  exist yet, so the backend is currently using the SQLite fallback. Running
#  either command above completes the switch to PostgreSQL.
#
#  -UseTrustForLocalhost backs up pg_hba.conf, switches ONLY the 127.0.0.1 and
#  ::1 lines to `trust`, restarts Postgres, does the work, then ALWAYS restores
#  the original file and restarts again (even if something fails).
# =============================================================================
param(
  [string]$PostgresPassword,
  [switch]$UseTrustForLocalhost,
  [string]$PgRoot = "C:\Program Files\PostgreSQL\16",
  [string]$NewPassword = "memoraid",
  [string]$DbName = "memoraid",
  [string]$RoleName = "memoraid"
)

$ErrorActionPreference = 'Stop'
$bin    = Join-Path $PgRoot 'bin'
$psql   = Join-Path $bin 'psql.exe'
$pgctl  = Join-Path $bin 'pg_ctl.exe'
$data   = Join-Path $PgRoot 'data'
$hba    = Join-Path $data 'pg_hba.conf'
$backup = Join-Path $env:TEMP 'memoraid_pg_hba.backup.conf'
$schema = Join-Path $PSScriptRoot 'backend\db\schema.sql'

if (-not (Test-Path $psql))  { throw "psql.exe not found under $PgRoot" }
if (-not (Test-Path $schema)) { throw "schema.sql not found at $schema" }

# --- BOM / CRLF-preserving helpers -------------------------------------------
# pg_hba.conf ships with a UTF-8 BOM. Writing it back with Set-Content
# -Encoding UTF8 adds a SECOND BOM and Postgres then refuses to load the file.
# Always round-trip the exact bytes instead.
function Read-RawText($path) {
  $bytes = [IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return @{ text = [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3); bom = $true }
  }
  return @{ text = [Text.Encoding]::UTF8.GetString($bytes); bom = $false }
}
function Write-RawText($path, $text, [bool]$bom) {
  $enc   = New-Object Text.UTF8Encoding($bom)
  [IO.File]::WriteAllText($path, $text, $enc)
}

function Invoke-Psql {
  param([string]$Sql, [string]$Db = 'postgres')
  $out = & $psql -U postgres -h 127.0.0.1 -p 5432 -d $Db -v ON_ERROR_STOP=1 -t -A -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed ($Db): $out" }
  return ($out | Out-String).Trim()
}

$usedTrust = $false
$saved = $null

if ($UseTrustForLocalhost) {
  $saved = Read-RawText $hba
  Copy-Item $hba $backup -Force
  Write-Host "Backed up pg_hba.conf -> $backup"

  $t = $saved.text -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)\S+', '${1}trust'
  $t = $t        -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)\S+',      '${1}trust'
  Write-RawText $hba $t $saved.bom

  Write-Host "Restarting PostgreSQL to apply trust config..."
  & $pgctl restart -D $data -m fast -w -t 60
  if ($LASTEXITCODE -ne 0) { throw "pg_ctl restart failed" }
  $usedTrust = $true
} else {
  if (-not $PostgresPassword) { throw "Provide -PostgresPassword, or use -UseTrustForLocalhost" }
  $env:PGPASSWORD = $PostgresPassword
}

try {
  Write-Host "`nCreating role '$RoleName'..."
  if ((Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname='$RoleName';") -eq '1') {
    Invoke-Psql "ALTER ROLE $RoleName WITH LOGIN PASSWORD '$NewPassword';" | Out-Null
    Write-Host "  role already existed - password reset"
  } else {
    Invoke-Psql "CREATE ROLE $RoleName WITH LOGIN PASSWORD '$NewPassword';" | Out-Null
    Write-Host "  role created"
  }

  Write-Host "Creating database '$DbName'..."
  if ((Invoke-Psql "SELECT 1 FROM pg_database WHERE datname='$DbName';") -eq '1') {
    Write-Host "  database already existed"
  } else {
    Invoke-Psql "CREATE DATABASE $DbName OWNER $RoleName ENCODING 'UTF8';" | Out-Null
    Write-Host "  database created"
  }

  Invoke-Psql "GRANT ALL PRIVILEGES ON DATABASE $DbName TO $RoleName;" | Out-Null
  Invoke-Psql "ALTER SCHEMA public OWNER TO $RoleName;" -Db $DbName | Out-Null
  Invoke-Psql "GRANT ALL ON SCHEMA public TO $RoleName;" -Db $DbName | Out-Null
  Write-Host "  privileges granted"

  Write-Host "`nLoading schema.sql (11 tables)..."
  $env:PGPASSWORD = $NewPassword
  $schemaOut = & $psql -U $RoleName -h 127.0.0.1 -p 5432 -d $DbName -v ON_ERROR_STOP=1 -f $schema 2>&1
  if ($LASTEXITCODE -ne 0) { throw "schema load failed: $schemaOut" }
  $tables = Invoke-Psql "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" -Db $DbName
  Write-Host "  tables now in public schema: $tables"

  Write-Host "`nSUCCESS. Connection string:"
  Write-Host "  postgresql+psycopg2://${RoleName}:${NewPassword}@localhost:5432/${DbName}"
}
finally {
  if ($env:PGPASSWORD) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
  if ($usedTrust) {
    Write-Host "`nRestoring original pg_hba.conf..."
    Copy-Item $backup $hba -Force
    & $pgctl restart -D $data -m fast -w -t 60
    $check = Read-RawText $hba
    if ($check.text -eq $saved.text -and $check.bom -eq $saved.bom) {
      Write-Host "  restored and verified identical"
    } else {
      Write-Warning "  pg_hba.conf does NOT match the backup - inspect $backup"
    }
  }
}
