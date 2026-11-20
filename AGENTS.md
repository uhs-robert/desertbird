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
| Body script: keys in a message document (pane, tab, window) and on the options and help pages. Compose script: Ctrl+E, insert and normal mode and the mode label in a compose body | [`src/content/README.md`](src/content/README.md) |
| Search in the background: live Quick Filter search, the `/` register, `n` and `N` | [`src/background/search/README.md`](src/background/search/README.md) |
| Hud in the background: which-key panel, toasts, mode label | [`src/background/hud/README.md`](src/background/hud/README.md) |
| Bridge to the native host: the `bridge` setting, the never-list, the port and its frames | [`src/background/bridge/README.md`](src/background/bridge/README.md) |
| Theme: the `theme` setting, role colors for pages, mode label colors | [`src/background/theme/README.md`](src/background/theme/README.md) |
| Help page generated from the registry | [`src/help/README.md`](src/help/README.md) |
| Default keys of each tab kind, generated (never edit by hand) | [`docs/keymap.md`](docs/keymap.md) |
| End-to-end run in Thunderbird and Betterbird | [`tools/e2e/README.md`](tools/e2e/README.md) |
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
- The chrome runtime follows the same admission rule as DesertFox `content.js`: code goes in only if it runs before the first key or decides what happens to a key, serves a key pressed in most windows (motions), is needed to load the other parts, or must work while the window changes state. Everything else goes in the background page or an on-demand bundle. The same rule applies to the body script bundle. The thread list, pane focus, command and page verbs live in `experiment/app.js`, which Thunderbird loads on the first call, and no verb module (`app_verbs.ts`, `view_verbs.ts`) may enter `experiment/keys.js`. Hint pick keys live in `experiment/hints.js`, which holds `sendEnter` and `pick` and nothing from the key runtime. The keys of every tab but the mail tab live in `experiment/pages.js`. Compose keys live in `content/compose_keys.js`, which takes only Ctrl+E, Ctrl+O and `e` after Ctrl+O or Escape.
- Each bundle has a size guard in `tools/build.mjs` and a ceiling. The build fails above a guard, and `test/build.test.ts` checks each guard against its ceiling. The raise history is in `docs/design.md`, "Bundle size guards". Guards and ceilings, in bytes:
  - `experiment/keys.js`: guard 22844, ceiling 40960 (`KEYS_MAX_BYTES`).
  - `experiment/overlay.js`: guard 27212, ceiling 40960 (`PARENT_MAX_BYTES`).
  - `experiment/app.js`: guard 8549, ceiling 12800 (`APP_MAX_BYTES`).
  - `content/message_display.js`: guard 18162, ceiling 24576 (`CONTENT_MAX_BYTES`).
  - `experiment/hints.js`: guard 13050, ceiling 20480 (`HINTS_MAX_BYTES`).
  - `experiment/pages.js`: guard 22800, ceiling 34816 (`PAGES_MAX_BYTES`).
  - `content/page_keys.js`: guard 21400, ceiling 32768 (`PAGE_KEYS_MAX_BYTES`).
  - `experiment/folderpane.js`: guard 5900, ceiling 10240 (`FOLDERPANE_MAX_BYTES`).
  - `content/compose_keys.js`: guard 3500, ceiling 8192 (`COMPOSE_MAX_BYTES`).
