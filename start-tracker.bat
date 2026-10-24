@echo off
setlocal
rem ============================================================
rem  Start Tracker (Discovery/Signaling/Mailbox + Heartbeat UDP).
rem  Dung: start-tracker.bat [PORT]   (mac dinh 9090)
rem  Dat TRACKER_HEARTBEAT_PORT / CORS_ALLOW_ORIGIN / DB_* neu can.
rem  CORS_ALLOW_ORIGIN co the la mot origin hoac danh sach ngan cach dau phay.
rem ============================================================
set "ROOT=%~dp0"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=%TRACKER_PORT%"
if "%PORT%"=="" set "PORT=9090"
set "TRACKER_PORT=%PORT%"
if "%TRACKER_HEARTBEAT_PORT%"=="" set "TRACKER_HEARTBEAT_PORT=9091"
set "LIB=%ROOT%backend\build\install\workchat-tracker\lib"

rem Tu dong dung JDK 22 neu he thong dang tro vao JDK khong tuong thich Gradle
if exist "C:\Program Files\Java\jdk-22" (
  set "JAVA_HOME=C:\Program Files\Java\jdk-22"
  set "PATH=C:\Program Files\Java\jdk-22\bin;%PATH%"
)

rem Cau hinh Google SMTP cho OTP
if "%SMTP_HOST%"=="" set "SMTP_HOST=smtp.gmail.com"
if "%SMTP_PORT%"=="" set "SMTP_PORT=587"
if "%MAIL_USERNAME%"=="" set "MAIL_USERNAME=phamngocthuan1123@gmail.com"
if "%MAIL_PASSWORD%"=="" set "MAIL_PASSWORD=kwnx onkl omrt rxwk"

if not exist "%LIB%\*.jar" (
  echo [tracker] Chua build, dang chay installDist...
  pushd "%ROOT%backend"
  call gradlew.bat installDist
  popd
  if not exist "%LIB%\*.jar" (
    echo [tracker] Build that bai. Kiem tra Java/Gradle trong backend.
    exit /b 1
  )
)

echo [tracker] HTTP :%TRACKER_PORT%  UDP heartbeat :%TRACKER_HEARTBEAT_PORT%  CORS=%CORS_ALLOW_ORIGIN%
echo [tracker] Mail OTP: %MAIL_USERNAME% via %SMTP_HOST%:%SMTP_PORT%
java -Dfile.encoding=UTF-8 -cp "%LIB%\*" com.workchat.tracker.TrackerServer
endlocal
