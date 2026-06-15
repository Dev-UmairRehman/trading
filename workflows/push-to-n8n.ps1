$ErrorActionPreference = 'Stop'
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$key = (Get-Content $envFile | Select-String '^N8N_API_KEY=').Line -replace '^N8N_API_KEY=',''
$base = 'http://localhost:5678/api/v1'
$headers = @{ 'X-N8N-API-KEY' = $key; 'Content-Type' = 'application/json' }

$folder = Join-Path $PSScriptRoot '4J2rC9Eo2E0GqRHp'
$files = @('1-cold-email-outreach.json','2-linkedin-daily-poster.json','3-auto-reply-proposal.json')

$results = @()
foreach ($f in $files) {
  $path = Join-Path $folder $f
  $raw = Get-Content $path -Raw -Encoding UTF8
  $obj = $raw | ConvertFrom-Json

  try {
    $resp = Invoke-RestMethod -Uri "$base/workflows" -Method POST -Headers $headers -Body $raw
    $results += [PSCustomObject]@{ File = $f; Id = $resp.id; Name = $resp.name; Status = 'CREATED' }
  } catch {
    $msg = $_.Exception.Message
    if ($_.ErrorDetails) { $msg = $_.ErrorDetails.Message }
    $results += [PSCustomObject]@{ File = $f; Id = ''; Name = $obj.name; Status = "ERR: $msg" }
  }
}

$results | Format-Table -AutoSize | Out-String | Write-Output
