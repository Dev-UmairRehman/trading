$ErrorActionPreference = 'Stop'
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$key = (Get-Content $envFile | Select-String '^N8N_API_KEY=').Line -replace '^N8N_API_KEY=',''
$base = 'http://localhost:5678/api/v1'
$headers = @{ 'X-N8N-API-KEY' = $key; 'Content-Type' = 'application/json' }

$folder = Join-Path $PSScriptRoot '4J2rC9Eo2E0GqRHp'
$map = @{
  '1-cold-email-outreach.json'    = 'jyKhQtkYN6qovgce'
  '2-linkedin-daily-poster.json'  = 'WqN3oRUKEHWoGyHc'
  '3-auto-reply-proposal.json'    = 'wJx1HhLceD8TyXZM'
}

$results = @()
foreach ($f in $map.Keys) {
  $id = $map[$f]
  $path = Join-Path $folder $f
  $raw = Get-Content $path -Raw -Encoding UTF8
  try {
    $resp = Invoke-RestMethod -Uri "$base/workflows/$id" -Method PUT -Headers $headers -Body $raw
    $results += [PSCustomObject]@{ File = $f; Id = $id; Status = 'UPDATED' }
  } catch {
    $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $results += [PSCustomObject]@{ File = $f; Id = $id; Status = "ERR: $msg" }
  }
}

$results | Format-Table -AutoSize | Out-String | Write-Output
