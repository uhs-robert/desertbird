# Body script

The script that runs in each message document: the reading pane, a message tab and a message window. It gives the message keys while a message is read. The manifest key `message_display_scripts` injects it, and `tools/build.mjs` bundles it to `content/message_display.js` with its own size guard.

| File | Role |
| --- | --- |
| `message_display.ts` | The entry: hands the document window and `browser.storage` to `start_body_script` |
| `body_keys.ts` | Key handling and the fixed scroll table. Takes its window and storage as arguments, so node tests drive it with stubs |

## Rules

- The key matcher is the vendored one, through `../shared/keymap_tree.ts`, the same reader the chrome runtime uses. Never write a second matcher.
- The tree is the `message_tree` of the keymap record the background keeps in storage under `KEYMAP_STORAGE_KEY`. The script reads it at load and follows `storage.onChanged`. Until a tree is in, it touches no key.
- The keys are the `message_keys` of the `reading` group in `../background/commands/reading.ts`: `j`, `k`, `<C-d>`, `<C-u>`, `gg` and `G`, with a count. Escape ends a half-typed sequence or a count and goes on to Thunderbird. A fixed table maps each id to a scroll. An id that is not in it does nothing.
- A plain printable key is cancelled whether or not it matched, so Thunderbird's single-key shortcuts (`a`, `r`, `#`) do not fire while a message is read. Named keys and chords the keymap leaves free pass. A key in a text field passes.
- `j` and `k` scroll a fixed line step (`LINE_STEP_PX`). A setting for it comes with the config work.
- The handoff with the chrome runtime is the attribute `BODY_SCRIPT_LIVE_ATTRIBUTE` from `../shared/protocol.ts`. The script sets it on the root element once it holds a tree and removes it when the tree goes. While the chrome runtime sees it on the message body under the focus, it stops swallowing reading-pane keys. It is an attribute and not an Experiment verb, so the verb table stays fixed.
- Import nothing from `../background/` or the vendored registry. The build test fails the bundle if it does. The only file taken from `../chrome/` is `focus.ts`, for the text field check.
