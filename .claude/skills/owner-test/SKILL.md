---
name: owner-test
description: Open a visible Betterbird or Thunderbird window with a worktree's build in a throwaway profile so the maintainer can test by hand, reload it after a rebuild, and close it when the maintainer is done. Use before any hands-on maintainer test.
---

# owner-test

The window shows on the maintainer's desktop, with fixture mail in a throwaway profile. Each worktree has its own window and profile, so parallel agents do not collide. The tool never touches a real profile (`~/.thunderbird` and the like). See `tools/owner_test/README.md`.

Run the tool on the maintainer's display only for a hand check the maintainer asked for. To test or debug the tool itself, use only a nested headless session (`tools/measure/session.mjs`), never the maintainer's display, and make sure every process it starts exits.

1. Run `just owner-test <worktree> [hint]...` once per test round. A hint is `name value`, one setting the maintainer changes on the options page for this check (for example `toast_ms 3000`). A typo fails at once. Add `--app thunderbird` for Thunderbird, which needs `tools/measure/fetch_thunderbird.sh` once. The default is Betterbird.
2. If it prints `WRONG BUILD` or fails, stop and report. Do not hand over a window that shows another build.
3. Run `just owner-test-status <worktree>` right before the hand-over. It says `WRONG BUILD` or `stale` when the window is not the build. Then stop and report.
4. Give the maintainer what to look at, the exact keys and the printed hints. The profile is new, so any permission the maintainer must grant is asked once per `just owner-test`, not per reload.
5. After each fix run `just owner-test-reload <worktree>`. It closes the app and starts it again on the same profile, so the window state is lost and the profile stays. Tell the maintainer it reloaded.
6. When the maintainer says done, run `just owner-test-close <worktree>` and check that it printed `closed`. Never end a session with the window open.
7. Do not start Betterbird or Thunderbird any other way for a hand check. Do not put a profile in `/tmp`.

Running `just owner-test` again on the same worktree replaces that worktree's window with a new profile. Use the reload to keep the profile.
