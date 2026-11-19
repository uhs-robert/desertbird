import { ignore_refusal } from "../../shared/swallow.ts";
import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { BodyFindReply, BodyFindRequest } from "../../shared/protocol.ts";
import type { HandlerScope } from "./message.ts";

export interface MessageFindApi {
    tabs: {
        query(query: { windowId: number; active: true }): Promise<{ id?: number }[]>;
        sendMessage(tab_id: number, message: BodyFindRequest): Promise<BodyFindReply | undefined>;
    };
}

/** Sends the pattern to the body script of the front tab of the window. The script finds, highlights and scrolls. */
export async function find_in_message(scope: HandlerScope<MessageFindApi>, args: CheckedArgs): Promise<void> {
    const pattern = args["pattern"] as string;
    const [tab] = await scope.api.tabs.query({ windowId: scope.window_id, active: true });
    if (tab?.id === undefined) throw new RuntimeRefusal("This window has no message to search.");
    // A tab with no message has no body script, and the send then fails because nothing receives it.
    const reply = await ignore_refusal(scope.api.tabs.sendMessage(tab.id, { type: "body.find", pattern }));
    if (reply === undefined) throw new RuntimeRefusal("No message is shown to search.");
    if (!reply.found) throw new RuntimeRefusal(`"${pattern}" is not in the message.`);
}
