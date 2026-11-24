# AGENTS.md

Guidance for coding agents in this repository. `CLAUDE.md` points here. Keep the content in this file.

## Overview

DesertBird is a keyboard-first Thunderbird add-on that also works in Betterbird. It is a MailExtension plus one Experiment. An Experiment is the privileged part of a Thunderbird add-on and runs chrome code. Every command is defined once in a registry, and keys, the command line, completion and help all read that definition. It works on its own. A native host is optional.

## Where to look

Read the design for an area before you change it. Read a folder's README before you change or research code in that folder.

| Topic                                          | File                               |
| ---------------------------------------------- | ---------------------------------- |
| Architecture, chrome verbs, split table, scope | [`docs/design.md`](docs/design.md) |
| Messages and Experiment call shapes shared by the chrome and background sides | [`src/shared/protocol.ts`](src/shared/protocol.ts) |
| Build entry points, bundling, the parent size guard | [`tools/build.mjs`](tools/build.mjs) |
| Background page: command groups, router, handlers | [`src/background/README.md`](src/background/README.md) |
| Chrome runtime: Experiment parent, motions, view access | [`src/chrome/README.md`](src/chrome/README.md) |
| Settings and user bindings in `storage.local`, version key, migrations | [`src/background/config/README.md`](src/background/config/README.md) |
| Options page: settings form and key bindings editor | [`src/options/README.md`](src/options/README.md) |
| Command line: overlay page, key handling, drawing | [`src/overlay/README.md`](src/overlay/README.md) |
| Command line in the background: completion, sessions, running a typed command | [`src/background/cmdline/README.md`](src/background/cmdline/README.md) |
| Body script: keys in a message document (pane, tab, window) and on the options and help pages. Compose script: Ctrl+E in a compose body | [`src/content/README.md`](src/content/README.md) |
| Search in the background: live Quick Filter search, the `/` register, `n` and `N` | [`src/background/search/README.md`](src/background/search/README.md) |
| Hud in the background: which-key panel, toasts, mode label | [`src/background/hud/README.md`](src/background/hud/README.md) |
| Bridge to the native host: the `bridge` setting, the never-list, the port and its frames | [`src/background/bridge/README.md`](src/background/bridge/README.md) |
| Theme: the `theme` setting, role colors for pages, mode label colors | [`src/background/theme/README.md`](src/background/theme/README.md) |
| Toolbar button: the bird icon and its popup (Options, Help) | [`src/popup/README.md`](src/popup/README.md) |
| Help page generated from the registry | [`src/help/README.md`](src/help/README.md) |
| Default keys of each tab kind, generated (never edit by hand) | [`docs/keymap.md`](docs/keymap.md) |
| End-to-end run in Thunderbird and Betterbird | [`tools/e2e/README.md`](tools/e2e/README.md) |
| Hand checks: visible Betterbird or Thunderbird with a worktree's build in a throwaway profile | [`tools/owner_test/README.md`](tools/owner_test/README.md) |
| Shared code: protocol, `swallow.ts` helpers for dropped promise errors | [`src/shared/README.md`](src/shared/README.md) |
| Pinned DesertFox copy: pin, stand-ins, local edits | [`vendor/desertfox/VENDOR.md`](vendor/desertfox/VENDOR.md) |
| Pinned `marked` and `turndown` release files for HTML compose | [`vendor/marked/VENDOR.md`](vendor/marked/VENDOR.md), [`vendor/turndown/VENDOR.md`](vendor/turndown/VENDOR.md) |
| Measured Thunderbird and Betterbird behavior the design rests on | [`docs/thunderbird-behavior.md`](docs/thunderbird-behavior.md) |
| Phase 0 measurement probe and how to rerun it | [`tools/measure/README.md`](tools/measure/README.md) |

Add a row for each new doc or source folder README in the same commit that creates it.

If code and the design disagree, stop and ask the maintainer. Do not change the design to match the code without the maintainer's approval.

## Architecture rules

