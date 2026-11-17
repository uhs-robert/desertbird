# Options page

The `options_ui` page of the add-on. It opens in a tab, lists the settings and the key bindings and writes both to `storage.local` through the config store. The background page applies the change through `storage.onChanged`.

## Files

- `options.html`, `options.css`: the page. The script is external because extension pages allow no inline script.
- `options.ts`: builds the form and the bindings table with DOM calls and saves. It reads the DOM and nothing else.
- `model.ts`: the logic without the DOM: form text to setting values, binding rows to a user keymap, and the compiler check. A binding the compiler skips blocks the save, so a typo never reaches storage. The tests drive this file.

## Editing

Defaults appear as rows with an Unbind box. A binding the user adds with the keys of a default replaces it. Args are a JSON object, or empty.

The build bundles `options.ts` to `options/options.js` in the add-on. It stays out of the Experiment bundle.
