@echo off
cd /d C:\Users\ethan\f1-youtube-automator

:: Add FFmpeg and Node to PATH
set PATH=C:\Users\ethan\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin;C:\Program Files\nodejs;%PATH%

:: Log start time
echo [%date% %time%] Starting daily F1 video... >> scheduler\log.txt

:: Run the daily video pipeline
call "C:\Program Files\nodejs\npx.cmd" tsx src/dailyVideo.ts >> scheduler\log.txt 2>&1

:: Log completion
echo [%date% %time%] Finished with exit code %ERRORLEVEL% >> scheduler\log.txt
echo. >> scheduler\log.txt
