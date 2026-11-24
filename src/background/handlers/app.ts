import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { AppApi, AppOpenPageArgs, Pane, PaneResizeDirection } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";
import { MESSAGE_WINDOW_TYPE } from "../window_types.ts";
import { main_window_of } from "./tabs.ts";
import type { MainWindowApi } from "./tabs.ts";

export interface AppHandlerApi {
    app: AppApi;
}

type AppScope = HandlerScope<AppHandlerApi>;

export async function open_conversation(scope: AppScope): Promise<void> {
    if (!(await scope.api.app.appCommand({ windowId: scope.window_id, name: "cmd_openConversation" }))) throw new RuntimeRefusal("Thunderbird cannot open a conversation for this selection.");
}

// The page opens in a tab, so a key in a message window opens it in the main window.
export async function open_page(scope: HandlerScope<AppHandlerApi & MainWindowApi>, args: CheckedArgs): Promise<void> {
    const page = args["page"] as AppOpenPageArgs["page"];
    if (!(await scope.api.app.appOpenPage({ windowId: await main_window_of(scope.api, scope.window_id), page }))) throw new RuntimeRefusal("Chat is turned off.");
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

// A message window only: in the mail tab the list steps with `] u` and the thread keys. The Experiment answers false for a window with no message list (an .eml) and at the first or last message, and never wraps.
export async function step_message(scope: HandlerScope<AppHandlerApi & MainWindowApi>, args: CheckedArgs): Promise<void> {
    if ((await scope.api.windows.get(scope.window_id)).type !== MESSAGE_WINDOW_TYPE) throw new RuntimeRefusal("Stepping the message is only available in a message window.");
    const forward = args["direction"] === "next";
    const unread = args["unread"] === true;
    const name = unread ? (forward ? "cmd_nextUnreadMsg" : "cmd_previousUnreadMsg") : forward ? "cmd_nextMsg" : "cmd_previousMsg";
    if (!(await scope.api.app.appCommand({ windowId: scope.window_id, name }))) throw new RuntimeRefusal(`No ${forward ? "later" : "earlier"} ${unread ? "unread " : ""}message here.`);
}
