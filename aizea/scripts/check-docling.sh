#!/usr/bin/env bash
# check-docling.sh — Returns 0 if docling-serve is reachable, 1 otherwise.
# Usage: bash scripts/check-docling.sh

set -u

HOST="${DOCLING_HOST:-127.0.0.1}"
PORT="${DOCLING_PORT:-5001}"
URL="http://${HOST}:${PORT}/health"

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then
    echo "docling-serve: OK (${URL})"
    exit 0
  fi
  echo "docling-serve: UNREACHABLE (${URL})" >&2
  exit 1
fi

# Fallback: PowerShell (Windows native)
if command -v powershell >/dev/null 2>&1 || command -v pwsh >/dev/null 2>&1; then
  PSH="$(command -v pwsh 2>/dev/null || command -v powershell 2>/dev/null || echo powershell)"
  if "$PSH" -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri '$URL' | Out-Null; exit 0 } catch { exit 1 }" >/dev/null 2>&1; then
    echo "docling-serve: OK (${URL})"
    exit 0
  fi
  echo "docling-serve: UNREACHABLE (${URL})" >&2
  exit 1
fi

echo "docling-serve: NO HTTP CLIENT AVAILABLE" >&2
exit 1
