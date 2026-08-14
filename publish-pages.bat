@echo off
REM Publish the web app to GitHub Pages: snapshot the current branch's tree onto the
REM orphan `main` branch and push (the deploy Action then builds and deploys).
REM Pass a branch name to snapshot a specific one: publish-pages.bat feat/xyz
cd /d "%~dp0"
call node scripts\publish-pages.mjs %*
if errorlevel 1 (
  echo.
  echo [publish-pages] FAILED - see output above.
  pause
  exit /b 1
)