- Raise a guard only as the last step: the new code passes the admission rule (the commit names the clause), code that fails the rule has moved out first, the step is 512 bytes, and the commit names the feature. Passing a ceiling needs the maintainer's decision and a fresh run of `tools/measure/`. Departures from DesertFox, which has one ceiling on `content.js` only: DesertBird has several bundles, so each has its own ceiling (provisional, about 1.5 times the guard of the day). The current guards are not multiples of 512, so the step applies to later raises only.
- Put no test hooks in `src/`. Tests drive the add-on through its public surface.
- Keep no state only in memory. Store it. A copy of stored state can sit in memory when it refills from storage and drops on `storage.onChanged`. One exception: the command line session (the opening text and the selected message ids) lives in memory only, for the few seconds one overlay is open. Another: the last `.` run in the chrome runtime, which dies with the window. A third: the hud state of each window (the which-key keys, the toasts and the visual mode flag of the label), for the seconds it shows. A fourth: the labels and typed letters of a hint pick in the mail window, for the seconds it shows. A fifth: the bridge writes in flight, that is the one pending confirm prompt (its token, window and display list, never a message body) and the queue of `drafts.ts` that saves one draft at a time, each for 30 seconds at most.
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
- `npm run lint`: typescript-eslint on `src/` and the `.ts` tools: `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, strict `no-unused-vars` (`_` prefix spares a name), `no-eval` and a ban on a silent `.catch`/`.then` handler (use a helper from `src/shared/swallow.ts`). Copied from DesertFox with three departures: `vendor/` is ignored in place of `web-ext-artifacts/`, the warn prefix is `desertbird:`, and the `tools/**/*.ts` glob now lints the `.ts` tools (`tools/check_default_settings.ts`, `tools/gen-keymap-docs.ts`, `tools/keymap_docs/`), and the other tools here are `.mjs` or shell.
- `npm run typecheck`: `tsc --noEmit` over `src/`, `tools/` and `test/`.
- `npm run unit`: `node --test` on `test/**/*.test.ts`. `npm test` runs `npm run check`.
- `npm run defaults:check [<desertfox-checkout>]`: compare the setting defaults with the DesertFox table at the pin. It skips with a warning when no checkout is given and `DESERTFOX_DIR` is unset, so `npm run check` runs it and passes without a checkout. `just settings-defaults [<checkout>]` runs it with the checkout from the argument or `DESERTFOX_DIR`.
- `tools/vendor_desertfox.sh [--verify] <desertfox-checkout>`: write or check `vendor/desertfox/` against the pin.
- `npm run build`: typecheck, then `tools/build.mjs`. It writes `dist/` (`background.js`, `content/message_display.js`, `content/page_keys.js`, `content/compose_keys.js`, `experiment/keys.js`, `experiment/overlay.js`, `experiment/app.js`, `experiment/folderpane.js`, `experiment/hints.js`, `experiment/pages.js`, their schemas, `overlay/`, the vendored `vendor/marked/` and `vendor/turndown/` files as they are, `manifest.json`) and an unsigned `dist/desertbird.xpi`. It fails when a parent bundle passes its size budget.
- `npm run e2e [-- thunderbird|betterbird] [--xpi dist/desertbird.xpi]`: headless end-to-end run. Needs labwc, wtype, wlrctl, grim, zip, unzip and a Thunderbird or Betterbird binary. See `tools/e2e/README.md`.
- `node tools/e2e/measure_concurrent.mjs [thunderbird|betterbird] --xpi dist/desertbird.xpi [--counts 1,4]`: start 1 and then 4 apps at once (or the counts given) and record startup time and peak memory. See `tools/e2e/README.md`.

## Planning

`.plans/` holds the trackers for work in progress and `.logs/` holds evidence: check output and review notes. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`, and open a PR for each change.
- Put worktrees in a `desertbird-worktrees/` folder beside the main checkout.
- Every new file under `src/` needs a line in its folder README (a line like "- `name.ts`: what it does"). `test/tools/readme_coverage.test.ts` fails and names the file when the line is missing. It follows DesertFox's test of the same name with two departures: it scans `src/` only, because DesertBird has no other source tree with READMEs, and it also accepts the path from the README's folder (`handlers/undo.ts`), because the background README lists its subfolder files that way.
- CI: `.github/workflows/ci.yml` and `.claude/pre-merge` run `npm run check` and `npm run build`.
- The `justfile` follows DesertFox's. Departures: `just` calls npm (DesertFox's npm scripts hold the checks and its `test` also runs host tests, which DesertBird lacks); `install_deps` compares `package-lock.json` with `node_modules/.package-lock.json` and runs `npm ci` (DesertFox pins web-ext through `jq`, which DesertBird does not use); the scratch prefix is `desertbird-test-run.*`; the scope has no `just` sub-run, only `npm run check`; no key-test or owner-test recipes (DesertBird has none of those tools). The `docs-gen` recipe calls `npm run docs:gen`.
