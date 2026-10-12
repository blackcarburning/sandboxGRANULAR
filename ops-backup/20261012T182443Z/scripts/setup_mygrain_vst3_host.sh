#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${MYGRAIN_VST3_HOST_VENV:-$ROOT/.venvs/mygrain-vst3-host}"

python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip wheel
"$VENV/bin/python" -m pip install pedalboard soundfile

mkdir -p /srv/sftp/mark_sftp/files/mygrain-vst3-plugins
mkdir -p /srv/sftp/mark_sftp/files/mygrain-vst3-renders

cat <<EOF
MYGRAIN VST3 host is ready.

Python: $VENV/bin/python
Plugins: /srv/sftp/mark_sftp/files/mygrain-vst3-plugins
Renders: /srv/sftp/mark_sftp/files/mygrain-vst3-renders

List plugins:
  $VENV/bin/python $ROOT/scripts/mygrain_vst3_host.py list
EOF
