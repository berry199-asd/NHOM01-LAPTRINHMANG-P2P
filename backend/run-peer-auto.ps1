param(
    [Parameter(Mandatory = $true)][string]$Email,
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$Server = "http://127.0.0.1:9090",
    [string]$Ui = "48001",
    [string]$Port = "48310",
    [string]$Api = "48410",
    [string]$Udp = "0",
    [string]$Stun = "stun.l.google.com:19302",
    [switch]$RelayOnly
)
$ErrorActionPreference = "Stop"

$body = @{ email = $Email; password = $Password } | ConvertTo-Json
try {
    $login = Invoke-RestMethod -Uri "$Server/api/login" -Method Post -ContentType "application/json" -Body $body
} catch {
    Write-Error "[run-peer-auto] dang nhap that bai: $($_.Exception.Message)"
    exit 1
}
$token = $login.token
if (-not $token) {
    Write-Error "[run-peer-auto] khong lay duoc token tu /api/login"
    exit 1
}

if ($RelayOnly) { $env:PEER_RELAY_ONLY = "1" } else { $env:PEER_RELAY_ONLY = $null }

Write-Host "[run-peer-auto] ok user=$($login.user.username) ui=$Ui udp=$Udp relayOnly=$($RelayOnly.IsPresent)"
Write-Host "[run-peer-auto] Mo app va dam bao cung Peer UI port (VITE_PEER_UI_PORT=$Ui)"

$env:PEER_TOKEN = $token
$env:PEER_LISTEN_IP = "127.0.0.1"
$env:PEER_LISTEN_PORT = $Port
$env:PEER_API_PORT = $Api
$env:PEER_UI_PORT = $Ui
$env:PEER_UDP_PORT = $Udp
$env:PEER_STUN = $Stun
$env:PEER_SERVER_URL = $Server
& ".\gradlew.bat" peerRun
