@echo off
cd /d "C:\Users\Admin\Documents\Pivotr\Marketing Material\TermiSend"
"C:\Users\Admin\.bun\bin\bun.exe" "C:\Users\Admin\Documents\Pivotr\Marketing Material\TermiSend\dist\index.js"
set TERMISEND_EXIT_CODE=%ERRORLEVEL%
echo.
if not "%TERMISEND_EXIT_CODE%"=="0" echo TermiSend exited with code %TERMISEND_EXIT_CODE%.