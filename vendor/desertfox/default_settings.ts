// STUB: DesertBird stand-in, not a DesertFox file. Stands in for src/shared/default_settings.ts.
// The defaults the compiler reads, with the DesertFox values.

import type { Settings } from "./settings_table.ts";

export const DEFAULT_SETTINGS: Settings = {
  blur_on_load: false,
  focus_on_load: "",
  editable_add: [],
  editable_remove: [],
  editable_remove_unsized: false,
  escape_to_page: false,
  scroll_selector: "",
  hint_add: [],
  hint_remove: [],
  media_quality: "auto",
  strip_tracking: true,
  which_key_delay_ms: 300,
  toast_ms: 3000,
  toast_error_ms: 6000,
  grab_step_px: 3,
  which_key_border: "square",
  which_key_skip: [],
  layout_fallback: true,
  mode_indicator: "always",
  search_prefixes: { here: "s", tab: "S" },
  container_prefixes: { reopen: "c", tab: "C" },
  default_engine: "duck",
  site_rules: [],
  bridge: false,
  bridge_share_tabs: false,
  item_navigator: false,
};
