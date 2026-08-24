@echo off
rem JoyChat daily start (Windows / HTTPS)
rem Double-click to start. Close this window to stop the service.
cd /d "%~dp0..\.."
echo.
echo Starting JoyChat...
echo Open the HTTPS address shown below in your browser.
echo First visit: click "Advanced" - "Continue to site" once.
echo Close this window to stop the service.
echo.
node --env-file-if-exists=.env index.js
echo.
echo Service stopped.
pause
