@echo off
rem ============================================================
rem  Start Peer Core (M3): khong can tham so.
rem  - Tu chon cong UI trong 48001-48010 (< 49152, tranh dai cong dong cua Windows).
rem    Web tu do ca dai 48001-48010 nen khong can cau hinh gi them.
rem    Nhieu tai khoan tren 1 may: chay start-cores.bat (mo san nhieu core).
rem  - Khoi dong o trang thai UNBOUND; mo web app, dang nhap; web tu gan (bind).
rem  - Dat PEER_SERVER_URL neu Tracker khong o 127.0.0.1:9090.
rem  - Cac co --server/--port/--api/--token chi de debug.
rem ============================================================
setlocal enabledelayedexpansion
if "%PEER_SERVER_URL%"=="" set "PEER_SERVER_URL=http://127.0.0.1:9090"
set "ROOT=%~dp0"
set "LIB=%ROOT%backend\build\install\workchat-tracker\lib"

rem  Origin duoc phep cho UI WS. Web co the mo bang http HOAC https (LAN),
rem  nen mac dinh cho phep loopback + IP may nay (ca http lan https).
rem  Ghi de bang cach dat PEER_UI_ALLOWED_ORIGINS truoc khi chay.
if "%PEER_UI_ALLOWED_ORIGINS%"=="" (
  set "PEER_UI_ALLOWED_ORIGINS=http://localhost:8443,http://127.0.0.1:8443,https://localhost:8443,https://127.0.0.1:8443"
  set "LANIP="
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%net-detect.ps1"`) do if not "%%i"=="" set "LANIP=%%i"
  if not "!LANIP!"=="" set "PEER_UI_ALLOWED_ORIGINS=!PEER_UI_ALLOWED_ORIGINS!,http://!LANIP!:8443,https://!LANIP!:8443"
)
if "%PEER_LISTEN_IP%"=="" (
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%net-detect.ps1"`) do if not "%%i"=="" set "PEER_LISTEN_IP=%%i"
)
if "%PEER_SERVER_URL%"=="http://127.0.0.1:9090" (
  if not "%PEER_LISTEN_IP%"=="" set "PEER_SERVER_URL=http://%PEER_LISTEN_IP%:9090"
)

rem  Kenh UDP truc tiep (dut lo NAT) cho tin nhan. Khong dat PEER_UDP_PORT thi PeerCoreCli
rem  mac dinh -1 = TAT UDP -> tin phai di qua Relay/hop thu Tracker (cham). Dat "off" de tat.
if "%PEER_UDP_PORT%"=="" set "PEER_UDP_PORT=48150"
rem  STUN mac dinh da co trong PeerCoreCli (stun.l.google.com:19302); dat day de ghi de/neu can.
if "%PEER_STUN%"=="" set "PEER_STUN=stun.l.google.com:19302,stun1.l.google.com:19302"

if not exist "%LIB%\*.jar" (
  echo [peer] Chua build, dang chay installDist...
  pushd "%ROOT%backend"
  call gradlew.bat installDist
  popd
  if not exist "%LIB%\*.jar" (
    echo [peer] Build that bai. Kiem tra Java/Gradle trong backend.
    exit /b 1
  )
)

if exist "%ROOT%backend\build\libs\workchat-tracker-0.1.0.jar" (
  copy /y "%ROOT%backend\build\libs\workchat-tracker-0.1.0.jar" "%LIB%\workchat-tracker-0.1.0.jar" >nul 2>&1
)

echo [peer] Tracker: %PEER_SERVER_URL%
chcp 65001 >nul
java -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -cp "%LIB%\*" com.workchat.peer.cli.PeerCoreCli %*
