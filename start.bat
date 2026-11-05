@echo off
rem One-click start for Notebook Companion (Windows).
rem Installs what's missing, builds the UI if needed, starts the server on a free port and opens the browser.
setlocal
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo Creating the Python environment...
  python -m venv .venv || (echo Python 3.10+ is needed: https://www.python.org/downloads/ & pause & exit /b 1)
)
echo Checking Python packages...
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt || (echo Couldn't install the Python packages. & pause & exit /b 1)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo  backend\.env was created. Add your LLM_API_KEY and GNANI_API_KEY to it, then run start.bat again.
  notepad ".env"
  pause & exit /b 0
)
cd /d "%~dp0frontend"
if not exist "dist\index.html" (
  echo Building the app (first time only)...
  if not exist "node_modules" call npm install || (echo Node.js is needed: https://nodejs.org & pause & exit /b 1)
  call npm run build || (pause & exit /b 1)
)
cd /d "%~dp0backend"
rem the server prints its address; port 5000 is skipped if Docker/WSL holds it
start "" cmd /c "timeout /t 4 >nul & for /f %%p in (..\frontend\.backend-port) do start http://localhost:%%p"
".venv\Scripts\python.exe" app.py
pause
