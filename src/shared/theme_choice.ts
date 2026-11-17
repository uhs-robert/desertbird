// The names the `theme` setting accepts. Only the Oasis themes: the vendored table also holds contributed themes whose light sets were not made for DesertBird's surfaces.

import { BUILT_IN_THEME_NAMES } from "../../vendor/desertfox/theme_names.ts";

export const OASIS_THEME_NAMES: readonly string[] = BUILT_IN_THEME_NAMES.filter((name) => name.startsWith("oasis_"));

export const DEFAULT_THEME = "oasis_moonlight";
