@echo off
REM Build the signed Android App Bundle and publish it to the Google Play closed-testing
REM (alpha) track in one unattended run. See scripts\release.mjs for options
REM (NEW_VERSION_NAME, NEW_VERSION_CODE, PLAY_TRACK, SKIP_PUBLISH, PLAY_RELEASE_NOTES).
cd /d "%~dp0"
call node scripts\release.mjs %*
if errorlevel 1 (
  echo.
  echo [publish-store] FAILED - see output above.
  pause
  exit /b 1
)
