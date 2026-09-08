@echo off
setlocal
cd /d "%~dp0"
echo === GeoAid Mobile: Expo SDK 57 upgrade ===
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /f /q package-lock.json
call npm install
if errorlevel 1 goto :fail
call npx expo install --fix
if errorlevel 1 goto :fail
call npx expo-doctor@latest
if errorlevel 1 goto :doctorfail
echo.
echo SDK 57 setup complete. Start the app with: npx expo start -c
exit /b 0
:doctorfail
echo.
echo Expo Doctor reported warnings/errors. Review them above, then run: npx expo start -c
exit /b 0
:fail
echo.
echo Dependency installation failed. Check the npm error above.
exit /b 1
