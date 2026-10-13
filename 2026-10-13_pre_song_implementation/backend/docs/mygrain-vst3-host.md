# MYGRAIN VST3 Host

This is a local/offline render bridge for processing MYGRAIN Bastardloop WAVs
through a licensed VST3 effect.

It is deliberately not exposed as a public MYGRAIN web endpoint. VST3 plugins
are native code, and licensed plugins may require desktop licence prompts or a
specific user session.

## Setup

```bash
scripts/setup_mygrain_vst3_host.sh
```

The setup creates a workspace venv at:

```text
/root/.openclaw/workspace/.venvs/mygrain-vst3-host
```

The default plugin drop folder is:

```text
/srv/sftp/mark_sftp/files/mygrain-vst3-plugins
```

The default processed output folder is:

```text
/srv/sftp/mark_sftp/files/mygrain-vst3-renders
```

Additional plugin search folders can be supplied with `MYGRAIN_VST3_DIRS`, or
per command with `--plugin-dir`.

## List Plugins

```bash
.venvs/mygrain-vst3-host/bin/python scripts/mygrain_vst3_host.py list
```

JSON output:

```bash
.venvs/mygrain-vst3-host/bin/python scripts/mygrain_vst3_host.py list --json
```

## Process A Bastardloop

```bash
.venvs/mygrain-vst3-host/bin/python scripts/mygrain_vst3_host.py bastardloop \
  --file bastardloop-a-120bpm-123456.wav \
  --plugin /srv/sftp/mark_sftp/files/mygrain-vst3-plugins/Plugin.vst3 \
  --output bastardloop-a-processed.wav \
  --tail-seconds 2 \
  --json
```

Plugin parameters can be supplied as normalised Pedalboard parameter names:

```bash
.venvs/mygrain-vst3-host/bin/python scripts/mygrain_vst3_host.py bastardloop \
  --file bastardloop-a-120bpm-123456.wav \
  --plugin Plugin \
  --parameter mix=0.5 \
  --parameter drive=0.7
```

## Smoke Test Without A Plugin

This proves the read/write path without loading any VST3:

```bash
.venvs/mygrain-vst3-host/bin/python scripts/mygrain_vst3_host.py render \
  --input /path/to/input.wav \
  --output /tmp/mygrain-vst3-bypass.wav \
  --bypass \
  --json
```

## Notes

- The current backend Bastardloop repository is:
  `/srv/sftp/mark_sftp/files/mygrain-bastardloops`.
- The host uses Spotify Pedalboard, which supports VST3 plugins on Linux.
- Some licensed plugins may require a GUI licence activation before headless
  rendering works.
