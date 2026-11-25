# Shared

Code that the background page, the chrome runtime, the body script and the overlay all use. `protocol.ts` holds the message and Experiment call shapes.

## Files

- `swallow.ts`: one helper per reason a rejected promise is dropped (`ignore_refusal`, `best_effort`, `keep_chain`, `refused_as`, `warn_and_go`). The lint rule `no-restricted-syntax` in `eslint.config.mjs` bans a silent `.catch` or `.then` handler written inline, so use a helper and the name says why. The helpers are plain functions, because the body script bundle has a size guard. A handler passed as an identifier is not checked.
- `follow_theme.ts`: keeps the theme tokens of an extension page current from `storage.local`. The page stays transparent until the first read returns or one second passes.
- `hint_labels.ts`: the hint alphabet and the generator of equal-length labels, so no label starts another.
- `hint_hold.ts`: the rule of the hold after a hint typo: what counts as a plain key, and the key sequences of a compiled tree that start a pick. The pick, the page keys of `pages.js` and the background share it.
- `hint_view.ts`: the document shapes the hint modes need, and the check that a target is on screen. The body script and the `hints` Experiment share it.
- `keymap_tree.ts`: turns the compiled keymap tree into a matcher for the chrome runtime and the body script, and makes Backspace undo the last typed key.
- `theme_choice.ts`: the theme names the `theme` setting accepts (the Oasis themes) and the default.
- `theme_css.ts`: the stored theme shape, its `storage.local` key and the CSS that puts the tokens on a page.
