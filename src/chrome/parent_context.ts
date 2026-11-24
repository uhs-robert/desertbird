// The parent script of the `context` API: opens the native context menu of what the focus is on. The build wraps it in an IIFE and a footer defines the ExtensionAPI class `context`. Thunderbird loads it when the first call arrives, so the key script, which loads at startup, carries none of it.

import { open_context_menu, stop_context_actor } from "./context_menu.ts";
import { guard } from "./platform.ts";
import type { ExtensionContext } from "./platform.ts";
import type { ContextOpenArgs } from "../shared/protocol.ts";

export function get_context_api(context: ExtensionContext) {
    return { context: { open: guard("context.open", ({ windowId }: ContextOpenArgs): boolean => open_context_menu(context, windowId)) } };
}

/** Unregisters the menu actor, the one thing this API registers. */
export const shutdown = stop_context_actor;
