# Solo Tracker

Jump → Solo Tracker sits immediately below Song (including the phone shortcut rail). The scarlet button opens a native modal listing canonical global source, waveform, grain, drum and manual/source-derived effect solos, plus transient D lane and Q playback/chord-note solos. Source-derived effects appear once with ownership labels.

Clear calls existing Solo owners, including local D/Q APIs, in one draft edit; it does not add an audio mask, change routing or persist popup state. Close/Escape preserve selections. A DOM observer runs only while open, with no new polling loop. Existing modal scroll containment owns background locking.

Ember now has a prominent card volume slider and linked Jump slider. Both, the Level dial and Layers swipe-to-level button share `modes.ember.level`, the existing graph gain, history and restore. Proxy inputs are marked `data-mirror-control` and excluded from generic inventories. No schema, capability, DSP or render identity changes.
