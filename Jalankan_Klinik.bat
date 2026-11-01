@echo off
title Server Lokal Klinik Keuangan & Layar TV
cd /d "%~dp0"
echo ========================================================
echo Membuka Aplikasi Klinik Keuangan Pratama...
echo Menjalankan Web Server Lokal agar Layar TV Bebas Error 153
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause