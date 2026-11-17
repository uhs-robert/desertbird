# End-to-end run

Drives the built add-on in a real Thunderbird and a real Betterbird, headless. It reuses the session and fixture modules from [`tools/measure/`](../measure/README.md) unchanged. Needs `labwc`, `wtype`, `grim`, `zip`, `unzip` and `node`.

```bash
tools/measure/fetch_thunderbird.sh      # once: Thunderbird 153.7.0 ESR into $MEASURE_DIR
npm run e2e                             # setup proof: start each app, take one screenshot
npm run build && npm run e2e -- --xpi dist/desertbird.xpi    # the key assertions, both apps, both profile kinds
E2E_KINDS=default npm run e2e -- betterbird --xpi dist/desertbird.xpi
```

With `--xpi` the run installs DesertBird and the helper add-on, prints one PASS, FAIL or NOTE line per check and writes `report.json` and the screenshots under `$E2E_DIR`. A FAIL exits non-zero. A NOTE is a measurement with no pass condition. `E2E_KINDS` picks profile kinds (`default`, `reply_no_identity`).

The run opens the Inbox with keys only: seven Tabs reach the Local Folders row, Right expands it, Down opens the Inbox and F6 moves focus to the thread list. With a message shown, one F6 from the list reaches the message body and Shift+F6 returns. F6 cycles the folder pane, the thread list, the message body, the spaces toolbar and the global search on both apps, measured through the focus chain. Counted Tabs are not used: on Betterbird three Tabs from the folder pane end on a column header.

Betterbird is `/usr/bin/betterbird`. Override a binary with `--binary thunderbird=/path`. Scratch files go to `$E2E_DIR`, default `/tmp/desertbird-e2e/<app>/<profile kind>/`. `E2E_STARTUP_MS` (default 30000) is the wait after launch.

| File | Role |
| --- | --- |
| `profile.mjs` | `build_profile`: Local Folders, one identity, the fixture Inbox (its threads open collapsed) and the prefs an unsigned Experiment xpi needs. Kind `reply_no_identity` leaves the account without an identity. `install_xpi` copies an xpi into the profile under its gecko id |
| `helper/` | Test-only add-on, never shipped. It polls the sink for a command and answers with the selection, the displayed messages, the folders, every message flag and the windows, read through standard MailExtension APIs. It also reloads DesertBird (`management.setEnabled` off and on, because `runtime.reload()` only works from inside an add-on and `src/` takes no test hook), shows a fixture folder with a tagged and an attachment message, applies a quick filter or sort through the API, closes compose windows, and archives or deletes the selection through the API to measure what Thunderbird leaves selected |
| `harness.mjs` | `start_app`: starts the app in its own labwc session. `press` sends wtype arguments after a bare Shift, `shot` takes a grim screenshot, `ask` sends a command to the helper add-on and returns its answer, `read_state` reads the last thing the helper posted, `folder_message_ids` reads a folder's mbox |
| `run.mjs` | The runner. Without `--xpi` it only proves the setup. The key assertions run after `--xpi` |
