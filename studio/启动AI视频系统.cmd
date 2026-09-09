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
    echo 请先在新电脑安装并打开 Codex，或安装项目锁定的 Node.js 和 pnpm，然后重试。
    pause
    exit /b 1
  )
  set "STUDIO_PNPM=pnpm.cmd"
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo 没有找到项目锁定的 Node.js，请先安装并重试。
  pause
  exit /b 1
)

set /p STUDIO_EXPECTED_NODE=<"..\.node-version"
for /f "delims=" %%V in ('node -p "process.versions.node"') do set "STUDIO_ACTUAL_NODE=%%V"
if not "%STUDIO_ACTUAL_NODE%"=="%STUDIO_EXPECTED_NODE%" (
  echo Node.js 版本不匹配：需要 %STUDIO_EXPECTED_NODE%，当前为 %STUDIO_ACTUAL_NODE%。
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).engines.pnpm"') do set "STUDIO_EXPECTED_PNPM=%%V"
for /f "delims=" %%V in ('call "%STUDIO_PNPM%" --version') do set "STUDIO_ACTUAL_PNPM=%%V"
if not "%STUDIO_ACTUAL_PNPM%"=="%STUDIO_EXPECTED_PNPM%" (
  echo pnpm 版本不匹配：需要 %STUDIO_EXPECTED_PNPM%，当前为 %STUDIO_ACTUAL_PNPM%。
  pause
  exit /b 1
)

node "scripts\check-locked-dependencies.mjs"
if errorlevel 1 (
  echo 依赖未安装或与锁文件不同步：正在执行 frozen install，请稍候……
  call "%STUDIO_PNPM%" install --frozen-lockfile
  if errorlevel 1 (
    echo 安装失败，请检查网络后重试，或回到 Codex 里让我检查。
    pause
    exit /b 1
  )
  node "scripts\check-locked-dependencies.mjs" --record
  if errorlevel 1 (
    echo 安装完成后依赖验证仍未通过，请回到 Codex 里让我检查。
    pause
    exit /b 1
  )
)

call "%STUDIO_PNPM%" start:open
if errorlevel 1 (
  echo 系统未能正常启动，请回到 Codex 里让我检查。
  pause
)
