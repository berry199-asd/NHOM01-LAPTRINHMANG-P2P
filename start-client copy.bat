@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  MAY KHACH: chay Peer Core tro toi Tracker cua may chu.
rem  Khong chay web o day - mo bang trinh duyet:
rem      https://<IP-may-chu>:8443   (chap nhan canh bao chung chi tu ky)
rem
rem  Dung: start-client.bat <IP-hoac-URL-Tracker>
rem    vd: start-client.bat 192.168.192.174
rem        start-client.bat http://192.168.192.174:9090
rem ============================================================
set "ROOT=%~dp0"
set "TARGET=%~1"
if "%TARGET%"=="" (
  echo [client] Thieu tham so. Dung: start-client.bat 192.168.192.174
  exit /b 1
)
set "HOST_ONLY="
set "TRACKER_URL="
for /f "usebackq delims=" %%l in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%resolve-target.ps1" -Target "%TARGET%"`) do set "%%l"
if "!HOST_ONLY!"=="" (
  echo [client] Tham so khong hop le: %TARGET%
  exit /b 1
)

set "LOCALIP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%net-detect.ps1" -TargetIp "!HOST_ONLY!"`) do set "LOCALIP=%%i"
if "!LOCALIP!"=="" set "LOCALIP=127.0.0.1"

set "ORIGINS=https://!HOST_ONLY!:8443,https://localhost:8443,http://localhost:8443,http://127.0.0.1:8443,http://!HOST_ONLY!:8443"
if not "%EXTRA_ALLOWED_ORIGINS%"=="" set "ORIGINS=!ORIGINS!,%EXTRA_ALLOWED_ORIGINS%"

set "PEER_SERVER_URL=!TRACKER_URL!"
set "PEER_LISTEN_IP=!LOCALIP!"
set "PEER_UI_ALLOWED_ORIGINS=!ORIGINS!"

echo [client] Tracker    : !TRACKER_URL!
echo [client] Lang nghe   : !LOCALIP!
echo [client] Mo trinh duyet: https://!HOST_ONLY!:8443
echo.
start "workchat-peer" cmd /k call "%ROOT%start-peercore.bat"
endlocal
