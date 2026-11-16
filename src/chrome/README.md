# Chrome runtime

The privileged part of the add-on. It runs as the parent script of the `keys` Experiment, inside the Thunderbird process, and listens for keys in the main mail window. The schema is [`../experiment/keys.schema.json`](../experiment/keys.schema.json). The call shapes are in [`../shared/protocol.ts`](../shared/protocol.ts).

| File | Role |
| --- | --- |
| `parent_keys.ts` | The entry of the `keys` API: `get_keys_api` and `shutdown`. Holds the one runtime and the event subscribers |
| `platform.ts` | The Thunderbird globals the parent reads, the tab strip that fires `TabSelect`, and the guard that rethrows `ExtensionError(message)` from each verb |
| `focus.ts` | Where a key is going: a text field, the reading pane or an open menu. Follows the focused element through shadow roots and into browser documents |
| `runtime.ts` | Key handling. Takes its Thunderbird access as `RuntimeDeps`, so tests use fakes |
| `motions.ts` | The fixed motion table: `motion.down`, `motion.up`, `motion.top`, `motion.bottom`. Pure functions over a `ViewPort` |
| `view.ts` | The thread list of `about:3pane` (`gDBView`, `threadTree`) behind a `ListPort`: the rows for the motions and the selected message ids for background commands. Also the check that the front tab is the mail tab |

Three files know Thunderbird's own markup, so a Thunderbird rename lands in one of them:
- `view.ts`: `gDBView`, `getSelectedMsgHdrs`, `threadTree` and the tab mode `mail3PaneTab`.
- `focus.ts`: the element ids `messageBrowser` and `messagepane`, the element names `search-textbox` and `menulist`, and the popup `state`.
- `platform.ts` and `parent_keys.ts`: `#tabmail`, `#tabmail-tabs`, the `messenger.xhtml` URL and the window type `mail:3pane`.

## Rules

- Each Experiment API needs its own bundle, script and schema. Two manifest entries that shared one script left the second API unloaded.
- Import only the matcher side of `vendor/desertfox`: `keys/matcher`, `keys/token`, `prefix_tree` and `register_names`. Never import `registry/*`. Import `../shared/protocol.ts` for types only, so it stays out of the bundle.
- `keys.install` takes the keymap as data. `root` is the branch of the normal mode. A leaf runs in the chrome only when its id is in the motion table. Any other id does nothing.
- A leaf with `runs_in: "background"` leaves as a `keys.onInvocation` event. Nothing else crosses the boundary. The event carries the MailExtension ids of the messages selected at the key press (`messageIds`), read in the same key handler, so a `j` typed right after `x` cannot change what `x` archives.
- The ids come from `gDBView.getSelectedMsgHdrs()` (a collapsed thread counts as all its messages) and `messageManager.convert`, which builds a whole message header for each one. The cost grows with the selection: a select-all over a very large folder stalls the key press for that long. Motions never read the selection and stay fast.
- The first `keys.install` registers one `ExtensionSupport` window listener. Later calls replace the tree and add no listener. `shutdown` removes every key listener and the window listener, and drops the tree and the half-typed sequence.
- Keys run only in the mail tab of the main window. A key passes through when a menu or panel is open, or when its target, its original target or the end of the focus chain is a text field (the quick filter, the global search). The thread list and the folder pane run keys. A `browser` is not a text field, so a remote overlay needs its own pass-through rule when it lands. In normal mode an unbound plain printable key is swallowed. Unbound named keys (Enter, Escape, arrows, Tab, Space) and unbound chords (a key with ctrl, alt or meta) pass. A bound chord runs and is cancelled, like a bound plain key. With focus in the reading pane, every plain printable key is swallowed, chords pass, and no key runs a command, so Thunderbird's single-key shortcuts do not fire there either.
- A half-typed sequence and a pending count end on any chord the keymap does not bind as its next key, and when a key goes to a text field, an open menu, the reading pane, another tab or another window. A chord the keymap binds as a first key then runs. A change of the front tab ends them too, however it happens (`TabSelect` on the tab strip), because a click on the tab bar sends no key.

## Not yet measured

The window id from `extension.windowManager` follows the Thunderbird source and has no phase 0 measurement. The end-to-end run checks it.
