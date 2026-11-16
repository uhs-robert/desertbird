# Background

The persistent background page. It owns the command registry, compiles the default keymap, hands it to the Experiment and runs every command that lives on standard APIs.

## Files

- `registry.ts`: the one table of commands. `motion.*` run in the chrome runtime and carry no handler. `msg.*` run here.
- `default_keymap.ts`: the default bindings and their compile through the vendored compiler.
- `main.ts`: stores the compiled keymap under `desertbird_compiled_keymap` with a hash of the default bindings, calls `keys.install` on every start and again when storage changes, and routes `keys.onInvocation` to the router.
- `router.ts`: look up, `check_args`, check `needs`, call the handler on the message ids the invocation carries. Any failure ends in a notification.
- `notify.ts`: shows a refusal. A key never fails silently.
- `handlers/message.ts`, `handlers/identity.ts`: archive, delete and reply. They take the API subset in a scope object and never read a global.

## Rules

- `needs` lists the Experiment verbs a command depends on (`keys.install`). The router refuses the command when one of them is not loaded. No phase 1 command lists one.
- Handlers act on the ids taken at the key press and never read the selection themselves. The selection can move between the key and the handler. `x` and `d d` act on every id. `r` replies to the newest of them by date.
- A handler throws `RuntimeRefusal` for a state it cannot act on. It never checks an argument value, since the param schema does that.
- `msg.reply` checks `identities.list` before `compose.beginReply`. `beginReply` crashes the whole app when the account has no identity.

## Traps for later phases

- `mailTabs.update({displayedFolder})` throws "An unexpected error occurred" on the first display of each folder, although the folder displays. The console shows `this._sort[0] is undefined` from `DBViewWrapper`. `folder.open` (phase 2) must treat that error as "the view is still loading" and must not report it as a failure.
- `tabs.remove` does nothing on the primary tab.
