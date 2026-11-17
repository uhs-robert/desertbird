import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { KeysApi } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

export interface AppApi {
    keys: KeysApi;
}

type AppScope = HandlerScope<AppApi>;

export async function undo(scope: AppScope): Promise<void> {
    if (!(await scope.api.keys.appCommand({ windowId: scope.window_id, name: "cmd_undo" }))) throw new RuntimeRefusal("Nothing to undo.");
}

export async function open_conversation(scope: AppScope): Promise<void> {
    if (!(await scope.api.keys.appCommand({ windowId: scope.window_id, name: "cmd_openConversation" }))) throw new RuntimeRefusal("Thunderbird cannot open a conversation for this selection.");
}

export async function open_page(scope: AppScope, args: CheckedArgs): Promise<void> {
    await scope.api.keys.appOpenPage({ windowId: scope.window_id, page: args["page"] as "addons" | "themes" | "config" });
}

export async function focus_pane(scope: AppScope, args: CheckedArgs): Promise<void> {
    await scope.api.keys.paneFocus({ windowId: scope.window_id, pane: args["pane"] as "folders" | "threads" | "message" });
}
