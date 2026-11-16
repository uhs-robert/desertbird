# Chrome runtime

The privileged part of the add-on. It runs as the parent script of an Experiment, inside the Thunderbird process, and listens for keys in the main mail window. The schemas are [`../experiment/keys.schema.json`](../experiment/keys.schema.json) and [`../experiment/view.schema.json`](../experiment/view.schema.json). The call shapes are in [`../shared/protocol.ts`](../shared/protocol.ts).

| File | Role |
| --- | --- |
| `parent_keys.ts` | The entry of the `keys` API: `get_keys_api` and `shutdown`. Holds the one runtime and the event subscribers |
| `parent_view.ts` | The entry of the `view` API: `get_view_api`. Holds no state |
| `platform.ts` | The Thunderbird globals both parents read, and the guard that rethrows `ExtensionError(message)` from each verb |
| `focus.ts` | Whether a key is meant for a text field, and whether focus is in the reading pane: follows the focused element through shadow roots and into browser documents |
| `runtime.ts` | Key handling. Takes its Thunderbird access as `RuntimeDeps`, so tests use fakes |
| `motions.ts` | The fixed motion table: `motion.down`, `motion.up`, `motion.top`, `motion.bottom`. Pure functions over a `ViewPort` |
| `view.ts` | The only file that reads `about:3pane` (`gDBView`, `threadTree`) |

## Rules

- Each API has its own bundle, script and schema. Two manifest entries that shared one script left `view` unloaded. Each bundle holds its own copy of `view.ts` and `platform.ts`, which keep no state.
- Import only the matcher side of `vendor/desertfox`: `keys/matcher`, `keys/token`, `prefix_tree` and `register_names`. Never import `registry/*`. Import `../shared/protocol.ts` for types only, so it stays out of the bundle.
- `keys.install` takes the keymap as data. `root` is the branch of the normal mode. A leaf runs in the chrome only when its id is in the motion table. Any other id does nothing.
- A leaf with `runs_in: "background"` leaves as a `keys.onInvocation` event. Nothing else crosses the boundary.
- The first `keys.install` registers one `ExtensionSupport` window listener. Later calls replace the tree and add no listener. `shutdown` removes every key listener and the window listener, and drops the tree and the half-typed sequence.
- Keys run only in the mail tab of the main window. A key passes through when it carries ctrl, alt or meta, or when its target, its original target or the end of the focus chain is a text field (the quick filter, the global search). The thread list and the folder pane run keys. A `browser` is not a text field, so a remote overlay needs its own pass-through rule when it lands. In normal mode an unbound plain printable key is swallowed. Named keys (Enter, Escape, arrows, Tab, Space) pass. With focus in the reading pane, every plain printable key is swallowed and none runs a motion, so Thunderbird's single-key shortcuts do not fire there either.

## Not yet measured

`view.select` with a range (`selectedIndices`), `scrollToIndex` and the window id from `extension.windowManager` follow the Thunderbird source and have no phase 0 measurement. The end-to-end run checks them.
