// STUB: DesertBird stand-in, not a DesertFox file. Stands in for src/shared/config.ts.
// The compiler and `prefix_tree.ts` take only these names from it.

export type { ModeIndicator, Settings, WhichKeyBorder } from "./settings_table.ts";
export { DEFAULT_SETTINGS } from "./default_settings.ts";

// `theme/load.ts` takes the middle light set when the intensity is out of range. DesertBird has no light_intensity setting, so this is the one set it uses.
export const DEFAULT_LIGHT_INTENSITY = 3;
