// The height to give DesertFox's `choose_columns`, so a panel splits into columns before its rows run past the panel's own height cap.
// `choose_columns` assumes `window_height - 96` px of rows. The sheet caps the panel body at `100vh - 98px` and clips the overflow, and the body also holds its padding and the footer. The hud page cannot scroll, so a clipped row is lost.

/** The sheet's cap on the body: `max-height: calc(100vh - 98px)` in `vendor/desertfox/whichkey_style.ts`. */
const BODY_CAP_RESERVE_PX = 98;
/** What the body holds besides rows. Derived from the sheet: padding 14 + 8, and a footer of margin 6, padding 6, a 1 px rule and one text line, about 30 px (about 52 px in all). Estimated: the 60 used here rounds the footer up, which is safe because it gives the same rows per column at 520 px: 16 fit, so 17 split. */
const BODY_CHROME_PX = 22 + 38;
/** The reserve `choose_columns` subtracts, `RESERVED_HEIGHT_PX` in `vendor/desertfox/whichkey_layout.ts`. */
const CHOOSER_RESERVE_PX = 96;

export function height_for_column_chooser(window_height: number): number {
    return window_height - BODY_CAP_RESERVE_PX - BODY_CHROME_PX + CHOOSER_RESERVE_PX;
}
