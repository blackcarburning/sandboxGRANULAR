# Temporary Vocal Takes

M+ is an independent backing-vocal lane with the same recording and effects
controls as M. Both lanes use this single library and user/folder selection.
Opening the browser or Save Version from a lane explicitly selects that lane
as the target, shown in the dialog. Saving/loading touches only that target's
working take; the other lane, song snapshots and library stay intact. Target
switching is blocked during library requests. Library loads are blocked while
either lane records or while ordered song playback is active.

Bastardloop M has **Save Version** and **Vocal Take Browser** controls. Record
or load an M take, select Save Version, choose an existing user or create one,
and save with an editable name. The default uses the local date/time and the
loaded song name, or `none` when no song is selected. Every save creates a new
version, even when the name matches an earlier take.

User names are shared organisational labels, not authentication accounts.
There are no passwords or private user areas. Anyone with access to MYGRAIN
can browse the users and their takes. The library persists on the server and
is visible from other browsers; “temporary” does not mean automatically
expired or overwritten.

Choose a user and folder in the browser. Create Folder adds a subfolder to
that user's area. Each take has Audition, Stop Audition, Load into M, Rename,
Delete and a Move to folder dropdown. Load and Delete ask for confirmation.
Loading replaces only the currently loaded M recording; it does not alter
saved song parts. Loading songs, parts, patterns or patch ZIPs never replaces
the library. Save a part or amendment explicitly to capture the loaded take
in that part. Deleting a library take also leaves current M audio and saved
part snapshots intact.

Versions contain the original, unprocessed M-loop recording as 16-bit PCM
WAV, with its recording BPM, original duration, song label and creation time.
M's playback pitch/reverse/duration processing is not baked into versions.
Loading uses the normal M recording load path and retains M playback controls,
with the same filter-default reset as a new recording. It does not start any
other loop transport. Audition plays the stored raw recording by itself;
closing the browser stops that audition.

## Storage and integration

- Global root: `/srv/sftp/mark_sftp/files/mygrain-vocal-takes/`.
- `library.json` is an atomically replaced manifest. Files reside under
  `users/<stable-user-id>/`, optionally `folders/<stable-folder-id>/`.
  User/folder/take display names are metadata, not filesystem paths.
- Takes have unique IDs; each version has its own WAV. Rename does not copy
  audio; Move physically relocates the same file within that user's area.
- Delete removes the visible manifest entry and moves the WAV to `deleted/`
  for operator recovery. There is no automatic purge or restore UI.
- API: `/mygrain/api/vocal-takes`, integrated into the existing documenter
  service. No song-library key is used. Mutations reject cross-site origins.
- Library forms are outside song/pattern state. The browser remembers only
  its selected user/folder in `mygrain-vocal-workspace-selection-v1`.
- Uploads accept mono/stereo PCM16 WAV, 8–192 kHz, 0.02–180 seconds,
  at most 128 MiB. Names/IDs, complete WAV data, folders and symlinks are
  validated on the server. Writes are serialized and fsynced; failed manifest
  saves roll back file uploads, moves and deletes.

## Tests

`python3 -m unittest discover -s sandboxGRANULAR/tests -p 'test_vocal_takes.py'`

`node --test sandboxGRANULAR/tests/vocal-takes.test.js`

For browser checks, start `sandboxGRANULAR/tests/song-beta-test-server.py`
on an unused localhost port and run `tests/vocal-takes-browser.js` with
`SONG_BETA_TEST_URL=http://127.0.0.1:<port>/mygrain/`. The test server isolates
song, WAV-export and vocal-library roots in a temporary directory. Tests
never create vocalists or takes in the production library.
