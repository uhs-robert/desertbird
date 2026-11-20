// The parent script of the `app` API: the verbs that read or move the thread list, move the focus between panes, run a Thunderbird command and open a fixed page. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `app`. Thunderbird loads it when the first call arrives, so the key script, which loads at startup, carries none of it.

import { app_verbs } from "./app_verbs.ts";
import type { ExtensionContext } from "./platform.ts";
import { view_verbs } from "./view_verbs.ts";

export function get_app_api(context: ExtensionContext) {
    return { app: { ...view_verbs(context), ...app_verbs(context) } };
}

/** Holds no state, so there is nothing to remove. */
export function shutdown(): void {}