- Define each command once, in the registry. Keymaps, the command line, help and which-key reference commands and never define behavior.
- Check args only in the one validator. Keys, the command line, the native host and snippets all pass through it.
- Do not evaluate strings. Snippets from the user's own config are the only exception.
- Give the native host a fixed set of verbs. Never add a shell or eval verb.
- Give the Experiment a fixed table of chrome verbs, each with typed args checked against its schema. Never add a verb that takes a free string to run, a script, or a URL. A new verb needs a reason in the commit message.
- The chrome runtime follows the same admission rule as DesertFox `content.js`: code goes in only if it runs before the first key or decides what happens to a key, serves a key pressed in most windows (motions), is needed to load the other parts, or must work while the window changes state. Everything else goes in the background page or an on-demand bundle. The same rule applies to the body script bundle. The thread list, pane focus, command and page verbs live in `experiment/app.js`, which Thunderbird loads on the first call, and no verb module (`app_verbs.ts`, `view_verbs.ts`) may enter `experiment/keys.js`. Hint pick keys live in `experiment/hints.js`, which holds `sendEnter` and `pick` and nothing from the key runtime. `pick` labels the mail tab, the page tabs, the header and body of the message that holds the focus, and those of a message tab or message window in front, and asks the page actor to label a web page or another add-on's page. The keys of every tab but the mail tab, and of the header of a message window, live in `experiment/pages.js`, which also serves the mail tab's text fields (the typing keys: Escape, Ctrl+[, Alt+j and Alt+k). The zoom verbs live in `experiment/zoom.js`. The add-on's own quick filter (the List-Id and date terms of `F m l` and `F m d`) lives in `experiment/filter.js`. The style sheet that draws the cursor row outline of the thread list registers from `experiment/overlay.js`, beside the page focus hook, because no key waits on it. The page actor that takes the keys of web pages and other add-ons' pages has two ES module halves: `experiment/page_actor_child.sys.mjs`, which runs in each such page's process and holds only the key reader, the field check and the scroll table, and `experiment/page_actor_parent.sys.mjs`, which `pages.js` loads and which holds the registration, the pushes and the key receiver. The hint labels of such a page live in `experiment/page_hints_child.sys.mjs`, which the child loads on the first hint pick in its process, so no scan, label or draw code enters the key child. The keys of a compose window live in `experiment/composewin.js`, which hooks every compose window and holds its one mode for the body and the header fields, the keys of `compose_tree`, the field jumps, close, send and the mode label in the status bar. `content/compose_keys.js` takes only Ctrl+E in the body.
- Each bundle has a size guard in `tools/build.mjs` and a ceiling. The build fails above a guard, and `test/build.test.ts` checks each guard against its ceiling. The raise history is in `docs/design.md`, "Bundle size guards". Guards and ceilings, in bytes:
  - `experiment/keys.js`: guard 26428, ceiling 40960 (`KEYS_MAX_BYTES`).
  - `experiment/overlay.js`: guard 27212, ceiling 40960 (`PARENT_MAX_BYTES`).
  - `experiment/app.js`: guard 11109, ceiling 12800 (`APP_MAX_BYTES`).
  - `content/message_display.js`: guard 19698, ceiling 24576 (`CONTENT_MAX_BYTES`).
  - `experiment/hints.js`: guard 18170, ceiling 20480 (`HINTS_MAX_BYTES`).
  - `experiment/pages.js`: guard 27920, ceiling 34816 (`PAGES_MAX_BYTES`).
  - `experiment/page_actor_child.sys.mjs`: guard 8704, ceiling 11264 (`ACTOR_CHILD_MAX_BYTES`).
  - `experiment/page_actor_parent.sys.mjs`: guard 5632, ceiling 9216 (`ACTOR_PARENT_MAX_BYTES`).
  - `experiment/page_hints_child.sys.mjs`: guard 7680, ceiling 10240 (`ACTOR_HINTS_MAX_BYTES`).
  - `content/page_keys.js`: guard 21400, ceiling 32768 (`PAGE_KEYS_MAX_BYTES`).
  - `experiment/folderpane.js`: guard 5900, ceiling 10240 (`FOLDERPANE_MAX_BYTES`).
  - `experiment/zoom.js`: guard 3544, ceiling 6144 (`ZOOM_MAX_BYTES`).
  - `content/compose_keys.js`: guard 4012, ceiling 8192 (`COMPOSE_MAX_BYTES`).
  - `experiment/composewin.js`: guard 10752, ceiling 15360 (`COMPOSEWIN_MAX_BYTES`).
  - `experiment/filter.js`: guard 5632, ceiling 8192 (`FILTER_MAX_BYTES`).
- Raise a guard only as the last step: the new code passes the admission rule (the commit names the clause), code that fails the rule has moved out first, the step is 512 bytes, and the commit names the feature. Passing a ceiling needs the maintainer's decision and a fresh run of `tools/measure/`. Departures from DesertFox, which has one ceiling on `content.js` only: DesertBird has several bundles, so each has its own ceiling (provisional, about 1.5 times the guard of the day). The current guards are not multiples of 512, so the step applies to later raises only.
- Put no test hooks in `src/`. Tests drive the add-on through its public surface.
- Keep no state only in memory. Store it. A copy of stored state can sit in memory when it refills from storage and drops on `storage.onChanged`. One exception: the command line session (the opening text and the selected message ids) lives in memory only, for the few seconds one overlay is open. Another: the last `.` run in the chrome runtime, which dies with the window. A third: the hud state of each window (the which-key keys, the toasts and the visual mode flag of the label), for the seconds it shows. The insert mode flag of a window (`i` in a page tab) is the same kind of state and is memory only: it ends on Escape, a tab change, a window blur or a closed window. A fourth: the labels and typed letters of a hint pick in the mail window, for the seconds it shows. A fifth: the bridge writes in flight, that is the one pending confirm prompt (its token, window and display list, never a message body) and the queue of `drafts.ts` that saves one draft at a time, each for 30 seconds at most. A sixth: the zoom steps in flight, one promise chain per window, so two fast zoom keys both count. A seventh: the resize mode flag of the chrome runtime (`w r`) with its typed count, the same kind of state as visual mode: it ends on Escape, Enter, a tab change, a window blur, a text field, an open menu, a key in another window or a closed window. An eighth: the mode of a compose window (insert or normal), held by the chrome runtime for the body and the header fields together, memory only. It starts as insert when the window opens and changes only on Escape and `i`, never on focus or blur, because a draft save moves the focus. A ninth: the pick flag of the chrome runtime (Space in the thread list, or the end of visual mode), with the current row and the selected messages the last key left. One selected row looks the same whether it was picked or only read, and nothing in Thunderbird records the difference. It is the same kind of state as visual mode: it ends on Escape, a tab change, a window blur, a key that goes to a text field or the reading pane, a command that removes rows, and a key that finds the list changed. A tenth: the filter applies in flight, one promise chain per mail tab, so the `setQuickFilter` call and the `filter.set` call of one apply never interleave with those of another.
- Write a migration for every change to stored data: extension storage, config files and exports. An installed copy keeps working after an update.
- Keep every static argument rule in the param schema, checked by the one validator. A command handler reports runtime failures only, never a bad argument value.
- Before you build any tool, test runner or workflow, start from its counterpart in the DesertFox repository. Record each departure from it, with its reason, in `docs/design.md` or the PR.

## Public repo rules

Treat this repository as public.

- Do not name other keyboard-driven mail or browser extensions in code, docs, commits or PRs, except in a sourced, factual comparison in `README.md` or under `docs/`. Do not copy their code, because copied code brings its license with it.
- Public files (docs, READMEs, code comments, commit and PR text) never mention who owns the project, anyone's approvals or internal planning.
- Never commit private config or personal data.
- Never assume a personal toolset (a particular desktop, window manager or terminal). Optional integrations stay optional behind the native host.

## Code style

- Carry meaning in names. Comment only what a name cannot say: why this approach, a skipped obvious option, a trap.
- Put the reasoning behind a change in the commit message, not in a comment.
- Do not use emoji in code.

## Commands

Run `npm ci` once. Add each new command here in the commit that adds it.

- `just test`: `npm run check` in a scratch `TMPDIR`, under a systemd user scope with an 8 GB memory cap and a 900 s limit (a plain run with a notice when `systemd-run` is missing). It fails if the run leaves files in its scratch dir. Run it before every commit. `just` calls npm and npm never calls `just`, so CI, `.claude/pre-merge` and contributors without `just` use `npm run check`.
- `just build`: `npm run build`. `just` with no argument lists the recipes. Both recipes install `node_modules` first (`npm ci`) when it is missing or older than `package-lock.json`.
- `npm run docs:gen`: write the tables of `docs/keymap.md` from the default keymaps of each tab kind (`just docs-gen` calls it). `npm run docs:check` fails when they are stale and is the first link of `npm run check`. Every PR that changes a binding runs `npm run docs:gen` and commits the result. Resolve a conflict in `docs/keymap.md` by regenerating, never by hand. Copied from DesertFox's `tools/gen-keymap-docs.ts`, `tools/keymap_docs/{render,splice}.ts` and test with these departures: no site rows doc (DesertBird has none); one table set per tab kind (mail tab from `DEFAULT_KEYMAP`, the rest from `default_keymap_of`) in place of one per keymap mode, because DesertBird has one mode and cuts keys per tab; tables split by `GROUP_NAMES` prefix, to match which-key; key and command columns only, because the label is a which-key phrase and not a command fact; no `MODE_ORDER` guard, since a new tab kind is added to `gen-keymap-docs.ts` by hand; the check reads the whole generator through a subprocess on a copy of the doc, so the test never writes `docs/keymap.md`; the reminder text says `npm run docs:gen` in place of `just docs-gen`, since npm never calls `just`.
- `npm run check`: docs check, lint, typecheck, `npm run unit` and `npm run defaults:check`. Run it before every commit if `just` is not installed.
- `npm run lint`: typescript-eslint on `src/` and the `.ts` tools: `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, strict `no-unused-vars` (`_` prefix spares a name), `no-eval` and a ban on a silent `.catch`/`.then` handler (use a helper from `src/shared/swallow.ts`). Copied from DesertFox with three departures: `vendor/` is ignored in place of `web-ext-artifacts/`, the warn prefix is `desertbird:`, and the `tools/**/*.ts` glob now lints the `.ts` tools (`tools/check_default_settings.ts`, `tools/gen-keymap-docs.ts`, `tools/keymap_docs/`, `tools/owner_test/`), and the other tools here are `.mjs` or shell.
- `npm run typecheck`: `tsc --noEmit` over `src/`, `tools/` and `test/`.
- `npm run unit`: `node --test` on `test/**/*.test.ts`, with a 30 s timeout and no `--test-force-exit` (it lost the last results of a file under load). `tools/check_unit_count.ts` runs it and fails when a test file reports fewer tests than its count of `test(` and `it(` calls (a floor: tests built in loops report more). Extra arguments go to `node --test` after the glob and turn the guard off. The script kills the run, test file children included, and fails after 5 minutes (a full run takes about 30 s), because without force-exit a test that leaks a timer or a server keeps the run alive. `unit:file` has no such limit. Run unit tests only through `npm run check`, `just test` or this script (or `unit:file`), never with bare `node --test`, so the timeout always applies. `npm test` runs `npm run check`.
- `npm run unit:file -- <file>`: the same flags on one file. `npm run unit:file -- --test-name-pattern=<name> "test/**/*.test.ts"` runs only the tests whose name matches (put the flag first, since node stops reading options at the first file). `npm run unit -- <file>` still runs the whole glob, unguarded.
- `npm run defaults:check [<desertfox-checkout>]`: compare the setting defaults with the DesertFox table at the pin. It skips with a warning when no checkout is given and `DESERTFOX_DIR` is unset, so `npm run check` runs it and passes without a checkout. `just settings-defaults [<checkout>]` runs it with the checkout from the argument or `DESERTFOX_DIR`.
- `tools/vendor_desertfox.sh [--verify] <desertfox-checkout>`: write or check `vendor/desertfox/` against the pin.
- `npm run build`: typecheck, then `tools/build.mjs`. It writes `dist/` (`background.js`, `content/message_display.js`, `content/page_keys.js`, `content/compose_keys.js`, `experiment/keys.js`, `experiment/overlay.js`, `experiment/app.js`, `experiment/folderpane.js`, `experiment/hints.js`, `experiment/pages.js`, `experiment/zoom.js`, `experiment/composewin.js`, `experiment/filter.js`, their schemas, the page actor's `experiment/page_actor_child.sys.mjs`, `experiment/page_actor_parent.sys.mjs` and `experiment/page_hints_child.sys.mjs`, `overlay/`, the vendored `vendor/marked/` and `vendor/turndown/` files as they are, `manifest.json`) and an unsigned `dist/desertbird.xpi`. It fails when a parent bundle passes its size budget.
- `npm run e2e [-- thunderbird|betterbird] [--xpi dist/desertbird.xpi]`: headless end-to-end run. The `web` kind checks the page actor against a local web server of its own. `E2E_KINDS=web` runs it alone. The run is a list of pieces, and `E2E_KINDS`, `E2E_ONLY` and `E2E_SCALE` pick them. `E2E_SHARDS=<n>` runs them on `n` workers at once (default 1, the serial run). Needs labwc, wtype, wlrctl, grim, zip, unzip and a Thunderbird or Betterbird binary. See `tools/e2e/README.md`.
- `just e2e [args]`, `just e2e-changed`, `just e2e-sweep`: the e2e run on 3 workers under a one-run-per-machine lock, a capped systemd scope and a sweep of dead runs' apps. `e2e-changed` runs the pieces a change can affect (Betterbird). See `tools/e2e/README.md` (Scope and lock).
- `npm run e2e:weights [timings file]`: rewrite `tools/e2e/piece_seconds.json`, the piece weights that order a sharded e2e run, from a full unfiltered serial run (default: the newest such `.logs/e2e-timings-*.json`). It refuses the file of a sharded run.
- `node tools/e2e/measure_concurrent.mjs [thunderbird|betterbird] --xpi dist/desertbird.xpi [--counts 1,4]`: start 1 and then 4 apps at once (or the counts given) and record startup time and peak memory. See `tools/e2e/README.md`.
- `just owner-test [worktree] [hint]... [--app thunderbird]`, `just owner-test-reload [worktree]`, `just owner-test-status [worktree]`, `just owner-test-close [worktree]`: open (with `name value` setting hints), reload, check and close a visible test window. An agent opens a window on the maintainer's display only for a hand check the maintainer asked for, and tests or debugs the tool itself only in a nested headless session, never on that display. See `tools/owner_test/README.md`.

## Planning

`.plans/` holds the trackers for work in progress and `.logs/` holds evidence: check output and review notes. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`, and open a PR for each change.
- Put worktrees in a `desertbird-worktrees/` folder beside the main checkout.
- Every new `.ts`, `.css` or `.html` file under `src/` needs a line in its folder README (a line like "- `name.ts`: what it does"). `test/tools/readme_coverage.test.ts` fails and names the file when the line is missing. It follows DesertFox's test of the same name with two departures: it scans `src/` only, because DesertBird has no other source tree with READMEs, and it also accepts the path from the README's folder (`handlers/undo.ts`), because the background README lists its subfolder files that way.
- CI: `.github/workflows/ci.yml` and `.claude/pre-merge` run `npm run check` and `npm run build`.
- The `justfile` follows DesertFox's. Departures: `just` calls npm (DesertFox's npm scripts hold the checks and its `test` also runs host tests, which DesertBird lacks); `install_deps` compares `package-lock.json` with `node_modules/.package-lock.json` and runs `npm ci` (DesertFox pins web-ext through `jq`, which DesertBird does not use); the scratch prefix is `desertbird-test-run.*`; the scope has no `just` sub-run, only `npm run check`; no key-test or owner-test recipes (DesertBird has none of those tools). The `docs-gen` recipe calls `npm run docs:gen`.
