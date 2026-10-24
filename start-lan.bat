@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  MAY CHU: chay Tracker + Peer Core + web app (HTTPS) de test
rem  2 may qua ZeroTier/LAN. Chi may chu can chay script nay.
rem
rem  Web phuc vu HTTPS (chung chi tu ky) de trinh duyet cho phep
rem  mic/camera (goi thoai/video) khi truy cap qua IP LAN.
rem  Tracker van HTTP noi bo; web goi Tracker qua proxy /api cua Vite
rem  (cung origin => khong bi mixed content).
rem
rem  Dung: start-lan.bat [IP-hoac-URL-Tracker]
rem    - Khong tham so: tu do IP ZeroTier/LAN cua may nay lam IP dung chung.
rem    - Truyen IP (vd 192.168.192.174) hoac URL (http://192.168.192.174:9090).
rem
rem  May khach chay: start-client.bat <IP-may-chu>
rem  roi mo tren trinh duyet: https://<IP-may-chu>:8443
rem  (can chap nhan canh bao chung chi tu ky cua trinh duyet)
rem
rem  Ghi de them origin (neu can): dat EXTRA_ALLOWED_ORIGINS.
rem ============================================================
set "ROOT=%~dp0"
set "TARGET=%~1"
set "HOST_ONLY="

if "%TARGET%"=="" (
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%net-detect.ps1"`) do set "HOST_ONLY=%%i"
  if "!HOST_ONLY!"=="" (
    echo [lan] Khong do duoc IP ZeroTier/LAN. Hay truyen IP: start-lan.bat 192.168.192.174
    exit /b 1
  )
) else (
  for /f "usebackq delims=" %%l in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%resolve-target.ps1" -Target "%TARGET%"`) do set "%%l"
  if "!HOST_ONLY!"=="" (
    echo [lan] Tham so khong hop le: %TARGET%
    exit /b 1
  )
)

set "TRACKER_HTTP=http://!HOST_ONLY!:9090"
set "WEB_URL=https://!HOST_ONLY!:8443"

rem  Tao chung chi TLS tu ky neu chua co (cert.pem + key.pem trong tls\).
set "TLS_DIR=%ROOT%tls"
if not exist "%TLS_DIR%\cert.pem" (
  echo [lan] Chua co chung chi TLS - dang tao chung chi tu ky...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%make-cert.ps1" -Names "localhost,127.0.0.1,!HOST_ONLY!"
  if not exist "%TLS_DIR%\cert.pem" (
    echo [lan] Khong tao duoc chung chi TLS. Can Git for Windows/OpenSSL. Dung lai.
    exit /b 1
  )
)
set "VITE_TLS_CERT=%TLS_DIR%\cert.pem"
set "VITE_TLS_KEY=%TLS_DIR%\key.pem"

set "ORIGINS=https://!HOST_ONLY!:8443,https://localhost:8443,http://localhost:8443,http://127.0.0.1:8443,http://!HOST_ONLY!:8443"
if not "%EXTRA_ALLOWED_ORIGINS%"=="" set "ORIGINS=!ORIGINS!,%EXTRA_ALLOWED_ORIGINS%"

set "TRACKER_PORT=9090"
set "TRACKER_HEARTBEAT_PORT=9091"
rem  Mac dinh dev de Tracker in OTP ra console khi chua cau hinh SMTP (ghi de: dat APP_ENV truoc khi chay).
if "%APP_ENV%"=="" set "APP_ENV=dev"
set "CORS_ALLOW_ORIGIN=!ORIGINS!"
set "PEER_SERVER_URL=!TRACKER_HTTP!"
set "PEER_LISTEN_IP=!HOST_ONLY!"
set "PEER_UI_ALLOWED_ORIGINS=!ORIGINS!"
rem  FE goi Tracker qua chinh origin web (Vite proxy /api -> Tracker HTTP).
set "VITE_API_URL=!WEB_URL!"
set "VITE_API_PROXY_TARGET=!TRACKER_HTTP!"
set "VITE_APP_URL=!WEB_URL!"

echo [lan] IP dung chung : !HOST_ONLY!
echo [lan] Tracker       : !TRACKER_HTTP!  (HTTP noi bo, web proxy qua /api)
echo [lan] Web           : !WEB_URL!
echo [lan] CORS/Origin   : !ORIGINS!
echo.

start "workchat-tracker" cmd /k call "%ROOT%start-tracker.bat" 9090
timeout /t 2 /nobreak >nul
start "workchat-peer" cmd /k call "%ROOT%start-peercore.bat"
echo [lan] Dang mo web app (Vite HTTPS) tren cong 8443...
call npm run dev -- --host 0.0.0.0 --port 8443
endlocal
