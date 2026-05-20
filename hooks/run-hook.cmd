: << 'CMDBLOCK'
@echo off
REM Polyglot wrapper: runs hook scripts cross-platform
REM Usage: run-hook.cmd <script-name> [args...]

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)
set "SCRIPT_NAME=%~1"
if /I "%SCRIPT_NAME:~-3%"==".ts" (
    node --experimental-strip-types "%~dp0%SCRIPT_NAME%" %2 %3 %4 %5 %6 %7 %8 %9
) else if /I "%SCRIPT_NAME:~-3%"==".py" (
    python "%~dp0%SCRIPT_NAME%" %2 %3 %4 %5 %6 %7 %8 %9
) else (
    "C:\Program Files\Git\bin\bash.exe" -l "%~dp0%SCRIPT_NAME%" %2 %3 %4 %5 %6 %7 %8 %9
)
exit /b
CMDBLOCK

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
case "$SCRIPT_NAME" in
  *.ts) exec node --experimental-strip-types "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@" ;;
  *.py) exec python3 "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@" ;;
  *) exec "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@" ;;
esac
