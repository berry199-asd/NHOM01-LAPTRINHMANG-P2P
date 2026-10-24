param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Port = "48310",
    [string]$Api = "48410",
    [string]$Ui = "",
    [string]$Ip = "127.0.0.1",
    [string]$Udp = "0",
    [string]$Stun = "stun.l.google.com:19302",
    [string]$Server = "http://127.0.0.1:9090"
)
$ErrorActionPreference = "Stop"
$env:PEER_TOKEN = $Token
$env:PEER_LISTEN_IP = $Ip
$env:PEER_LISTEN_PORT = $Port
$env:PEER_API_PORT = $Api
$env:PEER_UI_PORT = $Ui
$env:PEER_UDP_PORT = $Udp
$env:PEER_STUN = $Stun
$env:PEER_SERVER_URL = $Server
$uiInfo = if ($Ui) { " ui=127.0.0.1:$Ui`/ui" } else { "" }
Write-Host "[run-peer] mesh=$Ip`:$Port api=127.0.0.1`:$Api udp=$Udp$uiInfo token=***"
& ".\gradlew.bat" peerRun