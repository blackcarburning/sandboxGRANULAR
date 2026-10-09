# MYGRAIN patch repository

MYGRAIN saves patch ZIP bundles here through `/mygrain/api/patches/upload`.

Each ZIP contains:

- `manifest.json` with bundle metadata, Bastardloop references, LFO routing, and effect settings.
- `preset.json` with the normal MYGRAIN patch settings.
- `state.json` with the browser state snapshot when available.
- WAV assets for recorded mic samples, output captures, and any loaded/rendered source buffers present at export time.

The app writes stored ZIP entries so its built-in Patch Browser can reopen bundles without an external ZIP library.
