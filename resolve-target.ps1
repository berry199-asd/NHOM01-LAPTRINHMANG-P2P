# resolve-target.ps1
# Chuan hoa tham so <IP-hoac-URL-Tracker> thanh 2 dong KEY=VALUE de .bat doc bang "set".
#
# Dung:
#   powershell -NoProfile -ExecutionPolicy Bypass -File resolve-target.ps1 -Target 192.168.192.174
#   powershell -NoProfile -ExecutionPolicy Bypass -File resolve-target.ps1 -Target http://192.168.192.174:9090
#
# In ra:
#   HOST_ONLY=192.168.192.174
#   TRACKER_URL=http://192.168.192.174:9090

param(
  [Parameter(Mandatory = $true)][string]$Target
)

$t = $Target.Trim()
$scheme = ""
if ($t -match '^(?i)(https?://)(.*)$') {
  $scheme = $Matches[1].ToLower()
  $t = $Matches[2]
}
$hostOnly = ($t -split '[/:]')[0]
if ([string]::IsNullOrWhiteSpace($hostOnly)) {
  Write-Error "Tham so khong hop le: $Target"
  exit 1
}

if ($scheme -ne "") {
  $rest = $t
  if ($rest -notmatch ':') { $rest = "$hostOnly" + ":9090" }
  $url = "$scheme$rest"
} else {
  $url = "http://$hostOnly" + ":9090"
}

Write-Output ("HOST_ONLY=" + $hostOnly)
Write-Output ("TRACKER_URL=" + $url)
