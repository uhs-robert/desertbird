# End-to-end run

Drives the built add-on in a real Thunderbird and a real Betterbird, headless. It reuses the session and fixture modules from [`tools/measure/`](../measure/README.md) unchanged. Needs `labwc`, `wtype`, `grim`, `unzip` and `node`.

```bash
tools/measure/fetch_thunderbird.sh      # once: Thunderbird 153.7.0 ESR into $MEASURE_DIR
npm run e2e                             # setup proof: start each app, take one screenshot
npm run e2e -- betterbird --xpi dist/desertbird.xpi
```

Betterbird is `/usr/bin/betterbird`. Override a binary with `--binary thunderbird=/path`. Scratch files go to `$E2E_DIR`, default `/tmp/desertbird-e2e/<app>/<profile kind>/`. `E2E_STARTUP_MS` (default 30000) is the wait after launch.

| File | Role |
| --- | --- |
| `profile.mjs` | `build_profile`: Local Folders, one identity, the fixture Inbox (its threads open collapsed) and the prefs an unsigned Experiment xpi needs. Kind `reply_no_identity` leaves the account without an identity. `install_xpi` copies an xpi into the profile under its gecko id |
| `harness.mjs` | `start_app`: starts the app in its own labwc session. `press` sends wtype arguments after a bare Shift, `shot` takes a grim screenshot, `read_state` reads what a helper add-on posted to the result sink, `folder_message_ids` reads a folder's mbox |
| `run.mjs` | The runner. Without `--xpi` it only proves the setup. The key assertions are a marked list in this file and still to write |
