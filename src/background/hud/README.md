# Hud, background side

The which-key panel and the toasts of each main window, and the mode label of its status bar. The page (`src/overlay/hud.ts`) only draws the panel and the toasts. This side decides what shows and when, and mounts the page while something shows. The label is no page: the Experiment draws it in the status bar and this side tells it what to show (`overlay.setModeLabel`).

| File | Role |
| --- | --- |
| `service.ts` | One state per window: the typed keys the panel lists, the toasts, the visual mode flag and a mount flag. Reads `pending` and `mode` events, answers the page's `hud.state` message and tells a mounted page to ask again (`hud.changed`). Mounts the `hud` surface while something shows and unmounts it when nothing does. `mode_of` gives the bridge the mode of a window |
| `which_key.ts` | Pure: the continuations of a typed prefix from the compiled tree, and whether the panel may open on its own (`which_key_delay_ms`, `which_key_skip`) |
| `toasts.ts` | Pure: the stack of toasts of one window, each with its own timer. Timers come in as a parameter, so tests move the clock |

## Rules

- The chrome runtime reports only the typed prefix, as a `pending` event on `keys.onInvocation`. It adds a tab change and a window blur to nothing: the background hears those from `tabs.onActivated` and `windows.onFocusChanged` and calls `close_which_key`.
- The panel opens after `which_key_delay_ms` of a pending prefix. A delay of 0 turns it off. A prefix in `which_key_skip` (typed keys joined, for example `gu`) opens no panel by itself. A panel that is already up redraws at once for a longer prefix, as in DesertFox.
- `help.whichkey` (`g?`) calls `show_root`: the panel of the root keys shows at once, with no delay and whatever `which_key_delay_ms` says. The key runtime keeps its `pending` report armed after that command, so the next key in the mail tab, or in a calendar, address book or settings tab, reports an end and removes the panel. A message document reports no typed keys, so `g?` there opens the help page instead.
- A toast lasts `toast_error_ms` for a refusal and `toast_ms` for a result. A time of 0, a missing window or a missing Experiment sends the message to a system notification instead, so no message is lost.
- The mode label follows `mode_indicator` (`always`, the default, `not_normal` or `off`) and `mode_indicator_style` (`classic`, the default, or `badge`). The key runtime reports `mode` events, `visual` when visual mode starts and `normal` when it ends. The service keeps that per window and sends it with both settings and the label colors of the `theme` setting (`src/background/theme/palette.ts`) to `overlay.setModeLabel` on each change, at `track` (a window open at start or opened later) and on a settings change. The Experiment turns the mode into insert while a text field has the focus and applies `mode_indicator` to the result, so insert mode never crosses to the background. The label mounts no hud page.
- Settings are read through the config store on each use, and `storage.onChanged` on the settings key calls `settings_changed`, so a panel that shows redraws with the new border and the label changes or goes without a restart. A delay or toast time change applies to the next panel or toast.
- Toasts show above the command line box while it is open: the command line is mounted through `lifting_toasts`, which tells the service, and the page moves its toasts up (`lifted` in the state). A toast counts as shown only when the page mounted. Otherwise `toast` answers false and `notify.ts` sends a system notification.
- A keymap reinstall closes the panel, because a new matcher forgets the sequence without a report.
- State is in memory only (an exception recorded in `AGENTS.md`): a few seconds of interface state per window, like the command line session. The page keeps none, and the background restart drops all of it.
- The hud page and the command line page are separate surfaces, so a toast or the panel never replaces the command line. The command line box sits above the hud, and a key that opens the command line ends the pending sequence first, which removes the panel.
