# X and L MIDI note entry

Open X or L, select **Connect MIDI**, then choose the keyboard in the editor's MIDI input menu. This uses the same selected port as the main MIDI keyboard. MIDI note-ons go exclusively to the open editor (X takes priority if both are open), using its existing note audition and Record/Practice path. Record advances the edit cursor; Practice does not alter the sequence. Velocity-zero note-ons are releases. Messages on all channels are accepted; repeated held note-ons do not insert extra steps.

**Assign rest note** listens for the next MIDI note-on or nonzero controller (CC) message. Learning consumes that press without inserting a note/rest. Press Assign again to cancel, or close the editor. The learned note or CC plus MIDI channel becomes Rest for that editor; release it before pressing again. **Clear rest assignment** removes the binding. A CC button should send zero when released; a button that never sends a release cannot trigger repeatedly. Assign an otherwise unused key/controller because it no longer plays notes while that editor is open.

Mappings are saved per username in browser storage (`mygrain-lx-midi-rest-v1:<username>`), separately for X and L. They are controller preferences, not patch content, and do not change saved patch schemas. Existing keyboard and on-screen Rest remain available.

The responsive controls support desktop and phone layouts. Actual hardware MIDI requires `navigator.requestMIDIAccess`. Safari/iPhone Safari do not expose Web MIDI; the UI explains this and disables MIDI-only controls. A MIDI-capable iOS browser/native bridge implementing the Web MIDI API is required for hardware input on iPhone. No bridge is bundled or installed. Physical iPhone/keyboard compatibility is not established by synthetic browser tests.

Regression: `node tests/lx-midi-browser.cjs` uses synthetic MIDI ports and blocks live API writes. It exercises native audio startup and real X/L note/rest entry in Chromium and WebKit, learning, duplicate/release handling, Practice, mappings after reload, and 390/430/1440px layouts.
