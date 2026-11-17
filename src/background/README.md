# Background

The persistent background page. It owns the command registry, compiles the default keymap, hands it to the Experiment and runs every command that lives on standard APIs.

## Files

- `commands/`: the command table, one file per group. `define.ts` holds the `CommandGroup` shape, which requires `bridge: boolean` on every command, and the `scoped` wrapper. `motion.ts` holds `motion.*`, which run in the chrome runtime and carry no handler. `view.ts` holds `filter.set`, `search.threads`, `sort.set` and `pane.toggle`. `messages.ts` holds the message state commands (`msg.archive`, `msg.delete`, `msg.read`, `folder.read_all`, `msg.flag`, `msg.junk`, `msg.tag`, `msg.move`) and `compose.ts` holds `msg.reply`, `msg.forward` and `msg.new`. All run here. A group lists its commands and the default normal-mode keys that run them. `index.ts` joins the groups into `registry`, `DEFAULT_KEYMAP` and `compile_default_keymap` (the default bindings through the vendored compiler). A new group is one file and one line in `GROUPS`.
- `main.ts`: stores the compiled keymap under `desertbird_compiled_keymap` with a hash of the default bindings, calls `keys.install` on every start and again when storage changes, and routes `keys.onInvocation` to the router.
- `router.ts`: look up, `check_args`, check `needs`, call the handler on the message ids the invocation carries. Any failure ends in a notification.
- `notify.ts`: shows a refusal. A key never fails silently.
- `handlers/view.ts`: the view commands. They take a `ViewApi` subset, find the mail tab of the invocation's window and act on it. `search.threads` and `sort.set` and the tag form of `filter.set` have no default key until the command line exists.
- `handlers/message.ts`, `handlers/message_state.ts`, `handlers/compose.ts`, `handlers/identity.ts`: archive and delete, the state and move handlers, the compose handlers and the identity guard. They take the API subset in a scope object and never read a global.
- `handlers/each_message.ts`, `handlers/displayed_folder.ts`, `handlers/special_folder.ts`: shared helpers. Loop over the selected ids with the empty-selection refusal, read the displayed folder, and find a folder by special use.

## Rules

- Every command states `bridge`. True only for a command that moves the view or selection harmlessly (`motion.*`). False for anything that changes mail, sends, discloses data or is hard to undo (`msg.*`). The view commands change only what the list shows, so they are true.
- `needs` lists the Experiment verbs a command depends on (`keys.install`). The router refuses the command when one of them is not loaded. No phase 1 command lists one.
- Handlers act on the ids taken at the key press and never read the selection themselves. The selection can move between the key and the handler. `x`, `d d` and the state keys act on every id, one call per id. A toggle (`msg.read` toggle, `msg.flag`, `msg.junk`) reads the first message and gives every selected message the opposite state. A failure part way stops the loop and the refusal says how many messages changed. `r`, `R` and `g F` use the newest message by date.
- A handler throws `RuntimeRefusal` for a state it cannot act on. It never checks an argument value, since the param schema does that.
- `msg.reply`, `msg.forward` and `msg.new` resolve an identity before any compose call (`resolve_identity`): one the message was addressed to in any account, else the message account's first identity, else the default account's, else any. They refuse only when no identity exists. `beginReply` crashes the whole app with no identity anywhere, `beginForward` hangs unless the call names an identity, and `beginNew` opens a window that cannot send. Reply and forward pass the resolved identity.
- `msg.tag` and `msg.move` have no default key until the command line exists. `msg.move` takes a folder path such as `/Archive` and looks it up in the one account the selected messages share, and refuses a selection that spans accounts. `folder.read_all` refuses in a saved search, because the API would mark every message in its source folders read.

## Traps for later phases

- `mailTabs.update({displayedFolder})` throws "An unexpected error occurred" on the first display of each folder, although the folder displays. The console shows `this._sort[0] is undefined` from `DBViewWrapper`. `folder.open` (phase 2) must treat that error as "the view is still loading" and must not report it as a failure.
- `tabs.remove` does nothing on the primary tab.
