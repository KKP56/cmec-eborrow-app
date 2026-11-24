@echo off
title CMEC E-Borrow Backup
cd /d "%~dp0"
rem Optional: put backups on another drive / keep a different number of copies
rem set BACKUP_DIR=E:\eborrow-backups
rem set BACKUP_KEEP=30
call npm.cmd run backup
rem Pause only when double-clicked (Task Scheduler passes "auto")
if "%1"=="" pause
