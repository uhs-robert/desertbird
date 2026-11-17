# Overlay pages

The command line page and the hud page. The `overlay` Experiment mounts it as a remote `browser` element at the bottom of the main window (`src/chrome/parent_overlay.ts`). It is an ordinary extension page: it reads keys, draws, and sends messages to the background. It parses, completes and runs nothing itself.

| File | Role |
| --- | --- |
| `cmdline.html`, `cmdline.css` | The list of rows, the status line and the input line |
| `cmdline.ts` | Key handling and drawing. The page learns its window from `?window=<id>` in its address. It asks the background for the opening text (`cmdline.hello`), for rows on each edit (`cmdline.complete`), and sends the line on Enter (`cmdline.run`) or Escape (`cmdline.close`) |
| `hud.html`, `hud.css`, `hud.ts` | The second surface: the which-key panel and the toasts. It keeps no state: it asks the background for `hud.state` at load and each time it hears `hud.changed` for its window. The box is transparent and passes mouse clicks through. It never takes the keyboard |
| `line_edit.ts` | Pure helpers: apply a picked row to the text, move the highlight, split a name at the matched letters |

## Keys

- Enter runs the line. A line that is not a command stays open with the reason in the status line.
- Escape closes the line from any element. The background asks the Experiment to unmount, which returns the focus to the thread list.
- Tab puts the highlighted row (or the first) into the line. <C-n> and <C-p> move the highlight.
- Up and Down walk the history while the line is fresh (nothing typed and no completion key used), then move the highlight, as in DesertFox. The history is the list `desertbird_cmdline_history` in `storage.local` (newest last, 100 entries, a repeat moves to the newest place). The page writes it before it sends the line.

## Rules

- The hud browser is told no size limit (`max_width` and `max_height` of 0). A browser that is told one resizes to its content, and a page of absolutely placed pieces has none, so the browser shrank to 0 by 0 (measured). The box is 520 px high and as wide as the window. The browser carries `transparent="true"`: without it Thunderbird paints the page canvas white.
- Colors come from CSS variables with a `prefers-color-scheme` block. The text and the border stay at a contrast of at least 7 to 1 against the panel in both themes. The panel sits at the right edge and the toasts at the left, both 32 px above the window bottom, clear of the status bar.
- A panel of more than 24 keys is cut and ends in a count of the rest.

- The message shapes are in `src/shared/protocol.ts` (`CmdlineRequest` and its answers). Import it for types only.
- A key typed in the first moments after `:` can reach the list before the overlay has the focus, because the mount is a round trip. The overlay's `browser` has an id the key runtime treats as a text field (`src/chrome/overlay_id.ts`), so every key after the focus moves belongs to the page.
- The box is 280 px high and the page fills it, so the height does not follow the rows. The colors are the hud's. The page is at most 800 px wide while the mount passes `max_width: 800` (`src/chrome/parent_overlay.ts`).
