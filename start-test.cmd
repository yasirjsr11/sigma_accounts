@echo off
cd /d "C:\xampp\htdocs\SH_PMS_TEST"

echo ========================================== >> "logs\test-node.log"
echo SH PMS TEST starting %date% %time% >> "logs\test-node.log"
echo ========================================== >> "logs\test-node.log"

:WAIT_DB
powershell -NoProfile -Command "exit ([int](-not (Test-NetConnection 127.0.0.1 -Port 3306 -InformationLevel Quiet)))"
if errorlevel 1 (
    echo Waiting for MariaDB... >> "logs\test-node.log"
    timeout /t 5 /nobreak >nul
    goto WAIT_DB
)

echo MariaDB ready. Starting TEST... >> "logs\test-node.log"
"C:\Program Files\nodejs\node.exe" --env-file=".env" server.js >> "logs\test-node.log" 2>&1