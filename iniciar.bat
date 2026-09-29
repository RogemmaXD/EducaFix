@echo off
title Mi Agenda - Educalinks
cd /d "%~dp0backend"

for /f %%i in ('powershell -NoProfile -Command "$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress; if (!$ip) { $ip = hostname }; $ip"') do set "IPLAN=%%i"

echo.
echo   ==============================================
echo      Mi Agenda - Educalinks
echo   ==============================================
echo.
echo   Arrancando el servidor...
echo.
echo   Abre el servidor en tu PC:
echo       http://localhost:8000
if defined IPLAN echo.
if defined IPLAN echo   Desde tu CELULAR (mismo WiFi):
if defined IPLAN echo       http://%IPLAN%:8000
echo.
echo   Si el celular no carga: acepta el aviso del
echo   firewall de Windows o permite el puerto 8000.
echo.
echo   Usa tu usuario y contrasena de Educalinks
echo   (la app guarda tu sesion para que no tengas
echo   que volver a escribirla cada vez).
echo.

if exist venv\Scripts\python.exe goto iniciar
echo   ERROR: no encuentro el entorno venv.
echo   Ejecuta esto una vez:
echo       cd backend
echo       python -m venv venv
echo       venv\Scripts\pip install -r requirements.txt
echo.
pause
goto fin

:iniciar
start "Mi Agenda - Servidor" cmd /k "cd /d %~dp0backend && venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000"

echo   Esperando a que el servidor responda...
for /l %%i in (1,1,60) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto listo
  timeout /t 1 /nobrega >nul
)
echo   El servidor no respondio a tiempo.
echo   Revisa los errores en la ventana "Mi Agenda - Servidor"
echo   o abre http://localhost:8000 manualmente.
goto fin

:listo
echo   Servidor listo. Abriendo el navegador...
start "" http://localhost:8000

:fin