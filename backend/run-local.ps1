$ErrorActionPreference = "Stop"

$env:TRACKER_PORT = "9090"
$env:DB_URL = "jdbc:mysql://127.0.0.1:3306/workchat?useSSL=false&serverTimezone=Asia/Ho_Chi_Minh&characterEncoding=UTF-8&connectionCollation=utf8mb4_unicode_ci&rewriteBatchedStatements=true"
$env:DB_USER = "root"
$env:DB_PASSWORD = ""
$env:SMTP_HOST = "smtp.gmail.com"
$env:SMTP_PORT = "587"
$env:MAIL_USERNAME = "phamngocthuan1123@gmail.com"
$env:MAIL_PASSWORD = "kwnx onkl omrt rxwk"
$env:OTP_TTL_MINUTES = "10"
$env:OTP_DEBUG = "true"
$env:APP_ENV = "dev"
$env:SEED_ADMIN_EMAIL = "admin@workchat.vn"
$env:SEED_ADMIN_PASSWORD = "Admin@123456"

if (Test-Path "C:\Program Files\Java\jdk-22") {
    $env:JAVA_HOME = "C:\Program Files\Java\jdk-22"
    $env:Path = "C:\Program Files\Java\jdk-22\bin;" + $env:Path
}

Write-Host "[run-local] Tracker da chay? Neu port 9090 dang dung => stop truoc."
& ".\gradlew.bat" run