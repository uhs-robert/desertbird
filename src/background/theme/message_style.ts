// The two theme tokens the hint labels of a message read. The body script draws them with `var(--desertfox-primary)` and `var(--desertfox-bg-core)`, and a style sheet registered for message documents defines them, so the script itself holds no theme code. A message that opens after the theme changed gets the new colors, and one already open keeps the old until it is shown again.

import { token_name } from "../../../vendor/desertfox/theme/tokens.ts";
import type { RoleColors } from "../../../vendor/desertfox/theme/roles.ts";
import type { StoredTheme } from "../../shared/theme_css.ts";

export interface MessageStyleApi {
    messageDisplayScripts: { register(options: { css: { code: string }[] }): Promise<{ unregister(): Promise<void> }> };
}

const block = (colors: RoleColors): string => `:root { ${token_name("primary")}: ${colors.primary}; ${token_name("bg_core")}: ${colors.bg_core}; }`;

export const message_style_css = (theme: StoredTheme): string => `${block(theme.dark)}\n@media (prefers-color-scheme: light) { ${block(theme.light)} }`;

/** Registers the style sheet for the theme, and drops the one before it. The new one goes in first, so a message that opens in between still has colors. */
export function create_message_style(api: MessageStyleApi): (theme: StoredTheme) => Promise<void> {
    let registered: { unregister(): Promise<void> } | undefined;
    return async (theme) => {
        const next = await api.messageDisplayScripts.register({ css: [{ code: message_style_css(theme) }] });
        await registered?.unregister();
        registered = next;
    };
}
