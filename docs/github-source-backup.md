# GitHub source and runtime backup

The full editor source is maintained in https://github.com/blackcarburning/sandboxGRANULAR.
The separate On Demand source is maintained in the private repository
https://github.com/blackcarburning/MYGRAIN-on-demand.

Large generated runtime data and built plugin installers are retained as versioned
release assets in the existing private safety repository:
https://github.com/blackcarburning/MYGRAIN-safety/releases.
The November 24 source-sync release contains checksummed archives of both PCM
corpora, the exact isolated On Demand engine, the deployed public service and
its frozen browser deck, plus every locally available native installer ZIP.
The release manifest records source commit IDs, file counts, original paths,
SHA-256 checksums, archive member manifests and the excluded runtime state.

Restore the native and On Demand source commits first. Restore the native PCM
archive into the editor checkout (industry-corpus-v1 and restructure-corpus-v1).
The private deployment archives retain their original relative layout under
private-engine and public-service; do not overwrite a live deployment blindly.
On Demand's generated public/pot-app is excluded from source Git and is backed
up exactly in the deployment archive; scripts/build-pot-app.py can rebuild it
from a compatible native checkout. Verify release SHA-256 checksums before use.
Native installer ZIPs restore to the editor root without changing their names.

Account databases, credentials, user Songs/patches/recordings, sample-source
mirrors, caches, virtual environments and node_modules are not source and are
not uploaded. Deployment settings reference separately managed secret files;
those secret values are never part of a GitHub backup. Source-code sync does
not restart services or alter stored audio, purchases or accounts.
