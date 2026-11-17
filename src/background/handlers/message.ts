import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { require_messages } from "./each_message.ts";
import { require_identity } from "./identity.ts";
import type { IdentityApi } from "./identity.ts";

/** A message as `messages.get` returns it. Only the members the handlers read are listed. */
export interface MessageHeader {
    id: number;
    date: Date;
    folder?: { accountId: string };
}

export interface MessageApi extends IdentityApi {
    messages: { archive(ids: number[]): Promise<void>; delete(ids: number[]): Promise<void>; get(id: number): Promise<MessageHeader> };
    compose: { beginReply(id: number, type: "replyToSender"): Promise<unknown> };
}

/** What the router hands a handler: the API subset, the window the key was pressed in and the ids of the messages selected when the key was pressed. */
export interface HandlerScope<Api = MessageApi> {
    api: Api;
    window_id: number;
    message_ids: number[];
    /** The count typed before the key, 1 when none. A command reads it only when its definition says `count: "repeat"`. */
    count: number;
}

const REPLY_TYPE = { sender: "replyToSender" } as const;

// Thunderbird itself keeps a row selected after an archive or a delete (the next message, or the previous one at the end of the list), so the add-on reselects nothing.
export function archive(scope: HandlerScope): Promise<void> {
    return scope.api.messages.archive(require_messages(scope.message_ids));
}

// `messages.delete` without `skipTrash` moves the messages to Trash.
export function delete_messages(scope: HandlerScope): Promise<void> {
    return scope.api.messages.delete(require_messages(scope.message_ids));
}

const newest = (messages: MessageHeader[]): MessageHeader | undefined =>
    messages.reduce<MessageHeader | undefined>((latest, message) => (latest === undefined || new Date(message.date).getTime() > new Date(latest.date).getTime() ? message : latest), undefined);

// A selected collapsed thread root stands for the whole thread. The reply then goes to its newest message, the one the conversation continues from.
export async function reply(scope: HandlerScope, args: CheckedArgs): Promise<void> {
    const message = newest(await Promise.all(scope.message_ids.map((id) => scope.api.messages.get(id))));
    if (message === undefined) throw new RuntimeRefusal("No message is selected to reply to.");
    await require_identity(scope.api, message.folder?.accountId);
    await scope.api.compose.beginReply(message.id, REPLY_TYPE[args["to"] as keyof typeof REPLY_TYPE]);
}
