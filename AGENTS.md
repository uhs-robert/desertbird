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
- The chrome runtime follows the same admission rule as DesertFox `content.js`: code goes in only if it runs before the first key or decides what happens to a key, serves a key pressed in most windows (motions), is needed to load the other parts, or must work while the window changes state. Everything else goes in the background page or an on-demand bundle. The chrome runtime has its own size guard, set in the build: `experiment/keys.js` stays within 18004 bytes (its first measured size as its own bundle, 15003 bytes, plus 20 percent). Raise it only with a reason in the commit message.
- Put no test hooks in `src/`. Tests drive the add-on through its public surface.
- Keep no state only in memory. Store it. A copy of stored state can sit in memory when it refills from storage and drops on `storage.onChanged`.
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
- `npm run build`: typecheck, then `tools/build.mjs`. It writes `dist/` (`background.js`, `experiment/keys.js`, `experiment/keys.schema.json`, `manifest.json`) and an unsigned `dist/desertbird.xpi`. It fails when the parent bundle passes the size budget.
- `npm run e2e [-- thunderbird|betterbird] [--xpi dist/desertbird.xpi]`: headless end-to-end run. Needs labwc, wtype, grim, zip, unzip and a Thunderbird or Betterbird binary. See `tools/e2e/README.md`.

## Planning

`.plans/` holds the trackers for work in progress and `.logs/` holds evidence: check output and review notes. Git ignores both. At the end of a topic, move anything durable into the repo, then delete them.

## Git

- Write commit messages as Conventional Commits, with a body that explains why.
- Work on a branch, never on `main`, and open a PR for each change.
