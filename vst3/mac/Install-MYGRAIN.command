#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if pgrep -x 'Bitwig Studio' >/dev/null; then
  echo 'Close Bitwig Studio before installing MYGRAIN, then run this installer again.'
  exit 1
fi
shasum -a 256 -c SHA256SUMS.txt
plugin_dir="$HOME/Library/Audio/Plug-Ins/VST3"
backup_dir="$HOME/Library/Audio/Plug-Ins/MYGRAIN Backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$plugin_dir"
for source_bundle in *.vst3; do
  test -d "$source_bundle"
  codesign --verify --deep --strict "$source_bundle"
  if test -e "$plugin_dir/$source_bundle"; then
    mkdir -p "$backup_dir"
    mv "$plugin_dir/$source_bundle" "$backup_dir/$source_bundle"
  fi
  ditto "$source_bundle" "$plugin_dir/$source_bundle"
  # Only remove the downloaded-file flag from this explicitly installed bundle.
  xattr -dr com.apple.quarantine "$plugin_dir/$source_bundle" 2>/dev/null || true
  codesign --verify --deep --strict "$plugin_dir/$source_bundle"
  echo "Installed $source_bundle in $plugin_dir"
done
echo 'Open Bitwig > Settings > Locations. Add ~/Library/Audio/Plug-Ins/VST3 if needed, then rescan VST3.'
echo 'Bridge is an instrument. FX is a stereo audio effect. Open the plugin and click Open MYGRAIN in Chrome.'
echo 'Installation complete. Existing versions, if any, were backed up outside the VST3 scan folder.'
