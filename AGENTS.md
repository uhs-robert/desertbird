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
| Body script: keys in a message document (pane, tab, window) | [`src/content/README.md`](src/content/README.md) |
| Hud in the background: which-key panel, toasts, mode badge | [`src/background/hud/README.md`](src/background/hud/README.md) |
| Help page generated from the registry | [`src/help/README.md`](src/help/README.md) |
| End-to-end run in Thunderbird and Betterbird | [`tools/e2e/README.md`](tools/e2e/README.md) |
| Pinned DesertFox copy: pin, stand-ins, local edits | [`vendor/desertfox/VENDOR.md`](vendor/desertfox/VENDOR.md) |
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
- The chrome runtime follows the same admission rule as DesertFox `content.js`: code goes in only if it runs before the first key or decides what happens to a key, serves a key pressed in most windows (motions), is needed to load the other parts, or must work while the window changes state. Everything else goes in the background page or an on-demand bundle. The chrome runtime has its own size guard, set in the build: each parent bundle (`experiment/keys.js`, `experiment/overlay.js`) stays within 22500 bytes (its first measured size as its own bundle, 15003 bytes, plus 20 percent made 18004. The reading-pane handoff to the body script added 372 bytes, and the guard rose to 18004 plus 372 rounded up to 18400. The thread verbs of the view API took it from 18358 on main to 20501, and the guard rose to 18400 plus 2143 rounded up to 20600. Visual mode and the row flags took it from 20501 on main to 21451, and the guard rose to 20600 plus 950 rounded up to 21600. Ending visual mode when the list changes under it, and collapsing the range after a command, made it 21785, and the guard was 20600 plus 1284 rounded up to 21900. Checking the message keys at both ends of the range made it 21996, and the guard was 20600 plus 1495 rounded up to 22100. The report of the typed prefix for which-key added 305 bytes, and the guard is 22100 plus 305 rounded up to 22500). Raise it only with a reason in the commit message. The body script bundle (`content/message_display.js`, injected into every message document) has its own guard: 15900 bytes (its first measured size, 8861 bytes, plus 20 percent made 10633. Find in the message and hint labels brought the bundle from 8984 to 14558 bytes, and the guard rose to that size rounded up to 14600. The hint fixes (a visibility check, a shadow root for the labels, ending the labels on scroll and blur, and a focus pick) added 1321 bytes, making 15879, and the guard rose to 15900). The same rule applies.
- Put no test hooks in `src/`. Tests drive the add-on through its public surface.
- Keep no state only in memory. Store it. A copy of stored state can sit in memory when it refills from storage and drops on `storage.onChanged`. One exception: the command line session (the opening text and the selected message ids) lives in memory only, for the few seconds one overlay is open. Another: the last `.` run in the chrome runtime, which dies with the window. A third: the hud state of each window (the which-key keys, the toasts and the badge mode), for the seconds it shows.
- Write a migration for every change to stored data: extension storage, config files and exports. An installed copy keeps working after an update.
- Keep every static argument rule in the param schema, checked by the one validator. A command handler reports runtime failures only, never a bad argument value.

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
- `npm run build`: typecheck, then `tools/build.mjs`. It writes `dist/` (`background.js`, `content/message_display.js`, `experiment/keys.js`, `experiment/overlay.js`, their schemas, `overlay/`, `manifest.json`) and an unsigned `dist/desertbird.xpi`. It fails when the parent bundle passes the size budget.
- `npm run e2e [-- thunderbird|betterbird] [--xpi dist/desertbird.xpi]`: headless end-to-end run. Needs labwc, wtype, grim, zip, unzip and a Thunderbird or Betterbird binary. See `tools/e2e/README.md`.

## Planning

`.plans/` holds the trackers for work in progress and `.logs/` holds evidence: check output and review notes. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`, and open a PR for each change.
