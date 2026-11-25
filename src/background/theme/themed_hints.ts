// The hints Experiment with the theme colors filled in, so a command asks for a pick and names no color.

import type { HintsApi } from "../../shared/protocol.ts";
import type { ThemedHints } from "../handlers/hint_window.ts";
import { hint_label_colors, resolve_theme } from "./palette.ts";

/** `read_theme_name` reads the setting at each pick, so a change of theme shows on the next one. `read_hint_keys` gives the key sequences bound to a pick, which the parent lets through after a typo. `read_hint_letters` gives the `hint_letters` setting for the labels. */
export function themed_hints(hints: HintsApi | undefined, read_theme_name: () => Promise<string>, read_hint_keys: () => Promise<string[][]> = async () => [], read_hint_letters?: () => Promise<string>): ThemedHints | undefined {
    return hints && { sendEnter: (args) => hints.sendEnter(args), pick: async ({ windowId, tabId, action, place }) => hints.pick({ windowId, ...(action && { action }), ...(place && { place, tabId }), colors: hint_label_colors(resolve_theme(await read_theme_name())), hintKeys: await read_hint_keys(), ...(read_hint_letters && { hintLetters: (await read_hint_letters()).toLowerCase() }) }) };
}
