# Overlay pages

The command line page and the hud page. The `overlay` Experiment mounts it as a remote `browser` element at the bottom of the main window (`src/chrome/parent_overlay.ts`). It is an ordinary extension page: it reads keys, draws, and sends messages to the background. It parses, completes and runs nothing itself.

| File | Role |
| --- | --- |
| `cmdline.html`, `cmdline.css` | The list of rows, the status line and the input line |
| `cmdline.ts` | Key handling and drawing. The page learns its window from `?window=<id>` in its address. It asks the background for the opening text (`cmdline.hello`), for rows on each edit (`cmdline.complete`), and sends the line on Enter (`cmdline.run`) or Escape (`cmdline.close`) |
| `hud.html`, `hud.css`, `hud.ts` | The second surface: the which-key panel and the toasts. It keeps no state: it asks the background for `hud.state` at load and each time it hears `hud.changed` for its window. The box is transparent and passes mouse clicks through. It never takes the keyboard |
| `confirm.ts` | The confirm prompt mode of the command line page: the y or n prompt a bridge write waits on (`src/background/bridge/confirm.ts`). It draws the lines as text and sends one `confirm.answer` |
| `line_edit.ts` | Pure helpers: apply a picked row to the text, move the highlight, split a name at the matched letters |

## Keys

- Enter runs the line. While a folder or tag word is typed, the first row is highlighted and Enter takes it in place of the word, unless the word is already a whole value. A line that is not a command stays open with the reason in the status line.
- Escape closes the line from any element. The background asks the Experiment to unmount, which returns the focus to the thread list.
- Tab, <C-n> and <A-Down> put the next row in the line, and S-Tab, <C-p> and <A-Up> the previous one. Both wrap, and a single match goes in at once. After the first row key, Up and Down put the next or previous row in and stop at the ends. Every key puts the row in the text, so Enter runs what the line shows. The page keeps C-n and C-p from Thunderbird's new message and print. History loads before the first completion request, so a failed request does not skip it.
- Up and Down walk the history while the line is fresh (nothing typed and no row key used) or has no rows, as in DesertFox. The history is the list `desertbird_cmdline_history` in `storage.local`. The background writes it when a line runs (`src/background/cmdline/history.ts`). The page keeps a copy that refills on `storage.onChanged`. The cursor is `vendor/desertfox/history_cursor.ts`.

- A confirm prompt (`hello.confirm` set) hides the rows, the status and the input line, and runs no command line, completion or history. Only the background's answer to `cmdline.hello` picks the mode, at load. `y` answers yes, `n` and Escape answer no, and every other key does nothing. Keys in the first 300 ms after the prompt shows and repeats of a held key are ignored. The answer goes once. A `stale` reply (the prompt timed out or the background restarted) closes the page.

- A search line (`hello.search` set) shows `/` or `?` as the prompt, draws no rows and has a transparent page, so the list narrows in view. Up, Down, C-n and C-p walk the search history. Tab does nothing. The browser of the command line is transparent for this.

## Rules

- The hud browser is told no size limit (`max_width` and `max_height` of 0). A browser that is told one resizes to its content, and a page of absolutely placed pieces has none, so the browser shrank to 0 by 0 (measured). The box is 520 px high and as wide as the window. The browser carries `transparent="true"`: without it Thunderbird paints the page canvas white.
- Colors come from the theme tokens (`--desertfox-*`, from `src/shared/follow_theme.ts`, which reads the theme the background publishes). Both pages keep short local names (`--surface`, `--text`) that alias the tokens, and the muted text mixes the text color into the surface so it stays readable on every theme. A page in the window follows Thunderbird's scheme through `prefers-color-scheme`, not the OS scheme (measured). The panel and the toasts sit at the bottom right, as in DesertFox: right 16 px, the panel 44 px and the toasts 48 px above the window bottom, the toasts at most 40ch wide. The panel draws over a toast.
- A panel of more than 24 keys is cut and ends in a count of the rest.

- A confirm prompt borrows the command line surface, because only that surface takes the keyboard and gives the focus back. A prompt replaces an open command line in its window and ends its session. A command line that opens or closes in that window ends the prompt as a no. When the prompt ends, the surface goes, so the window is left with no command line.
- Sender text in a prompt is set with `textContent` only, never as markup. A program with the user's rights that can type keys into the window (a tool such as `wtype`) can still press `y`. No design inside the add-on stops that.

- The message shapes are in `src/shared/protocol.ts` (`CmdlineRequest` and its answers). Import it for types only.
- A key typed in the first moments after `:` can reach the list before the overlay has the focus, because the mount is a round trip. The overlay's `browser` has an id the key runtime treats as a text field (`src/chrome/overlay_id.ts`), so every key after the focus moves belongs to the page.
- The box is 280 px high and the page fills it, so the height does not follow the rows. The colors are the hud's, from the theme. The mount tells the browser no size limit (`max_width` and `max_height` of 0, as for the hud), so the page spans the window width. A limit made the browser shrink to its content, 800 px wide.
