@echo off
echo ====================================================
echo   DANG MO CAC CONG TUONG LUA CHO HE THONG WORKCHAT
echo ====================================================

:: Yeu cau quyen Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [LOI] Vui long chay file nay bang quyen Run as Administrator!
    pause
    exit /b 1
)

:: Mo cong HTTPS Web Client (8443 TCP)
netsh advfirewall firewall add rule name="WorkChat Web HTTPS 8443" dir=in action=allow protocol=TCP localport=8443

:: Mo cong Tracker Server HTTP (9090 TCP)
netsh advfirewall firewall add rule name="WorkChat Tracker HTTP 9090" dir=in action=allow protocol=TCP localport=9090

:: Mo cong Tracker Heartbeat UDP (9091 UDP)
netsh advfirewall firewall add rule name="WorkChat Heartbeat UDP 9091" dir=in action=allow protocol=UDP localport=9091

:: Mo dai cong P2P Transfer & Media (9000-9100 TCP & UDP)
netsh advfirewall firewall add rule name="WorkChat P2P Direct TCP" dir=in action=allow protocol=TCP localport=9000-9100
netsh advfirewall firewall add rule name="WorkChat P2P Direct UDP" dir=in action=allow protocol=UDP localport=9000-9100

echo ====================================================
echo   MO CONG TUONG LUA HOAN TAT! CAC MAY TRONG LAN CO THE KET NOI.
echo ====================================================
pause