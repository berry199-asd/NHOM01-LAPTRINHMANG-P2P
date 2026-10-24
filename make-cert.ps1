# make-cert.ps1 - Tao chung chi TLS tu ky (PEM) de chay web HTTPS trong LAN.
#
# Vi sao can: trinh duyet chi cho phep getUserMedia (mic/camera de goi thoai/
# video) tren "secure context" - HTTPS hoac localhost. Khi truy cap web qua IP
# LAN, phai phuc vu HTTPS thi tinh nang goi moi chay duoc.
#
# Dung:
#   powershell -ExecutionPolicy Bypass -File make-cert.ps1 -Names "localhost,127.0.0.1,192.168.192.174"
#   (mac dinh: tao cho localhost + 127.0.0.1)
#
# Ket qua: tls\cert.pem + tls\key.pem (KHONG commit vao repo).
# Chung chi tu ky se bi trinh duyet canh bao - can chap nhan hoac cai dat tin cay.

param(
    [string[]]$Names = @("localhost", "127.0.0.1"),
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $PSScriptRoot "tls"
}

# Tim openssl: tren PATH, hoac ban di kem Git for Windows.
$openssl = $null
$cmd = Get-Command openssl -ErrorAction SilentlyContinue
if ($cmd) {
    $openssl = $cmd.Source
}
if (-not $openssl) {
    $candidates = @(
        "C:\Program Files\Git\usr\bin\openssl.exe",
        "C:\Program Files (x86)\Git\usr\bin\openssl.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p) { $openssl = $p; break }
    }
}
if (-not $openssl) {
    Write-Error "Khong tim thay openssl. Hay cai Git for Windows (co san openssl) hoac OpenSSL, roi thu lai."
    exit 1
}

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$certPath = Join-Path $OutDir "cert.pem"
$keyPath = Join-Path $OutDir "key.pem"

# Xay subjectAltName: IP: cho dia chi IP, DNS: cho ten mien/ten may.
# Names co the duoc truyen dang 1 chuoi "a,b,c" hoac mang -> tach theo dau phay.
$nameList = @()
foreach ($raw in $Names) {
    foreach ($part in ($raw -split ',')) {
        $t = $part.Trim()
        if (-not [string]::IsNullOrWhiteSpace($t)) { $nameList += $t }
    }
}
if ($nameList.Count -eq 0) { $nameList = @("localhost") }

$sanParts = @()
foreach ($t in $nameList) {
    if ($t -match '^[0-9]{1,3}(\.[0-9]{1,3}){3}$') {
        $sanParts += "IP:$t"
    } else {
        $sanParts += "DNS:$t"
    }
}
$san = ($sanParts -join ",")

$cn = $nameList[0]
if ([string]::IsNullOrWhiteSpace($cn)) { $cn = "localhost" }

Write-Host "[cert] openssl: $openssl"
Write-Host "[cert] CN=$cn  SAN=$san"
Write-Host "[cert] -> $certPath , $keyPath"

& $openssl req -x509 -newkey rsa:2048 -nodes -days 397 `
    -keyout "$keyPath" -out "$certPath" `
    -subj "/CN=$cn" -addext "subjectAltName=$san" 2>$null

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $certPath)) {
    Write-Error "openssl that bai (ma $LASTEXITCODE). Kiem tra tham so -Names."
    exit 1
}

Write-Host "[cert] Xong. Bat TLS bang cach dat VITE_TLS_CERT/VITE_TLS_KEY (web) va TLS_ENABLED/TLS_CERT_FILE/TLS_KEY_FILE (Tracker)."
