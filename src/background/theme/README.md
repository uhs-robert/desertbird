# Theme

The `theme` setting picks one of the 16 Oasis themes (default `oasis_moonlight`). The theme tables are the vendored `themes.ts` (about 47 KB), so only the background imports them. Everything else gets resolved colors.

- `palette.ts`: `resolve_theme(name)` gives the dark and light role colors (light intensity 3, the vendored default; no setting for it). An unknown name gives the default theme. `mode_label_colors(theme)` gives the mode label colors for both schemes: the `mode_normal`, `mode_visual` and `mode_insert` roles, and the badge text, which is whichever of `bg_core` and `fg_core` reads better on them. `test/theme.test.ts` checks every theme: each mode color reads at 4.5 to 1 on the status bar of the default Thunderbird dark and light themes, and the badge text reads at 4.5 to 1 on each mode color.
- `hint_label_colors(theme)` gives the hint label box (the `primary` role) and letters (`bg_core`) for both schemes. `themed_hints.ts` fills them into each `hints.pick` call from the current `theme` setting. `hint_label_style` turns them into the literal declarations that `publish.ts` stores under `desertbird_hint_style` for the body script.
- `publish.ts`: writes the resolved theme to `desertbird_theme` in `storage.local`, only when it differs from what is stored. `main.ts` calls it at start and on a settings change.

## Who reads it

- The hud, the command line and the options page call `follow_theme` (`src/shared/follow_theme.ts`), which turns the stored theme into `--desertfox-*` tokens (`src/shared/theme_css.ts`) and follows `storage.onChanged`. The dark set is the base block and the light set sits under `prefers-color-scheme: light`.
- The hint labels of the mail window get `hint_label_colors` through `hints.pick` and the Experiment picks the scheme, as for the mode label. The hint labels of a message read `desertbird_hint_style`, which `publish.ts` writes with the theme.
- The mode label gets `mode_label_colors` through `overlay.setModeLabel` and the Experiment picks the scheme.

## Which scheme

Measured in Thunderbird 153 (headless, with Thunderbird's own theme set against the OS scheme): `prefers-color-scheme` in the main window, in the extension pages mounted in it (hud, command line) and in the options tab follows Thunderbird's theme. The background page follows the OS. So the pages and the label pick the scheme themselves and the background never does.

The status bar is the main window's `#status-bar`: `rgb(39, 39, 42)` under the default dark theme and `rgb(250, 250, 250)` under the default light theme. A custom Thunderbird theme can change it, and the badge style stays readable on any bar.
