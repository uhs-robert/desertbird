# Overlay page

The command line page. The `overlay` Experiment mounts it as a remote `browser` element at the bottom of the main window (`src/chrome/parent_overlay.ts`). It is an ordinary extension page: it reads keys, draws, and sends messages to the background. It parses, completes and runs nothing itself.

| File | Role |
| --- | --- |
| `cmdline.html`, `cmdline.css` | The list of rows, the status line and the input line |
| `cmdline.ts` | Key handling and drawing. The page learns its window from `?window=<id>` in its address. It asks the background for the opening text (`cmdline.hello`), for rows on each edit (`cmdline.complete`), and sends the line on Enter (`cmdline.run`) or Escape (`cmdline.close`) |
| `line_edit.ts` | Pure helpers: apply a picked row to the text, move the highlight, split a name at the matched letters |

## Keys

- Enter runs the line. A line that is not a command stays open with the reason in the status line.
- Escape closes the line from any element. The background asks the Experiment to unmount, which returns the focus to the thread list.
- Tab puts the highlighted row (or the first) into the line. Down and Up move the highlight.

## Rules

- The message shapes are in `src/shared/protocol.ts` (`CmdlineRequest` and its answers). Import it for types only.
- A key typed in the first moments after `:` can reach the list before the overlay has the focus, because the mount is a round trip. The overlay's `browser` has an id the key runtime treats as a text field (`src/chrome/overlay_id.ts`), so every key after the focus moves belongs to the page.
- The box is 280 px high and the page is at most 800 px wide, the limit of an extension view.
