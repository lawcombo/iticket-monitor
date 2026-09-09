@echo off
setlocal
set "INSTALL_DIR=%LOCALAPPDATA%\iticket-monitor"

taskkill /IM "iticket-monitor-widget.exe" /F > nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "iTicketMonitorWidget" /f > nul 2>&1
del /Q "%INSTALL_DIR%\iticket-monitor-widget.exe" > nul 2>&1

echo.
echo iTicket Monitor Widget was removed.
echo Existing settings remain in %INSTALL_DIR%.
echo.
pause
