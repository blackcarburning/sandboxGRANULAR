# Note auditions — NOTE-TAPS.1

## Repair

A short main-keyboard tap could release a pending sampler request before its cold piano/strings sample loaded. Prepare the exact played pitch before starting its voice. Preserve normal releases during that preparation and give a completed tap a 100ms gate. Keep audio-resume/recording abandonment, pointer cancellation, source changes and Stop invalidation authoritative. Touch pointerup followed by implicit pointerleave remains a normal completed tap; leaving a key before release cancels it.

L/X grid auditions now restore a remembered sample when their buffer is not resident. L/X keyboard input distinguishes completed taps from cancellation while restoring a source: completed taps get a short sample audition; scrolling, overlay close and Stop cancel pending work. Transport enabled states, solo/mix gates, and stored sequences are not forcibly changed by auditions.

## Verification

- `tests/note-tap-readiness.test.cjs`, `tests/q-keyboard-player.test.js`, `tests/k-keyboard-solo.test.js`: 58 passing focused units, including normal taps, audio-resume and recording abandonment, scrolling cancellation, Stop/source invalidation, Hold, existing sampler contracts and solo isolation.
- `tests/note-cold-tap-browser.cjs`: real integrity-checked local piano/strings WAVs, 350ms artificial download delay, 40ms completed taps, final-output PCM peak > 0.0001 and clean released keys/voices. WebKit/Chromium desktop 1440px and iPhone-style 390px; includes implicit touch pointerleave after pointerup.
- `tests/lx-cold-audition-browser.cjs`: real sample-loader paths with delayed fixture WAVs, L/X remembered-source grid audition and 40ms keyboard taps, zero-output pointer cancellation, L/X synth grids and Q grid. Desktop/phone-sized WebKit and Chromium, plus native desktop contexts.
- Final live HTML must be HTTP200 and byte-identical to the checkout, with both visible build badges NOTE-TAPS.1; all inline scripts parse.

Physical iPhone remains unverified. Browser isolation stubs account/API responses and blocks production writes. Existing source/queue assets are not altered. Pre-edit HTML and task-only diff are in backups/note-audition-20261026/.

## Existing test harness limitations

The old k-keyboard-readiness, k-keyboard-routing and keyboard-arp-transport test files also fail on the pre-task HTML (respectively 8, 10 and 220 failures). Their fixtures include stale extracted runtime slices or missing globals; saved baseline TAP is in output/note-audition-baseline/. The focused readiness harness scopes extraction to the key bindings and supplies the current controller/source globals. No unrelated old test harnesses were changed.

The checkout already contains unrelated uncommitted changes; these were preserved and not bundled into a commit/push.
