# analyze-peer.ps1 - Quick analysis of a P2P data-plane pcap (requires tshark).
#
# Usage:
#   .\analyze-peer.ps1 -Pcap ..\..\captures\peer.pcapng
#   .\analyze-peer.ps1 -Pcap peer.pcapng -Plaintext "your chat text"
#
# Prints: STUN count, heartbeat UDP, UDP punch/data packets, WebSocket Relay frames,
# and checks the chat content does NOT appear as plaintext (AES-GCM encrypted).

param(
    [Parameter(Mandatory = $true)][string]$Pcap,
    [string]$Plaintext = "di qua relay"
)

$ErrorActionPreference = "Stop"

function Find-Tool([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in @("C:\Program Files\Wireshark\$Name.exe", "C:\Program Files (x86)\Wireshark\$Name.exe")) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

$tshark = Find-Tool "tshark"
if (-not $tshark) {
    Write-Host "tshark not found. Install Wireshark (with Npcap) then retry." -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path -LiteralPath $Pcap)) { Write-Host "File not found: $Pcap" -ForegroundColor Red; exit 1 }

function Count-Match([string]$DisplayFilter) {
    $n = (& $tshark -r $Pcap -Y $DisplayFilter -T fields -e frame.number 2>$null | Measure-Object -Line).Lines
    return [int]$n
}

Write-Host ""
Write-Host "=== Analysis: $Pcap ===" -ForegroundColor Cyan
Write-Host ("STUN (binding request/response)          : {0}" -f (Count-Match "stun"))
Write-Host ("Heartbeat UDP -> Tracker :9091           : {0}" -f (Count-Match "udp.port==9091"))
Write-Host ("UDP punch / keepalive (9-byte payload)   : {0}" -f (Count-Match "udp && !stun && udp.port!=9091 && udp.length==17"))
Write-Host ("UDP app data (>9-byte payload)           : {0}" -f (Count-Match "udp && !stun && udp.port!=9091 && udp.length>17"))
Write-Host ("Relay over WebSocket (Tracker :9090)     : {0}" -f (Count-Match "tcp.port==9090 && websocket"))
Write-Host ("Total WebSocket frames                   : {0}" -f (Count-Match "websocket"))

Write-Host ""
Write-Host "=== Sample STUN frames ===" -ForegroundColor Cyan
& $tshark -r $Pcap -Y "stun" -T fields -e ip.src -e ip.dst -e udp.srcport -e udp.dstport -e stun.type 2>$null | Select-Object -First 6

Write-Host ""
Write-Host "=== Sample UDP punch packets (src/dst) ===" -ForegroundColor Cyan
& $tshark -r $Pcap -Y "udp && !stun && udp.port!=9091 && udp.length==17" -T fields -e ip.src -e udp.srcport -e ip.dst -e udp.dstport 2>$null | Select-Object -First 8

Write-Host ""
Write-Host "=== Encryption check: is plaintext leaked? ===" -ForegroundColor Cyan
Write-Host ("Searching for string '{0}' in the whole capture" -f $Plaintext)
$leaked = Count-Match ('frame contains \"{0}\"' -f $Plaintext)
if ($leaked -eq 0) {
    Write-Host "  OK: no plaintext found -> content is AES-GCM encrypted." -ForegroundColor Green
} else {
    Write-Host ("  WARNING: found {0} frames containing plaintext!" -f $leaked) -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Wireshark filter cheatsheet:" -ForegroundColor Cyan
Write-Host "  stun"
Write-Host "  udp && !stun && udp.port!=9091           # hole punch + P2P data"
Write-Host "  udp.length==17                            # punch/keepalive packets"
Write-Host "  tcp.port==9090 && websocket               # Relay control-plane"
Write-Host "  tcp.port==9090 && websocket && data       # JSON wrapper, payload is base64 ciphertext"
