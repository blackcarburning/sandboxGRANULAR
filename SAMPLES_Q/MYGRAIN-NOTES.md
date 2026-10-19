# MYGRAIN Q piano repository

This is a four-velocity-layer subset of Salamander Grand Piano V3 by Alexander Holm, licensed under CC BY 3.0. The upstream `README.md` describes the complete original sixteen-layer SFZ instrument, not this browser subset.

- `samples/`: 120 stereo PCM16 WAVs at 44.1 kHz: 30 sampled pitches A0–C8, each at original velocity layers 4, 8, 12 and 16. Q selects the nearest sampled pitch (at most one semitone away) and nearest of its four velocity levels.
- `originals/`: the corresponding unmodified source FLACs, retained for reproducibility. Q never fetches these during playback.
- `manifest.json`: pinned source revision, source-blob checksums, WAV SHA-256 hashes, note/velocity mapping and dimensions.
- `LICENSE` and `ATTRIBUTION.txt`: original licence and modification/source credits. These are linked on the card. Portable Song piano banks also carry attribution, source, licence URI and modification details.

Q loads only the required WAVs on demand and verifies their checksums before decoding. Each part's piano set is limited to 96 MiB of decoded stereo audio; excessive pitch/velocity combinations produce an explicit error rather than silently dropping notes.

Song capture embeds the required piano recordings for the complete stored 64-step sequence, including tied steps and the inactive pattern tail. Recall and frozen playback do not need this repository or any browser sample cache. New notes outside an embedded bank require this repository again when you deliberately edit the part.

Q is a browser sampler, not an SFZ emulator. Hammer/pedal/string-resonance release noises and the original SFZ controller mapping are not included. Keep the supplied attribution and licence information with redistributed samples or portable parts.

The source preparation utility is `../scripts/prepare-q-piano.py`; it verifies the pinned source blobs and converts recordings without trimming or normalizing them. It needs NumPy, SciPy and libsndfile on the preparation host, not on phones.
