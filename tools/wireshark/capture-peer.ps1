# capture-peer.ps1 - Capture packets for the P2P data-plane verification scenario.
#
# Usage:
#   .\capture-peer.ps1                         # auto interface, 60s -> captures\peer.pcapng
#   .\capture-peer.ps1 -Seconds 120
#   .\capture-peer.ps1 -Interface 12           # pick index from "tshark -D"
#   .\capture-peer.ps1 -ListOnly               # list interfaces and exit
#   .\capture-peer.ps1 -CaptureFilter "udp or tcp port 9090"
#
# After capture, open captures\peer.pcapng in Wireshark or run analyze-peer.ps1.

param(
    [string]$Interface = "",
    [string]$Out = (Join-Path $PSScriptRoot "..\..\captures\peer.pcapng"),
    [int]$Seconds = 60,
    [string]$CaptureFilter = "udp or tcp port 9090",
    [switch]$ListOnly
)

$ErrorActionPreference = "Stop"

function Find-Tool([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "C:\Program Files\Wireshark\$Name.exe",
        "C:\Program Files (x86)\Wireshark\$Name.exe"
    )
    foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return $c } }
    return $null
}

$tshark = Find-Tool "tshark"
if (-not $tshark) {
    Write-Host "tshark not found. Install Wireshark (with Npcap) then retry:" -ForegroundColor Yellow
    Write-Host "  https://www.wireshark.org/download.html"
    Write-Host "Or add 'C:\Program Files\Wireshark' to PATH."
    exit 1
}

Write-Host "tshark: $tshark"
if ($ListOnly) {
    & $tshark -D
    exit 0
}

$outDir = Split-Path -Parent $Out
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$ifArg = @()
if ($Interface -ne "") { $ifArg = @("-i", $Interface) }
else { Write-Host "No -Interface given: using tshark default. Run 'tshark -D' to choose by index/name." -ForegroundColor Cyan }

Write-Host "Capturing $Seconds s, filter='$CaptureFilter' -> $Out"
Write-Host "Tip: run the scenario in README.md (send chat, UDP hole punch, Relay check) during capture."
Write-Host "Press Ctrl+C to stop early."

& $tshark @ifArg -f $CaptureFilter -a duration:$Seconds -w $Out
$code = $LASTEXITCODE
if ($code -eq 0) {
    Write-Host "Done. File: $Out" -ForegroundColor Green
    Write-Host "Quick analysis: .\analyze-peer.ps1 -Pcap `"$Out`""
} else {
    Write-Host "tshark exited with code $code (usually missing admin rights or wrong interface)." -ForegroundColor Yellow
    Write-Host "Retry with 'Run as administrator' or pass -Interface from 'tshark -D'."
}
exit $code
