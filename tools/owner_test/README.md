# owner_test

Opens a visible Betterbird or Thunderbird window with one worktree's build in a throwaway profile, so the maintainer can test by hand. Each worktree has its own window, profile and state, keyed by the worktree path. Two worktrees never touch each other's window.

```
node --no-warnings tools/owner_test/cli.ts open   [worktree] [--app betterbird|thunderbird] [--binary path]
node --no-warnings tools/owner_test/cli.ts reload [worktree] [--app ...]
node --no-warnings tools/owner_test/cli.ts close  [worktree]
```

`open` builds the worktree, stamps a copy of the xpi, builds a fresh profile and starts the app. `reload` rebuilds, closes the app and starts it again on the same profile. `close` stops the app and deletes the window folder. The agent workflow is in `.claude/skills/owner-test/SKILL.md`.

## Safety

The tool never reads, copies or writes a real profile folder (`~/.thunderbird`, `~/.betterbird`, `~/.mozilla/thunderbird`, `~/.config/thunderbird`).

- Everything lives in one window folder, `$XDG_CACHE_HOME/desertbird/owner-test/<key>/`: `profile/`, the app's private `home/` and `app.log`. Close deletes that folder and nothing else. Its path comes from the caller's worktree, never from the state file. A folder that is a symlink, or sits behind one, is left alone.
- `refusal_reason` (`paths.ts`) runs before every action, open and reload included. It refuses a relative or empty root, any path that resolves into a real profile folder (also through a symlink, and also when only the folders below a linked cache folder do not exist yet), and a window folder that is a symlink or sits behind one. The real folders are looked up under `$HOME` and under the home of the account database, so a mocked `HOME` hides nothing.
- Close signals a recorded pid only when its command line holds `-profile <this profile>`, so a hand-edited state file cannot name another app. Members of the app's process group are listed while the leader runs and each that outlives it gets SIGKILL, checked by start ticks. No group signal is sent.
- The app starts with `-profile <dir> -no-remote` and a `HOME` set to the window's own `home/`. Betterbird reads `~/.thunderbird`, so without that it could create files there. Only display and locale variables pass through.
- The profile holds the fixture mail of the e2e tests (`build_profile`, kind `owner`). No real mail is copied.
- A state file that names another worktree or profile is refused whole: nothing is signalled or deleted.

## Files

- `cli.ts`: the actions, each under a per-worktree lock (`lock.ts`, `flock`). The lock is kernel-held, so a crash never leaves a stale one.
- `paths.ts`: the state file (`$XDG_STATE_HOME/desertbird/owner-test/<key>.json`), the window folder and the safety checks above.
- `state.ts`: the state file, written atomically with mode 0600 before anything starts. A crash after the spawn leaves a record that close cleans. A file cut off by a crash reads as corrupt and close falls back to the profile folder.
- `process_guard.ts`: a recorded pid counts only while its start ticks (field 22 of `/proc/<pid>/stat`) still match, so a reused pid is never signalled.
- `close.ts`: stops the recorded process, then any main process whose command line holds exactly `-profile <this profile>`, then deletes the window folder. It escalates from SIGTERM to SIGKILL and keeps the folder and state when a process survives.
- `lifecycle.ts`: open, reload and close, with the machine passed in as deps so tests drive them with fakes. The build comes first and the old window is closed only after it succeeded. Reload keeps the app and binary the window was opened with and refuses an explicit `--app` that differs. The stamped xpi is staged in `<cache root>/<key>.stage/` and removed at the end.
- `launch.ts`: the binary, the stamped xpi, the profile, the detached start and the real system calls close uses. The unit field of the state and `stop_unit` are in place for a systemd unit later.

Betterbird is `/usr/bin/betterbird`. Thunderbird comes from `tools/measure/fetch_thunderbird.sh` (`$MEASURE_DIR`, default `/tmp/desertbird-measure`). `--binary` overrides both.

The loaded build is proved two ways. The xpi in the profile carries a `version_name` stamp (branch, commit, dirty mark, time) that open reads back. The app's own `extensions.json` must list the add-on as active with an update date no older than that file, so a record from before a reload does not count.

## Departures from the DesertFox tool

DesertFox `tools/owner_test/` is the base. These differ, each for the reason given.

- Betterbird or Thunderbird started directly, in place of `web-ext run` and Firefox's remote debugger. Those two need Firefox. There is no `web_ext.ts`, `rdp_probe.ts`, `probe.ts`, `profile.ts` (the DesertFox `user.js` seeding) or `refusal` of a nested session.
- The profile comes from `tools/e2e/profile.mjs` (`build_profile`, kind `owner`) in place of a seeded `user.js`, so the window has fixture mail.
- Reload is close and start again, because Thunderbird has no live reload. The profile stays, so storage survives. The build is stamped into the xpi (`version_name`) and read back, where DesertFox asks the debugger.
- The window folder holds the profile, a private `HOME`, and the log, and close deletes the whole folder. DesertFox deletes the profile folder and the log. The private `HOME` is new: Firefox does not read a real profile folder when `-profile` is given, but Betterbird uses `~/.thunderbird` for its own files.
- Close can find the app by its profile folder in `/proc`. DesertFox keeps a state with no recorded pid forever and asks to run close again. Here a crash between the state file and the spawn cleans up on the next close.
- A symlink check on the window folder and `refusal_reason` against the real profile folders are new, because the profile is deleted and the apps' real profiles sit in the same home.
- Nested sessions are not refused. DesertFox refuses them, since its tool is for the maintainer's own desktop. Here the unit tests and the real launches of an agent that tests the tool run inside the nested headless session from `tools/measure/session.mjs`, so the rule lives in the skill: an agent opens a window on the maintainer's display only for a hand check the maintainer asked for, and tests or debugs the tool only in a nested session.
- The files are `.ts` run by `node --no-warnings`, as in DesertFox. The `tools/**/*.ts` lint glob matched no file before and now covers these.
- Reload starts a new app when the old one is gone, where DesertFox refuses. The 2 GB free-space check is dropped: the profile holds a few small fixture folders.
- Left for a later change: the systemd unit (this one starts the app detached), the `:set` hints and a status action.
