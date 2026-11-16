import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import type { ViewApi } from "../../shared/protocol.ts";
import { require_identity } from "./identity.ts";
import type { IdentityApi } from "./identity.ts";

export interface SelectedMessage {
    id: number;
    account_id: string | undefined;
}

export interface Selection {
    tab_id: number;
    messages: SelectedMessage[];
}

export interface MessageApi extends IdentityApi {
    messages: { archive(ids: number[]): Promise<void>; delete(ids: number[]): Promise<void> };
    compose: { beginReply(id: number, type: "replyToSender"): Promise<unknown> };
    // An array, unlike `mailTabs.getSelectedMessages`, on Thunderbird 153 and Betterbird.
    messageDisplay: { getDisplayedMessages(tab_id: number): Promise<{ id: number; folder?: { accountId: string } }[]> };
    mailTabs: { getSelectedMessages(tab_id: number): Promise<{ messages: { id: number; folder?: { accountId: string } }[] }> };
}

/** What the router hands a handler: the API subset, the selection of the window's active tab and the view verbs the command listed in `needs`. */
export interface HandlerScope {
    api: MessageApi;
    view: ViewApi;
    selection: Selection;
}

const REPLY_TYPE = { sender: "replyToSender" } as const;

function require_messages(selection: Selection): number[] {
    if (selection.messages.length === 0) throw new RuntimeRefusal("No message is selected.");
    return selection.messages.map((message) => message.id);
}

// Thunderbird itself keeps a row selected after an archive or a delete (the next message, or the previous one at the end of the list), so the add-on reselects nothing.
export function archive(scope: HandlerScope): Promise<void> {
    return scope.api.messages.archive(require_messages(scope.selection));
}

// `messages.delete` without `skipTrash` moves the messages to Trash.
export function delete_messages(scope: HandlerScope): Promise<void> {
    return scope.api.messages.delete(require_messages(scope.selection));
}

// The selection of a collapsed thread root holds every message of the thread, while the pane shows one. Reply to what the pane shows.
export async function reply(scope: HandlerScope, args: CheckedArgs): Promise<void> {
    const [message, ...others] = await scope.api.messageDisplay.getDisplayedMessages(scope.selection.tab_id);
    if (message === undefined) throw new RuntimeRefusal("No message is displayed to reply to.");
    if (others.length > 0) throw new RuntimeRefusal("More than one message is displayed. Select one message to reply to.");
    await require_identity(scope.api, message.folder?.accountId);
    await scope.api.compose.beginReply(message.id, REPLY_TYPE[args["to"] as keyof typeof REPLY_TYPE]);
}
