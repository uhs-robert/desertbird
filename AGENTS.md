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
| End-to-end run in Thunderbird and Betterbird | [`tools/e2e/README.md`](tools/e2e/README.md) |
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
- The chrome runtime follows the same admission rule as DesertFox `content.js`: code goes in only if it runs before the first key or decides what happens to a key, serves a key pressed in most windows (motions), is needed to load the other parts, or must work while the window changes state. Everything else goes in the background page or an on-demand bundle. The same rule applies to the body script bundle. The keys of a hint pick stay out of `experiment/keys.js` in `experiment/hints.js`, and compose keys in `content/compose_keys.js`.
- Each bundle has a size guard in `tools/build.mjs` and a ceiling. The build fails above a guard, and `test/build.test.ts` checks each guard against its ceiling. The raise history is in `docs/design.md`, "Bundle size guards". Guards and ceilings, in bytes:
  - `experiment/keys.js` and `experiment/overlay.js`, each: guard 27000, ceiling 40960 (`PARENT_MAX_BYTES`).
  - `content/message_display.js`: guard 17650, ceiling 24576 (`CONTENT_MAX_BYTES`).
  - `experiment/hints.js`: guard 13050, ceiling 20480 (`HINTS_MAX_BYTES`).
  - `experiment/folderpane.js`: guard 5900, ceiling 10240 (`FOLDERPANE_MAX_BYTES`).
  - `content/compose_keys.js`: guard 3500, ceiling 8192 (`COMPOSE_MAX_BYTES`).
- Raise a guard only as the last step: the new code passes the admission rule (the commit names the clause), code that fails the rule has moved out first, the step is 512 bytes, and the commit names the feature. Passing a ceiling needs the maintainer's decision and a fresh run of `tools/measure/`. Departures from DesertFox, which has one ceiling on `content.js` only: DesertBird has five bundles, so each has its own ceiling (provisional, about 1.5 times the guard of the day). The current guards are not multiples of 512, so the step applies to later raises only.
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

- `npm run check`: lint, typecheck and test. Run it before every commit.
- `npm run lint`: typescript-eslint with `no-floating-promises` and `no-misused-promises` on `src/` and `tools/`.
- `npm run typecheck`: `tsc --noEmit` over `src/`, `tools/` and `test/`.
- `npm test`: `node --test` on `test/**/*.test.ts`.
- `tools/vendor_desertfox.sh [--verify] <desertfox-checkout>`: write or check `vendor/desertfox/` against the pin.
- `npm run build`: typecheck, then `tools/build.mjs`. It writes `dist/` (`background.js`, `content/message_display.js`, `content/page_keys.js`, `content/compose_keys.js`, `experiment/keys.js`, `experiment/overlay.js`, `experiment/folderpane.js`, `experiment/hints.js`, their schemas, `overlay/`, the vendored `vendor/marked/` and `vendor/turndown/` files as they are, `manifest.json`) and an unsigned `dist/desertbird.xpi`. It fails when a parent bundle passes its size budget.
- `npm run e2e [-- thunderbird|betterbird] [--xpi dist/desertbird.xpi]`: headless end-to-end run. Needs labwc, wtype, wlrctl, grim, zip, unzip and a Thunderbird or Betterbird binary. See `tools/e2e/README.md`.
- `node tools/e2e/measure_concurrent.mjs [thunderbird|betterbird] --xpi dist/desertbird.xpi [--counts 1,4]`: start 1 and then 4 apps at once (or the counts given) and record startup time and peak memory. See `tools/e2e/README.md`.

## Planning

`.plans/` holds the trackers for work in progress and `.logs/` holds evidence: check output and review notes. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`, and open a PR for each change.
