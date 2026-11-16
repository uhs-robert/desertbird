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

// The row range is clamped by the Experiment. A range this large asks for every row.
const ALL_ROWS = { first: 0, last: 2 ** 31 - 1 };

function require_messages(selection: Selection): number[] {
    if (selection.messages.length === 0) throw new RuntimeRefusal("No message is selected.");
    return selection.messages.map((message) => message.id);
}

// Archive and delete may leave the list with no selection. Then the row the selection stood on, or the nearest one after the removal, takes it, so the next key still has a target.
async function act_and_keep_selection(scope: HandlerScope, act: (ids: number[]) => Promise<void>): Promise<void> {
    const ids = require_messages(scope.selection);
    const rows_before = await scope.view.rows(ALL_ROWS);
    const row_index = Math.max(0, rows_before.findIndex((row) => ids.includes(row.id)));
    await act(ids);
    const remaining = await scope.api.mailTabs.getSelectedMessages(scope.selection.tab_id);
    if (remaining.messages.length > 0) return;
    const rows_after = await scope.view.rows(ALL_ROWS);
    if (rows_after.length === 0) return;
    const target = Math.min(row_index, rows_after.length - 1);
    await scope.view.select({ anchor: target, end: target });
}

export function archive(scope: HandlerScope): Promise<void> {
    return act_and_keep_selection(scope, (ids) => scope.api.messages.archive(ids));
}

// `messages.delete` without `skipTrash` moves the messages to Trash.
export function delete_messages(scope: HandlerScope): Promise<void> {
    return act_and_keep_selection(scope, (ids) => scope.api.messages.delete(ids));
}

// The selection of a collapsed thread root holds every message of the thread, while the pane shows one. Reply to what the pane shows.
export async function reply(scope: HandlerScope, args: CheckedArgs): Promise<void> {
    const [message, ...others] = await scope.api.messageDisplay.getDisplayedMessages(scope.selection.tab_id);
    if (message === undefined) throw new RuntimeRefusal("No message is displayed to reply to.");
    if (others.length > 0) throw new RuntimeRefusal("More than one message is displayed. Select one message to reply to.");
    await require_identity(scope.api, message.folder?.accountId);
    await scope.api.compose.beginReply(message.id, REPLY_TYPE[args["to"] as keyof typeof REPLY_TYPE]);
}
