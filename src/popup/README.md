# Toolbar popup

The `default_popup` of the `browser_action` button on the mail tab toolbar. The button shows `icons/desertbird.svg`. A click opens this small page with two entries: Options and Help.

## Files

- `popup.html`, `popup.css`: the page. It has no inline script, and its colors follow the light or dark scheme of the system.
- `popup.ts`: sends `popup.run` with the command id of the clicked entry and closes the popup. The background (`src/background/popup_requests.ts`) runs `options.open` or `help.open` through the router in the last focused main window. It accepts those two ids and no other, from this page only.
