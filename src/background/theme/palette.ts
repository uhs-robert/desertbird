// What the background resolves from the `theme` setting: the role colors the pages read, and the mode label colors the Experiment draws.

import { DEFAULT_LIGHT_INTENSITY } from "../../../vendor/desertfox/config.ts";
import { oasis_theme } from "../../../vendor/desertfox/theme/load.ts";
import type { RoleColors } from "../../../vendor/desertfox/theme/roles.ts";
import { luminance } from "../../../vendor/desertfox/theme/contrast.ts";
import type { ModeLabelColors, ModeLabelScheme } from "../../shared/protocol.ts";
import { DEFAULT_THEME } from "../../shared/theme_choice.ts";
import type { StoredTheme } from "../../shared/theme_css.ts";

/** The theme of a name. A name the table does not know, such as one from a hand-edited setting, gives the default. */
export function resolve_theme(name: string): StoredTheme {
    // `oasis_theme` and not `load_theme`: only the latter reaches the contributed themes table, which no setting value can pick.
    const theme = oasis_theme(name) ?? oasis_theme(DEFAULT_THEME)!;
    return { dark: theme.dark, light: theme.light[DEFAULT_LIGHT_INTENSITY] };
}

export function contrast_ratio(first: string, second: string): number {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter! + 0.05) / (darker! + 0.05);
}

// The text on a badge is whichever of the theme's own background and text color reads better on the mode colors.
function scheme_of(colors: RoleColors): ModeLabelScheme {
    const modes = [colors.mode_normal, colors.mode_visual, colors.mode_insert];
    const worst_on = (text: string) => Math.min(...modes.map((mode) => contrast_ratio(text, mode)));
    return {
        normal: colors.mode_normal,
        visual: colors.mode_visual,
        insert: colors.mode_insert,
        on_badge: worst_on(colors.bg_core) >= worst_on(colors.fg_core) ? colors.bg_core : colors.fg_core,
    };
}

/** The label sits on Thunderbird's status bar, not on the theme background, so each scheme takes the mode roles of the matching set. `test/theme.test.ts` checks them against the status bar of both Thunderbird schemes. */
export function mode_label_colors(theme: StoredTheme): ModeLabelColors {
    return { dark: scheme_of(theme.dark), light: scheme_of(theme.light) };
}
