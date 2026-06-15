# run-workflows.ps1 — run one or more n8n workflows once via CLI, then exit.
# No persistent n8n server. Loads API keys from ../.env so $env.* expressions resolve.
# Usage: powershell -File run-workflows.ps1 -Ids "id1,id2,id3"
param([string]$Ids)
$ErrorActionPreference = 'Continue'
$idList = $Ids -split '[,; ]+' | Where-Object { $_ }
$root = Split-Path $PSScriptRoot -Parent

# Load .env into the process environment (strip inline comments).
foreach ($line in Get-Content (Join-Path $root '.env')) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') {
    $val = ($matches[2] -replace '\s+#.*$', '').Trim()
    [Environment]::SetEnvironmentVariable($matches[1], $val, 'Process')
  }
}
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'

$bin = Join-Path $env:APPDATA 'npm\node_modules\n8n\bin\n8n'
foreach ($id in $idList) {
  Write-Output ("[{0}] execute {1}" -f (Get-Date -Format s), $id)
  & node $bin execute --id $id 2>&1 | Out-Null
  Write-Output ("  -> exit {0}" -f $LASTEXITCODE)
}
Write-Output "done"
