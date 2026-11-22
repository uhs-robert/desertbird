# Phase 0 measurements

Throwaway code that produced the numbers in [`docs/thunderbird-behavior.md`](../../docs/thunderbird-behavior.md). It never ships. Run each app from the repo root. Run `npm run build` and read the bundle sizes before you raise a size guard in `tools/build.mjs`, and re-measure with this probe before a raise that passes a ceiling:

```bash
tools/measure/fetch_thunderbird.sh          # once: the pinned Thunderbird ESR, checksum checked
node tools/measure/run.mjs betterbird /path/to/betterbird
node tools/measure/run.mjs thunderbird      # $MEASURE_DIR/thunderbird-153.7.0esr, or pass a binary
ONLY=rtt,query node tools/measure/run.mjs thunderbird   # a subset of the jobs
```

Scratch files go to `$MEASURE_DIR`, default `/tmp/desertbird-measure`. Each job (one scenario) runs in a fresh profile, so no state leaks between scenarios. Results are JSON files in `$MEASURE_DIR/run/<app>/<job>/out/`, with screenshots and `app_exit.json` beside them. The key tests and the 10,000-message query dominate the time. A full run takes about 35 minutes (the job list runs serially). The jobs `api_presence_minimal` (a manifest without the optional permissions), `overlay_war` (a manifest with `web_accessible_resources`), `native_host` (host manifests in the job's `HOME`) and `reply_no_identity` (an account with no identity, expected to crash the app) change the profile or the manifest. It needs `labwc`, `wtype`, `grim`, `zip` and `node`.

Each run uses a new profile, a new `HOME` and a new headless `labwc` display, so nothing shows on a real screen and no real profile is read. The profile has only Local Folders and generated mbox files. No account exists and no mail goes over the network.

| File | Role |
| --- | --- |
| `run.mjs` | Builds the profile and the xpi, starts the session and the app, serves the add-on's requests (real key presses, screenshots, results) |
| `session.mjs` | The headless `labwc` display and the `wtype` keyboard. It stops its processes by process group |
| `fixtures.mjs` | The mbox files: an Inbox of 60 messages with threads, 50 folders of 100 messages, and the Header folder of one message with Cc, a tag and two attachments for the job `header_ids` (the e2e kinds leave it out unless they ask for it) |
| `fetch_thunderbird.sh` | Downloads the pinned Thunderbird tarball into its own directory and checks the published SHA-256 |
| `probe/background.js` | The scenarios. `run.mjs` runs each one as a job |
| `probe/experiment/` | The Experiment: typed verbs for key reports, focus, thread view state, the overlay mounts and the round trip. It has no eval, no free-string verb and no free URL |
| `probe/overlay.*`, `msg_content.js`, `compose_content.js` | The overlay page and the message and compose content scripts |
