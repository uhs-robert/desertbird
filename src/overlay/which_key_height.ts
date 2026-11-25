// The height to give DesertFox's `choose_columns`, so a panel splits into columns before its rows run past the panel's own height cap.
// `choose_columns` assumes `window_height - 96` px of rows. The sheet caps the panel body at `100vh - 98px` and clips the overflow, and the body also holds its padding and the footer. The hud page cannot scroll, so a clipped row is lost.

/** The sheet's cap on the body: `max-height: calc(100vh - 98px)` in `vendor/desertfox/whichkey_style.ts`. */
const BODY_CAP_RESERVE_PX = 98;
/** Body padding (14 top, 8 bottom) and the footer (margin, padding, border and one line), measured in Betterbird. */
const BODY_CHROME_PX = 22 + 38;
/** The reserve `choose_columns` subtracts, `RESERVED_HEIGHT_PX` in `vendor/desertfox/whichkey_layout.ts`. */
const CHOOSER_RESERVE_PX = 96;

export function height_for_column_chooser(window_height: number): number {
    return window_height - BODY_CAP_RESERVE_PX - BODY_CHROME_PX + CHOOSER_RESERVE_PX;
}
