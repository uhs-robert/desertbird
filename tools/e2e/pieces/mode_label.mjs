// The mode label under three styles, one piece each: the badge, the label off, and the badge in another theme.
import { THEMED_LABEL, reference_strips, run_mode_label_kind } from "./_mode_label.mjs";

const STYLES = {
  mode_label_badge: { desertbird_settings: { mode_indicator_style: "badge" } },
  mode_label_off: { desertbird_settings: { mode_indicator: "off" } },
  mode_label_themed: { desertbird_settings: { mode_indicator_style: "badge", theme: THEMED_LABEL } },
};

export const pieces = Object.entries(STYLES).map(([kind, seeds]) => ({
  kind,
  section: "main",
  seeds,
  before_start: reference_strips,
  run: (instance, ctx) => run_mode_label_kind(instance, ctx),
}));
