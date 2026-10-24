@echo off
setlocal
rem ============================================================
rem  Start NHIEU Peer Core tren cung 1 may (test nhieu tai khoan).
rem  Dung: start-cores.bat [N]   (mac dinh N=2 -> cong 48001, 48002)
rem  Web tu do ca dai 48001-48010 nen moi trinh duyet tu tim dung
rem  cong cua tai khoan minh (core gan tai khoan khac se bi bo qua).
rem  Dat PEER_SERVER_URL neu Tracker khong o 127.0.0.1:9090.
rem
rem  Core duoc mo TACH NEN (an, khong cua so) qua peer-cores.ps1 nen
rem  KHONG chet theo cua so console nay. Dong cua so nay an toan.
rem  (peer-cores.ps1 tu dat origin cho UI WS: http+https loopback + IP may.)
rem ============================================================
set "N=%~1"
if "%N%"=="" set "N=2"
set "ROOT=%~dp0"
if "%PEER_SERVER_URL%"=="" set "PEER_SERVER_URL=http://127.0.0.1:9090"

echo [peer] Tracker: %PEER_SERVER_URL%
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%peer-cores.ps1" -Count %N%
endlocal
