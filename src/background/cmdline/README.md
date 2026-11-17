# Command line, background side

| File | Role |
| --- | --- |
| `completion.ts` | The rows of the list at the caret: commands, flags of the typed command, and values (static lists, folder paths, tag names). Built on the vendored `completion/tokenize.ts` (where the caret is) and `score.ts` (ranking). Only commands that run in the background and are not `completion: "hidden"` are listed |
| `history.ts` | The history list in `storage.local`: `record` adds a line in a chain of writes, so two lines recorded together both stay. The service records every line the page sends to `cmdline.run` and does not wait for the write |
| `service.ts` | One session per window: the opening text and the messages selected when the line opened. Answers the page's messages, and on `cmdline.run` parses, checks the args, closes the overlay and runs the command through the router with the stored message ids |

## Rules

- The parser, the printer and the tokenizer are copies of DesertFox code under `vendor/desertfox/` (see `VENDOR.md`). The completer is written here because DesertFox's reads tabs, bookmarks and history.
- Command words come from the registry: a command's `name`, else its id. Enum params are typed as flags (`sort --date --descending`, `filter --tag --tag=$label1`).
- `check_args` runs on the line before it runs, so the page can show the reason. The router checks again. A refusal while the command runs ends in a notification, after the line has closed.
- The session lives in memory only. It is a few seconds of interface state tied to one open overlay: the overlay is gone when the background restarts, and the Experiment's `onClosed` event drops the session when the overlay leaves on its own.
- `@source` values in a line are refused: DesertBird has no context sources.
- The default keys `:`, `m t`, `m m`, `F t` and `T` all run `cmdline.open`. The last four start the line with a command typed in.
- `/` and `?` run `search.open`, which opens the line as a search line (`session.search` holds the direction). The page sends `cmdline.search_type` per keystroke and `cmdline.search_commit` on Enter, and the service hands both to the search service (`../search/`). Enter commits before the overlay closes, so a search that finds nothing leaves the line open with the reason. Escape and a lost overlay cancel the search, which puts the filter back. Search lines keep their own history list, `desertbird_search_history`. There is no `folder.open` command yet, so no `o` key.
