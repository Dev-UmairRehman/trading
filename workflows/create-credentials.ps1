$ErrorActionPreference = 'Stop'
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
function Get-EnvVal($name) {
  $line = (Get-Content $envFile | Select-String "^$name=").Line
  if ($line) { return $line -replace "^$name=",'' }
  return $null
}

$n8nKey = Get-EnvVal 'N8N_API_KEY'
$apolloKey = Get-EnvVal 'APOLLO_API_KEY'
$googleId = Get-EnvVal 'GOOGLE_CLIENT_ID'
$googleSecret = Get-EnvVal 'GOOGLE_CLIENT_SECRET'
$linkedinId = Get-EnvVal 'LINKEDIN_CLIENT_ID'
$linkedinSecret = Get-EnvVal 'LINKEDIN_CLIENT_SECRET'

$base = 'http://localhost:5678/api/v1/credentials'
$headers = @{ 'X-N8N-API-KEY' = $n8nKey; 'Content-Type' = 'application/json' }

function New-Cred($name, $type, $data) {
  $body = @{ name = $name; type = $type; data = $data } | ConvertTo-Json -Depth 5 -Compress
  try {
    $r = Invoke-RestMethod -Uri $base -Method POST -Headers $headers -Body $body
    return [PSCustomObject]@{ Name = $name; Type = $type; Id = $r.id; Status = 'OK' }
  } catch {
    $msg = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    return [PSCustomObject]@{ Name = $name; Type = $type; Id = ''; Status = "ERR: $msg" }
  }
}

$results = @()
$gData = @{ clientId = $googleId; clientSecret = $googleSecret; useDynamicClientRegistration = $false }
$lData = @{ clientId = $linkedinId; clientSecret = $linkedinSecret; useDynamicClientRegistration = $false }

$results += New-Cred 'Gmail account' 'gmailOAuth2' $gData
$results += New-Cred 'Google Sheets account' 'googleSheetsOAuth2Api' $gData
$results += New-Cred 'LinkedIn account' 'linkedInOAuth2Api' $lData

$results | Format-Table -AutoSize | Out-String | Write-Output
