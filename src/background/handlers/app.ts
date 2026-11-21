import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { AppApi, Pane, PaneResizeDirection } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

export interface AppHandlerApi {
    app: AppApi;
}

type AppScope = HandlerScope<AppHandlerApi>;

export async function open_conversation(scope: AppScope): Promise<void> {
    if (!(await scope.api.app.appCommand({ windowId: scope.window_id, name: "cmd_openConversation" }))) throw new RuntimeRefusal("Thunderbird cannot open a conversation for this selection.");
}

export async function open_page(scope: AppScope, args: CheckedArgs): Promise<void> {
    await scope.api.app.appOpenPage({ windowId: scope.window_id, page: args["page"] as "addons" | "themes" | "config" });
}

export async function focus_pane(scope: AppScope, args: CheckedArgs): Promise<void> {
    if (!(await scope.api.app.paneFocus({ windowId: scope.window_id, pane: args["pane"] as Pane }))) throw new RuntimeRefusal("That pane is hidden or shows no message.");
}

export async function resize_pane(scope: AppScope, args: CheckedArgs): Promise<void> {
    const direction = args["direction"] as PaneResizeDirection;
    if (!(await scope.api.app.paneResize({ windowId: scope.window_id, direction, steps: scope.count }))) throw new RuntimeRefusal(direction === "up" || direction === "down" ? "Nothing to resize in that direction here." : "Nothing to resize in that direction here, or the pane is hidden.");
}

// Past the end the focus just stays, with no toast: the key does nothing, as at the end of a list.
export const focus_pane_beside = (side: "left" | "right") => async (scope: AppScope): Promise<void> => void (await scope.api.app.paneFocus({ windowId: scope.window_id, pane: side }));
