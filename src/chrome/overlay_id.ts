// The id of the overlay's `browser` element. The key runtime reads it to leave the overlay's keys alone, and the overlay parent sets it. The two live in separate bundles, so the shared name sits here.
export const OVERLAY_BROWSER_ID = "desertbird-overlay-browser";
export const OVERLAY_BOX_ID = "desertbird-overlay";
// The hud has ids of its own, so two overlay boxes in one window never share an id. It never takes the keyboard, so the key runtime has no rule for it.
export const HUD_BOX_ID = "desertbird-hud";
export const HUD_BROWSER_ID = "desertbird-hud-browser";
// The mode label sits in the status bar and is no overlay box. The id is how every call finds, reuses and removes it, so a reload never leaves a second one.
export const MODE_LABEL_ID = "desertbird-mode-label";
