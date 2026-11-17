# Body script

The script that runs in each message document: the reading pane, a message tab and a message window. It gives the message keys while a message is read. The manifest key `message_display_scripts` injects it, and `tools/build.mjs` bundles it to `content/message_display.js` with its own size guard.

| File | Role |
| --- | --- |
| `message_display.ts` | The entry: hands the document window and `browser.storage` to `start_body_script` |
| `body_keys.ts` | Key handling and the fixed table of actions. Takes its window, storage and runtime as arguments, so node tests drive it with stubs |
| `body_find.ts` | Find in the message with `window.find`, and `n` and `N` with a wrap done by the script |
| `body_hints.ts` | Hint labels: collects the clickable elements on screen, draws the labels, focuses the one typed |

## Rules

- The key matcher is the vendored one, through `../shared/keymap_tree.ts`, the same reader the chrome runtime uses. Never write a second matcher.
- The tree is the `message_tree` of the keymap record the background keeps in storage under `KEYMAP_STORAGE_KEY`. The script reads it at load and follows `storage.onChanged`. Until a tree is in, it touches no key.
- The keys are the `message_keys` of the `reading` group in `../background/commands/reading.ts`: `j`, `k`, `<C-d>`, `<C-u>`, `gg` and `G`, with a count. Escape ends a half-typed sequence or a count and goes on to Thunderbird. A fixed table maps each id to a scroll. An id that is not in it does nothing.
- A plain printable key is cancelled whether or not it matched, so Thunderbird's single-key shortcuts (`a`, `r`, `#`) do not fire while a message is read. Named keys and chords the keymap leaves free pass. A key in a text field passes.
- `j` and `k` scroll `message_scroll_step_px` (default 40, `MESSAGE_SCROLL_STEP_PX` in `../shared/protocol.ts`). The script reads it from the settings record under `SETTINGS_STORAGE_KEY` and follows `storage.onChanged`. A value that is not a positive number gives the default.
- A leaf that runs in the background (`/`, which opens the command line with `find ` typed) goes to the background as a `body.invoke` request. The request names a command and its args. The window and the messages come from the sender. The background runs it only for a command that a message key binds, through the router and its one validator. It refuses in a message window, which has no command line.
- `search.message` (typed as `find <text>`) runs in the background and sends `body.find` to the front tab. The script clears the selection, finds from the top with smart case (a capital letter makes it case sensitive), selects the match and focuses the message. `n` and `N` step to the next and previous match and wrap at the ends. They do nothing before a first find.
- `f` (`hint.pick`) labels the links, buttons and form controls that are on screen and puts the labels in the document. While they show, every key is for them: a letter narrows the labels, a label that is unique focuses its element and the next Enter goes to Thunderbird, which treats it as a click on the link (its external open and its check for a link that lies about its address run). The script never calls `click()`, since an untrusted click skips that handling. Labels are shown only for elements a mouse would hit (drawn, visible, on top at their centre, not disabled), sit in a closed shadow root of a container with inline `!important` style, and end on any other key, `Escape`, scroll, blur, a pointer press and when the keymap record goes away. The alphabet and the generator are `../shared/hint_labels.ts`, with no DOM in them, so hints in the mail window can use them. Only the top document is labelled.
- The handoff with the chrome runtime is the attribute `BODY_SCRIPT_LIVE_ATTRIBUTE` from `../shared/protocol.ts`. The script sets it on the root element once it holds a tree and removes it when the tree goes. While the chrome runtime sees it on the message body under the focus, it stops swallowing reading-pane keys. It is an attribute and not an Experiment verb, so the verb table stays fixed.
- Import nothing from `../background/` or the vendored registry. The build test fails the bundle if it does. The only file taken from `../chrome/` is `focus.ts`, for the text field check.
