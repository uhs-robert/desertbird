# Help page

An extension page that lists every command with the keys bound to it and its usage on the command line. `help.open` (key `?`, or `:help`) opens it in a tab and shows the tab again when it is already open.

| File | Role |
| --- | --- |
| `help.html`, `help.css` | The page. The colors follow the Thunderbird light or dark theme |
| `help.ts` | Reads the live keymap through the config store, draws one table per command group and redraws when a binding is saved |
| `model.ts` | The rows without the DOM: commands grouped by the part of the id before the dot, each with its keys, args, intent and usage line |

## Rules

- The page is generated at run time from the command registry and the effective keymap (defaults plus the user's bindings). A build-time file would show only the default keys, would need a generator and a drift test, and the options page already bundles the registry the same way. A new command or a changed binding shows with no help text to write.
- A command that runs in the mail window has no command line form, so the usage column says `keys only` for it.
