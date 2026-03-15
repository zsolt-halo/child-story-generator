@echo off
setlocal

echo.
echo  ============================================
echo   StarlightScribe Animation Worker
echo  ============================================
echo.

:: Defaults — poll both local Docker and k3s Pi
if not defined BACKEND_URL set BACKEND_URL=http://localhost:8000,http://192.168.86.45:30082
if not defined WORKER_TOKEN set WORKER_TOKEN=dev-token
if not defined WAN_REPO set WAN_REPO=C:/Users/netzs/codes/Wan2.2
if not defined AUTO_SHUTDOWN_MINUTES set AUTO_SHUTDOWN_MINUTES=5

echo  Backends:  %BACKEND_URL%
echo  Wan repo:  %WAN_REPO%
echo.

:: Check uv is available
where uv >nul 2>&1
if errorlevel 1 (
    echo  ERROR: uv not found. Install from https://astral.sh/uv
    exit /b 1
)

:: Check Wan repo exists
if not exist "%WAN_REPO%\wan" (
    echo  ERROR: Wan 2.2 repo not found at %WAN_REPO%
    exit /b 1
)

:: Check model weights
if not defined WAN_MODEL_DIR set WAN_MODEL_DIR=%WAN_REPO%/Wan2.2-TI2V-5B
if not exist "%WAN_MODEL_DIR%" (
    echo  ERROR: Model weights not found at %WAN_MODEL_DIR%
    exit /b 1
)

:: Note: worker polls all backends and handles unreachable ones gracefully

:: Check NVIDIA GPU
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo  ERROR: nvidia-smi not found. CUDA GPU required.
    exit /b 1
)

echo  GPU:
for /f "tokens=*" %%i in ('nvidia-smi --query-gpu^=gpu_name^,memory.total --format^=csv^,noheader') do echo         %%i
echo.
echo  Starting worker (first run installs deps ~4GB)...
echo  Press Ctrl+C to stop.
echo.

uv run scripts/animation_worker.py
