# Phase 0 measurements

Throwaway code that produced the numbers in [`docs/thunderbird-behavior.md`](../../docs/thunderbird-behavior.md). It never ships. Run each app from the repo root:

```bash
tools/measure/fetch_thunderbird.sh          # once: the pinned Thunderbird ESR, checksum checked
node tools/measure/run.mjs betterbird       # /opt/betterbird
node tools/measure/run.mjs thunderbird      # $MEASURE_DIR/thunderbird-153.7.0esr
ONLY=rtt,query node tools/measure/run.mjs betterbird   # a subset of the scenarios
```

Scratch files go to `$MEASURE_DIR`, default `/tmp/desertbird-measure`. Results are JSON files in `$MEASURE_DIR/run/<app>/out/`, with screenshots beside them. A full run takes about 10 minutes. It needs `labwc`, `wtype`, `grim`, `zip` and `node`.

Each run uses a new profile, a new `HOME` and a new headless `labwc` display, so nothing shows on a real screen and no real profile is read. The profile has only Local Folders and generated mbox files. No account exists and no mail goes over the network.

| File | Role |
| --- | --- |
| `run.mjs` | Builds the profile and the xpi, starts the session and the app, serves the add-on's requests (real key presses, screenshots, results) |
| `session.mjs` | The headless `labwc` display and the `wtype` keyboard. It stops its processes by process group |
| `fixtures.mjs` | The mbox files: an Inbox of 60 messages with threads, and 50 folders of 100 messages |
| `fetch_thunderbird.sh` | Downloads the pinned Thunderbird tarball into its own directory and checks the published SHA-256 |
| `probe/background.js` | The scenarios, in order |
| `probe/experiment/` | The Experiment: typed verbs for key reports, focus, thread view state, the overlay mounts and the round trip. It has no eval, no free-string verb and no free URL |
| `probe/overlay.*`, `msg_content.js`, `compose_content.js` | The overlay page and the message and compose content scripts |
