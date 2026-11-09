#!/bin/bash
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
build="${1:?build directory required}"
sdk="${2:?pinned SDK checkout required}"
cmake -S "$src" -B "$build" -DVST3_SDK_ROOT="$sdk" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES='arm64;x86_64' -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 -DMYGRAIN_BUILD_VALIDATOR=ON
cmake --build "$build" --target MygrainBridge MygrainFX mac-plugin-host bridge-core-test bridge-transport-test bridge-fx-test validator moduleinfotool -j 3
ctest --test-dir "$build" --output-on-failure
