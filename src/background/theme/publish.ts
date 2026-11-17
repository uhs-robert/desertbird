// Writes the resolved theme to `storage.local`, where the pages read it. Pages cannot hold the theme tables, so they get the role colors only.

import { THEME_STORAGE_KEY } from "../../shared/theme_css.ts";
import { resolve_theme } from "./palette.ts";

export interface ThemeStorage {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
}

/** Writes only when the stored value differs, so a settings change that left the theme alone wakes no page. */
export async function publish_theme(storage: ThemeStorage, theme_name: string): Promise<void> {
    const theme = resolve_theme(theme_name);
    const stored = (await storage.get(THEME_STORAGE_KEY))[THEME_STORAGE_KEY];
    if (JSON.stringify(stored) !== JSON.stringify(theme)) await storage.set({ [THEME_STORAGE_KEY]: theme });
}
