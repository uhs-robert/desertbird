// Keeps the theme tokens of an extension page current. The hud, the command line and the options page call it first.

import { THEME_STORAGE_KEY, theme_css } from "./theme_css.ts";
import type { StoredTheme } from "./theme_css.ts";

declare const messenger: {
    storage: {
        local: { get(key: string): Promise<Record<string, unknown>> };
        onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
    };
};

/** A hung read must not keep the page transparent for good. */
const FIRST_READ_DEADLINE_MS = 1000;

/** The page stays transparent until the first read returns, so no color of a missing token shows first. Opacity and not `visibility`: a hidden input cannot take the focus the command line asks for at load. */
export function follow_theme(selector = ":root"): void {
    const sheet = document.createElement("style");
    document.head.append(sheet);
    const page = document.documentElement;
    const show = () => void (page.style.opacity = "");
    page.style.opacity = "0";
    setTimeout(show, FIRST_READ_DEADLINE_MS);
    const apply = (theme: unknown) => void (sheet.textContent = theme ? theme_css(theme as StoredTheme, selector) : "");
    messenger.storage.local.get(THEME_STORAGE_KEY).then((stored) => apply(stored[THEME_STORAGE_KEY]), console.error).finally(show);
    messenger.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && THEME_STORAGE_KEY in changes) apply(changes[THEME_STORAGE_KEY]!.newValue);
    });
}
