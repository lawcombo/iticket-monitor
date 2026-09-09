@echo off
chcp 65001 > nul
set "INSTALL_DIR=%LOCALAPPDATA%\iticket-monitor"

taskkill /IM "iticket-monitor-widget.exe" /F > nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "iTicketMonitorWidget" /f > nul 2>&1
del /Q "%INSTALL_DIR%\iticket-monitor-widget.exe" > nul 2>&1

echo.
echo iTicket 서버 모니터 위젯이 제거되었습니다.
echo 기존 설정 파일은 %INSTALL_DIR%에 보관됩니다.
echo.
pause
