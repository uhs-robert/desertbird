import type { ContextApi } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

export interface ContextHandlerApi {
    context: ContextApi;
}

/** Opens the native context menu of what the key's window has focused. With no target (an empty list, no focus) the key does nothing and shows nothing, as a key past the end of a list does. */
export async function open_context_menu(scope: HandlerScope<ContextHandlerApi>): Promise<void> {
    await scope.api.context.open({ windowId: scope.window_id });
}
