@echo off
setlocal
set "INSTALL_DIR=%LOCALAPPDATA%\iticket-monitor"
set "SOURCE_EXE=%~dp0iticket-monitor-widget.exe"
set "TARGET_EXE=%INSTALL_DIR%\iticket-monitor-widget.exe"

if not exist "%SOURCE_EXE%" goto SOURCE_MISSING
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if errorlevel 1 goto INSTALL_FAILED
copy /Y "%SOURCE_EXE%" "%TARGET_EXE%" > nul
if errorlevel 1 goto INSTALL_FAILED
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "iTicketMonitorWidget" /t REG_SZ /d "%TARGET_EXE%" /f > nul
if errorlevel 1 goto STARTUP_FAILED
start "" "%TARGET_EXE%"
echo.
echo iTicket Monitor Widget installation completed.
echo The widget is starting now and will run automatically at Windows sign-in.
echo.
pause
exit /b 0

:SOURCE_MISSING
echo.
echo [ERROR] iticket-monitor-widget.exe was not found.
echo Extract every file from the ZIP into one folder, then run install.cmd again.
echo.
pause
exit /b 1

:INSTALL_FAILED
echo.
echo [ERROR] The widget could not be copied to:
echo %INSTALL_DIR%
echo Try extracting the ZIP again and run install.cmd.
echo.
pause
exit /b 1

:STARTUP_FAILED
echo.
echo [ERROR] The widget was copied, but Windows startup registration failed.
echo You can run this file directly:
echo %TARGET_EXE%
echo.
pause
exit /b 1
