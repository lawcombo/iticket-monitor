@echo off
chcp 65001 > nul
set "INSTALL_DIR=%LOCALAPPDATA%\iticket-monitor"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0iticket-monitor-widget.exe" "%INSTALL_DIR%\iticket-monitor-widget.exe" > nul

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "iTicketMonitorWidget" /t REG_SZ /d "\"%INSTALL_DIR%\iticket-monitor-widget.exe\"" /f > nul

start "" "%INSTALL_DIR%\iticket-monitor-widget.exe"
echo.
echo iTicket 서버 모니터 위젯 설치가 완료되었습니다.
echo Windows에 로그인하면 자동으로 실행됩니다.
echo.
pause
