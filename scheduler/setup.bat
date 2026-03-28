@echo off
echo === F1 YouTube Automator — Task Scheduler Setup ===
echo.

:: Check for admin rights (schtasks needs them)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click setup.bat and select "Run as administrator"
    pause
    exit /b 1
)

set TASK_PREFIX=F1-Daily-Video
set BAT_PATH=C:\Users\ethan\f1-youtube-automator\scheduler\run-daily.bat
set WORK_DIR=C:\Users\ethan\f1-youtube-automator

:: Delete existing tasks if they exist (clean slate)
echo Removing old tasks if they exist...
schtasks /Delete /TN "%TASK_PREFIX%-9AM" /F >nul 2>&1
schtasks /Delete /TN "%TASK_PREFIX%-3PM" /F >nul 2>&1
schtasks /Delete /TN "%TASK_PREFIX%-8PM" /F >nul 2>&1

:: Create 9 AM task
echo Creating task: %TASK_PREFIX%-9AM...
schtasks /Create /TN "%TASK_PREFIX%-9AM" /TR "\"%BAT_PATH%\"" /SC DAILY /ST 09:00 /RL HIGHEST /F
if %errorlevel% neq 0 (
    echo FAILED to create 9 AM task.
    pause
    exit /b 1
)

:: Create 3 PM task
echo Creating task: %TASK_PREFIX%-3PM...
schtasks /Create /TN "%TASK_PREFIX%-3PM" /TR "\"%BAT_PATH%\"" /SC DAILY /ST 15:00 /RL HIGHEST /F
if %errorlevel% neq 0 (
    echo FAILED to create 3 PM task.
    pause
    exit /b 1
)

:: Create 8 PM task
echo Creating task: %TASK_PREFIX%-8PM...
schtasks /Create /TN "%TASK_PREFIX%-8PM" /TR "\"%BAT_PATH%\"" /SC DAILY /ST 20:00 /RL HIGHEST /F
if %errorlevel% neq 0 (
    echo FAILED to create 8 PM task.
    pause
    exit /b 1
)

echo.
echo === Setup Complete ===
echo.
echo Scheduled tasks created:
schtasks /Query /TN "%TASK_PREFIX%-9AM" /FO LIST | findstr "TaskName Status"
schtasks /Query /TN "%TASK_PREFIX%-3PM" /FO LIST | findstr "TaskName Status"
schtasks /Query /TN "%TASK_PREFIX%-8PM" /FO LIST | findstr "TaskName Status"
echo.
echo Videos will be generated and uploaded at 9:00 AM, 3:00 PM, and 8:00 PM daily.
echo Logs are saved to: %WORK_DIR%\scheduler\log.txt
echo.
pause
