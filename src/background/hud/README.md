# Hud, background side

The which-key panel, the toasts and the mode badge of each main window. The page (`src/overlay/hud.ts`) only draws. This side decides what shows and when, and mounts the page while something shows.

| File | Role |
| --- | --- |
| `service.ts` | One state per window: the typed keys the panel lists, the toasts and a mount flag. Reads `pending` events, answers the page's `hud.state` message and tells a mounted page to ask again (`hud.changed`). Mounts the `hud` surface while something shows and unmounts it when nothing does |
| `which_key.ts` | Pure: the continuations of a typed prefix from the compiled tree, and whether the panel may open on its own (`which_key_delay_ms`, `which_key_skip`) |
| `toasts.ts` | Pure: the stack of toasts of one window, each with its own timer. Timers come in as a parameter, so tests move the clock |

## Rules

- The chrome runtime reports only the typed prefix, as a `pending` event on `keys.onInvocation`. It adds a tab change and a window blur to nothing: the background hears those from `tabs.onActivated` and `windows.onFocusChanged` and calls `close_which_key`.
- The panel opens after `which_key_delay_ms` of a pending prefix. A delay of 0 turns it off. A prefix in `which_key_skip` (typed keys joined, for example `gu`) opens no panel by itself. A panel that is already up redraws at once for a longer prefix, as in DesertFox.
- A toast lasts `toast_error_ms` for a refusal and `toast_ms` for a result. A time of 0, a missing window or a missing Experiment sends the message to a system notification instead, so no message is lost.
- The badge follows `mode_indicator`: `not_normal` (the default) shows the mode when it is not `normal`, `always` mounts the page in every main window for a badge that reads `NORMAL`, `off` shows nothing. No part of the add-on has another mode than `normal` yet, so `mode_of` in `main.ts` answers `normal` and the default mounts no page at start.
- Settings are read through the config store on each use, and `storage.onChanged` on the settings key calls `settings_changed`, so a panel that shows redraws with the new border and the badge mounts or goes without a restart. A delay or toast time change applies to the next panel or toast.
- Toasts show above the command line box while it is open: the command line is mounted through `lifting_toasts`, which tells the service, and the page moves its toasts up (`lifted` in the state). A toast counts as shown only when the page mounted. Otherwise `toast` answers false and `notify.ts` sends a system notification.
- A keymap reinstall closes the panel, because a new matcher forgets the sequence without a report.
- State is in memory only (an exception recorded in `AGENTS.md`): a few seconds of interface state per window, like the command line session. The page keeps none, and the background restart drops all of it.
- The hud page and the command line page are separate surfaces, so a toast or the panel never replaces the command line. The command line box sits above the hud, and a key that opens the command line ends the pending sequence first, which removes the panel.
