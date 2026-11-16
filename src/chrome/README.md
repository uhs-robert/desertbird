# Chrome runtime

The privileged part of the add-on. It runs as the parent script of an Experiment, inside the Thunderbird process, and listens for keys in the main mail window. The schema is [`../experiment/schema.json`](../experiment/schema.json). The call shapes are in [`../shared/protocol.ts`](../shared/protocol.ts).

| File | Role |
| --- | --- |
| `parent.ts` | The Experiment entry. Exports `get_keys_api`, `get_view_api` and `shutdown` for the build's footer. Wraps each verb to rethrow `ExtensionError(message)`. Loads platform modules inside functions, so node tests load it with stub globals |
| `runtime.ts` | Key handling. Takes its Thunderbird access as `RuntimeDeps`, so tests use fakes |
| `motions.ts` | The fixed motion table: `motion.down`, `motion.up`, `motion.top`, `motion.bottom`. Pure functions over a `ViewPort` |
| `view.ts` | The only file that reads `about:3pane` (`gDBView`, `threadTree`) |

## Rules

- Import only the matcher side of `vendor/desertfox`: `keys/matcher`, `keys/token`, `prefix_tree` and `register_names`. Never import `registry/*`. Import `../shared/protocol.ts` for types only, so it stays out of the bundle.
- `keys.install` takes the keymap as data. `root` is the branch of the normal mode. A leaf runs in the chrome only when its id is in the motion table. Any other id does nothing.
- A leaf with `runs_in: "background"` leaves as a `keys.onInvocation` event. Nothing else crosses the boundary.
- The first `keys.install` registers one `ExtensionSupport` window listener. Later calls replace the tree and add no listener. `shutdown` removes every key listener and the window listener, and drops the tree and the half-typed sequence.
- Keys run only in the mail tab of the main window. A key passes through when its target is an input or a `browser` (the overlay, the message body), or when it carries ctrl, alt or meta. In normal mode an unbound plain printable key is swallowed. Named keys (Enter, Escape, arrows, Tab, Space) pass.

## Not yet measured

`view.select` with a range (`selectedIndices`), `scrollToIndex` and the window id from `extension.windowManager` follow the Thunderbird source and have no phase 0 measurement. The end-to-end run checks them.
