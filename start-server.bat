@echo off
title CMEC E-Borrow App Server
cd /d "%~dp0"
echo Starting CMEC E-Borrow App on port 3000...
echo Close this window to stop the server.
echo.
call npm.cmd start
pause
