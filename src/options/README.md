# Options page

The `options_ui` page of the add-on. It opens in a tab, lists the settings, the key bindings and the nine quick reply texts and writes them to `storage.local`. The settings and bindings go through the config store, the quick replies through `quick_reply_store.ts`. The background page applies the change through `storage.onChanged`.

## Files

- `options.html`, `options.css`: the page. Its colors are the theme tokens (`--desertfox-*`) that `follow_theme` (`src/shared/follow_theme.ts`) sets from the stored theme, so it follows the `theme` setting and Thunderbird's color scheme. The `theme` setting shows as a choice list built from `SETTING_KINDS`. The script is external because extension pages allow no inline script.
- `options.ts`: builds the form, the Menu keys table (apart from the key bindings, saved in the `menu` section of the user keymap) and the bindings table with DOM calls and saves. It reads the DOM and nothing else.
- `model.ts`: the logic without the DOM: form text to setting values, binding rows to a user keymap, and the compiler check. A binding the compiler skips blocks the save, so a typo never reaches storage. The tests drive this file.

## Native host settings

A save that sets `external_editor` or `bridge` to true first calls `permissions.request` for `nativeMessaging`, before any other await, because the request needs the user gesture of the Save click. A denial stops the save and says so in the status line. Nothing else is written then.

## Quick replies

The Quick replies section has one textarea per slot and its own Save button, so a bad key binding never blocks it. The texts are free text and keep their line breaks. The command `msg.reply_with` (keys `g r 1` to `g r 9`) reads them. A newer-version lock on the config store does not disable this section, because it has its own record.

## Editing

Defaults appear as rows with an Unbind box. A binding the user adds with the keys of a default replaces it. Args are a JSON object, or empty.

The build bundles `options.ts` to `options/options.js` in the add-on. It stays out of the Experiment bundle.
