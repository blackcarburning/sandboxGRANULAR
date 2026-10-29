# Editable WAV patch transfers

The WAV browser imports the private `.pattern-exports` ZIP, not the WAV itself.
The photographed `Good-Girls-Make-Loops-Get-Gold-Stars.89-1.wav` failure had an
intact 88,222,634-byte ZIP whose checksum matched its sidecar. Caddy logged
HTTP 200 with only 6–27 MB delivered; the backend logged a second HTTP 400
30 seconds after the initial 200.

The host sets a 30-second socket timeout. A single `wfile.write(body)` uses
`socket.sendall`, whose timeout applies to the entire write, not each period
of forward progress. Send verified archives in 256 KiB writes. On a transfer
failure close the connection; never append a second HTTP/JSON response after
ZIP headers. Read and verify under the account lock, then release it before
network I/O so downloads do not block Song lease heartbeats or other tabs.

The browser checks byte length before SHA-256, retries a failed download once,
and only passes verified bytes to the importer. Large ZIPs have a size-based
download deadline (64 KiB/s plus 30 seconds, minimum three minutes); ordinary
WAV list/preview deadlines remain unchanged. Cancellation never retries.
The import dialogue remains visible on errors. Stored ZIP/WAV bytes, checksum
requirements, account pinning and existing export formats are unchanged.

Regression coverage: `tests/test_wav_patterns.py` (socket backpressure beyond a
single send timeout, account-lock release, disconnect, HEAD, HTTP lifecycle),
`tests/wav-pattern-export.test.cjs` (short HTTP 200, retry, SHA mismatch,
network failure and cancellation). Original-patch browser and throttled-transfer
evidence is in workspace `output/mygrain-patch-transfer-20261025/`.
