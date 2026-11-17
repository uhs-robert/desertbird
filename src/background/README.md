# Background

The persistent background page. It owns the command registry, compiles the default keymap, hands it to the Experiment and runs every command that lives on standard APIs.

## Files

- `commands/`: the command table, one file per group. `define.ts` holds the `CommandGroup` shape, which requires `bridge: boolean` on every command, and the `scoped` wrapper. `motion.ts` holds `motion.*`, which run in the chrome runtime and carry no handler. `messages.ts` holds `msg.*`, `tabs.ts` holds `tab.*` and `view.ts` holds `filter.set`, `search.threads`, `sort.set` and `pane.toggle`, which run here. A group lists its commands and the default normal-mode keys that run them. `index.ts` joins the groups into `registry`, `DEFAULT_KEYMAP` and `compile_default_keymap` (the default bindings through the vendored compiler). A new group is one file and one line in `GROUPS`.
- `main.ts`: stores the compiled keymap under `desertbird_compiled_keymap` with a hash of the default bindings, calls `keys.install` on every start and again when storage changes, and routes `keys.onInvocation` to the router.
- `router.ts`: look up, `check_args`, check `needs`, call the handler on the message ids the invocation carries. Any failure ends in a notification.
- `notify.ts`: shows a refusal. A key never fails silently.
- `handlers/view.ts`: the view commands. They take a `ViewApi` subset, find the mail tab of the invocation's window and act on it. `search.threads` and `sort.set` and the tag form of `filter.set` have no default key until the command line exists.
- `handlers/tabs.ts`: next, previous, switch by number or title, and close. They take `tabs` and the window id of the key press. `tab.next` and `tab.prev` take a count and make one switch to the tab that many steps away, wrapping. `tab.close` refuses on the first tab, which is the main mail tab: the tabs API marks it by nothing but its index, and Thunderbird never moves it off index 0. The `tabs` permission is there for the tab titles. A key reaches these commands from the mail tab only, so after a switch to another tab no key brings the user back.
- `handlers/message.ts`, `handlers/identity.ts`: archive, delete and reply. They take the API subset in a scope object and never read a global.
- `handlers/each_message.ts`, `handlers/displayed_folder.ts`, `handlers/special_folder.ts`: shared helpers. Loop over the selected ids with the empty-selection refusal, read the displayed folder, and find a folder by special use.

## Rules

- Every command states `bridge`. True only for a command that moves the view, the selection or the front tab harmlessly (`motion.*`, `tab.next`, `tab.prev`, `tab.switch`). False for anything that changes mail, sends, discloses data or is hard to undo (`msg.*`, `tab.close`). The view commands change only what the list shows, so they are true.
- `needs` lists the Experiment verbs a command depends on (`keys.install`). The router refuses the command when one of them is not loaded. No phase 1 command lists one.
- Handlers act on the ids taken at the key press and never read the selection themselves. The selection can move between the key and the handler. `x` and `d d` act on every id. `r` replies to the newest of them by date.
- A handler throws `RuntimeRefusal` for a state it cannot act on. It never checks an argument value, since the param schema does that.
- `msg.reply` checks `identities.list` before `compose.beginReply`. `beginReply` crashes the whole app when the account has no identity.

## Traps for later phases

- `mailTabs.update({displayedFolder})` throws "An unexpected error occurred" on the first display of each folder, although the folder displays. The console shows `this._sort[0] is undefined` from `DBViewWrapper`. `folder.open` (phase 2) must treat that error as "the view is still loading" and must not report it as a failure.
- `tabs.remove` does nothing on the primary tab.
