#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
python3 server.py "${1:-8765}"
