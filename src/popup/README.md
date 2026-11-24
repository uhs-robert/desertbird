# Toolbar popup

The `default_popup` of the `browser_action` button on the mail tab and default space toolbars. The button shows `icons/desertbird.svg`. A click opens this small page with two entries: Options and Help.

## Files

- `popup.html`, `popup.css`: the page. It has no inline script, and its colors follow the light or dark scheme of the system.
- `popup.ts`: sends `popup.run` with the command id of the clicked entry and closes the popup. The background (`src/background/popup_requests.ts`) runs `options.open` or `help.open` through the router in the last focused main window. It accepts those two ids and no other, from this page only. It focuses the first entry on open and runs the keys of `keys.ts`.
- `keys.ts`: the key table, with no DOM so a unit test reads it. `o` presses Options and `h` presses Help, each shown as a key cap beside its label. `j` and Down move the focus to the next entry, `k` and Up to the previous one, and both stop at the ends. Enter and Space press the focused entry, as a button does natively.

## Keys

Thunderbird moves the focus into the popup's browser by itself once the panel shows (see [`../../docs/thunderbird-behavior.md`](../../docs/thunderbird-behavior.md), "Toolbar popup focus"). The chrome key runtime counts that browser as a typing target, so it neither runs nor swallows the key, and the page gets it. A key pressed in the first ~400 ms after the click, before the focus arrives, is swallowed under the open panel and does nothing.
