MyGrain CEF FX 0.1.0 preview

INSTALL THE WHOLE BUNDLE, with the DAW closed.
Windows x64: copy MyGrain CEF FX.vst3 into C:\Program Files\Common Files\VST3\.
macOS 13+: run bash "Install MyGrain CEF FX.command" from the extracted folder.
The installer verifies checksums/signatures, backs up this plugin and installs
only it in your user VST3 folder. Mac is ad-hoc signed, not notarized.
Rescan VST3 plugins. Existing Bridge, FX and CEF instrument stay installed.

Add MyGrain CEF FX as a STEREO INSERT EFFECT, not an instrument.
Open its embedded app and sign in; Start MYGRAIN once if requested. No external
Chrome installation/window, connection-code copying or virtual audio cable.
In DAW INPUT choose Filters, Master, Final stage or Direct; adjust input gain,
mute and Dry/wet. Arm FX (or native Arm), then play the DAW with track processing
or monitoring enabled. The existing effects, Cooking Pot and Master Baker are
available in the full app. Enabled sources run silently for modulation while
armed; they are not mixed into the FX return. Explicit Stop restores normal
layer routing. Existing source/effect controls and patch formats are retained.

Same processing as MYGRAIN FX 0.4.0: stereo 8-192 kHz, float32/float64,
1,000 ms fixed latency reported to the host for delay compensation. This is a
creative real-time processor, not low-latency monitoring. Stop, bypass, missing
returns, disconnect and native offline bounce use the SAME delayed dry signal.
Print/render in real time to capture the effects. Standard VST3 bypass is the
host automation parameter; browser effects are not exposed as new parameters.
Never route the plugin output back to its own input.

Full Chromium Embedded Framework runtime is private inside the plugin bundle.
The current hosted MYGRAIN app still requires internet and your account.
Each instance has its own browser process/profile; closing the editor leaves
processing and automatic patch storage running. Native filename dialogs and
preview playback are retained; the DAW must still call the audio processor.
Bypass and offline bounce suppress the separate browser-preview bus.

Auto-save defaults On/60 seconds, adjustable 15-3600. Store now captures the
editable patch, required source audio, FX input gain/mute/routing and auto-store
preferences. Native dry/wet, Arm and bypass are also saved. Save your DAW project
normally to write the last completed snapshot to disk. No password/login token
is embedded in your project. Store + reload app waits for a successful FX store
before refreshing/restoring the current hosted app. Reload interrupts live FX.
New instances must sign in/start audio to recall their editable patch.

Preview limitations and native test results: VERIFICATION.txt.
Physical DAWs/devices, Intel runtime, multi-instance performance and international
IME are not certified. Keep ALL helpers, Chromium resources and licenses.
Setup: https://openclaw.blackcarburning.com/mygrain/cef-fx-setup.html
