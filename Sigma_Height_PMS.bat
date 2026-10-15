@echo off
title Sigma Height PMS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules" goto install
goto run

:install
echo Installing required components for the first time, please wait...
echo This can take a minute or two. Do not close this window.
echo.
call npm install
if errorlevel 1 goto installfail
goto run

:run
echo.
echo Starting Sigma Height PMS...
echo Once you see "running on http://localhost:4000", your browser will open automatically.
echo Keep this window open while you are using the system. Closing it will stop the system.
echo.
start "" cmd /c "timeout /t 3 >nul && start http://localhost:4000"
node server.js
echo.
echo The system has stopped.
pause
goto end

:nonode
echo.
echo ============================================================
echo  Node.js was not found on this computer.
echo  Please install Node.js (version 22 or newer) from:
echo  https://nodejs.org/
echo  Then double-click this file again.
echo ============================================================
echo.
pause
goto end

:installfail
echo.
echo ============================================================
echo  Setup failed while installing required components.
echo  Check that you have an internet connection, then try again.
echo  If this keeps failing, send this window's text to support.
echo ============================================================
echo.
pause
goto end

:end
