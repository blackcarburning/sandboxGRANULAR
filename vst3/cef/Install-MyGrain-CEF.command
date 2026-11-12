#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
version=$(sw_vers -productVersion)
if [ "${version%%.*}" -lt 13 ]; then echo 'MyGrain CEF needs macOS 13 or later.'; exit 1; fi
bundle='MyGrain CEF.vst3'
test -d "$bundle"
shasum -a 256 -c SHA256SUMS.txt
codesign --verify --deep --strict "$bundle"
target="$HOME/Library/Audio/Plug-Ins/VST3"
mkdir -p "$target"
if [ -e "$target/$bundle" ]; then
 backup="$HOME/Library/Application Support/MyGrainCEF/Backups/$(date -u +%Y%m%dT%H%M%SZ)"
 mkdir -p "$backup"
 mv "$target/$bundle" "$backup/$bundle"
fi
ditto "$bundle" "$target/$bundle"
xattr -dr com.apple.quarantine "$target/$bundle" 2>/dev/null || true
codesign --verify --deep --strict "$target/$bundle"
echo 'Installed MyGrain CEF. Rescan VST3 plugins in your DAW. Bridge v8 was not changed.'
