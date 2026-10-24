# net-detect.ps1
# Tim IPv4 cuc bo de lang nghe / ghep noi trong cung mang voi mot IP dich.
#
# Dung:
#   powershell -NoProfile -ExecutionPolicy Bypass -File net-detect.ps1 -TargetIp 192.168.192.174
#   powershell -NoProfile -ExecutionPolicy Bypass -File net-detect.ps1        # tu chon IP ZeroTier/LAN
#
# In ra MOT dia chi IPv4 (khong in gi neu khong tim thay).

param(
  [string]$TargetIp = ""
)

$ErrorActionPreference = "SilentlyContinue"

function Get-Ipv4List {
  Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
    Sort-Object SkipAsSource, InterfaceMetric |
    Select-Object -ExpandProperty IPAddress
}

$ips = Get-Ipv4List
if (-not $ips) { exit 0 }

if ($TargetIp) {
  $bytes = $null
  try { $bytes = ([System.Net.IPAddress]::Parse($TargetIp)).GetAddressBytes() } catch { $bytes = $null }
  if ($bytes) {
    $prefix = "$($bytes[0]).$($bytes[1]).$($bytes[2])."
    $same = $ips | Where-Object { $_ -like "$prefix*" } | Select-Object -First 1
    if ($same) { Write-Output $same; exit 0 }
  }
}

# Uu tien dai ZeroTier mac dinh, roi 192.168.x, roi 10.x.
$pick = $ips | Where-Object { $_ -like "192.168.192.*" } | Select-Object -First 1
if (-not $pick) { $pick = $ips | Where-Object { $_ -like "192.168.*" } | Select-Object -First 1 }
if (-not $pick) { $pick = $ips | Where-Object { $_ -like "10.*" } | Select-Object -First 1 }
if (-not $pick) { $pick = $ips | Select-Object -First 1 }
Write-Output $pick
