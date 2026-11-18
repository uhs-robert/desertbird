// Writes the resolved theme to `storage.local`, where the pages read it. Pages cannot hold the theme tables, so they get the role colors only.

import { THEME_STORAGE_KEY } from "../../shared/theme_css.ts";
import { HINT_STYLE_STORAGE_KEY } from "../../shared/protocol.ts";
import { hint_label_colors, hint_label_style, resolve_theme } from "./palette.ts";

export interface ThemeStorage {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

/** Writes only when the stored value differs, so a settings change that left the theme alone wakes no page. */
export async function publish_theme(storage: ThemeStorage, theme_name: string): Promise<void> {
    const theme = resolve_theme(theme_name);
    const stored = (await storage.get(THEME_STORAGE_KEY))[THEME_STORAGE_KEY];
    if (JSON.stringify(stored) !== JSON.stringify(theme)) await storage.set({ [THEME_STORAGE_KEY]: theme });
    // The body script reads this one: it is a few bytes there where the whole theme would not be.
    const hint_style = hint_label_style(hint_label_colors(theme));
    if ((await storage.get(HINT_STYLE_STORAGE_KEY))[HINT_STYLE_STORAGE_KEY] !== hint_style) await storage.set({ [HINT_STYLE_STORAGE_KEY]: hint_style });
}
