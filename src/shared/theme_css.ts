// The theme as the background publishes it, and the CSS that puts it on a page. Pages import only this: the theme tables stay in the background.

import { ROLES } from "../../vendor/desertfox/theme/roles.ts";
import type { RoleColors } from "../../vendor/desertfox/theme/roles.ts";
import { token_name } from "../../vendor/desertfox/theme/tokens.ts";

/** The key in `storage.local` that holds the published `StoredTheme`. The background rewrites it when the `theme` setting changes. */
export const THEME_STORAGE_KEY = "desertbird_theme";

export interface StoredTheme {
    dark: RoleColors;
    light: RoleColors;
}

/** Dark is the base block and light sits under the light scheme. A page in the Thunderbird window reads that scheme from Thunderbird itself, not from the OS. */
export function theme_css(theme: StoredTheme, selector: string): string {
    const block = (colors: RoleColors) => ROLES.map((role) => `${token_name(role)}: ${colors[role]};`).join(" ");
    return `${selector} { ${block(theme.dark)} }\n@media (prefers-color-scheme: light) { ${selector} { ${block(theme.light)} } }`;
}
