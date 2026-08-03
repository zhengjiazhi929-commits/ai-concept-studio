@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "STUDIO_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
set "STUDIO_NODE_DIR=%STUDIO_RUNTIME%\node\bin"
set "STUDIO_PNPM=%STUDIO_RUNTIME%\bin\fallback\pnpm.cmd"

if exist "%STUDIO_NODE_DIR%\node.exe" set "PATH=%STUDIO_NODE_DIR%;%PATH%"

if not exist "%STUDIO_PNPM%" (
  where pnpm.cmd >nul 2>nul
  if errorlevel 1 (
    echo 没有找到可用的运行环境。
    echo 请先在新电脑安装并打开 Codex，或安装 Node.js 20 和 pnpm，然后重试。
    pause
    exit /b 1
  )
  set "STUDIO_PNPM=pnpm.cmd"
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js 20 或更高版本，请先安装并重试。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次启动：正在安装本地依赖，请稍候……
  call "%STUDIO_PNPM%" install
  if errorlevel 1 (
    echo 安装失败，请检查网络后重试，或回到 Codex 里让我检查。
    pause
    exit /b 1
  )
)

call "%STUDIO_PNPM%" start:open
if errorlevel 1 (
  echo 系统未能正常启动，请回到 Codex 里让我检查。
  pause
)
