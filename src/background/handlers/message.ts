import { require_messages } from "./each_message.ts";
import type { IdentityApi } from "./identity.ts";
import type { SpecialFolderApi } from "./special_folder.ts";

/** A message as `messages.get` returns it. Only the members the handlers read are listed. */
export interface MessageHeader {
    id: number;
    date: Date;
    read?: boolean;
    flagged?: boolean;
    junk?: boolean;
    tags?: string[];
    recipients?: string[];
    ccList?: string[];
    bccList?: string[];
    headerMessageId?: string;
    subject?: string;
    folder?: { id?: string; accountId: string; path?: string };
}

export interface MailTag {
    key: string;
    tag: string;
}

export interface MessageUpdate {
    read?: boolean;
    flagged?: boolean;
    junk?: boolean;
    tags?: string[];
}

export type ReplyType = "replyToSender" | "replyToAll" | "replyToList";

export interface MessageApi extends IdentityApi, SpecialFolderApi {
    messages: {
        archive(ids: number[]): Promise<void>;
        delete(ids: number[]): Promise<void>;
        get(id: number): Promise<MessageHeader>;
        update(id: number, properties: MessageUpdate): Promise<void>;
        move(ids: number[], folder_id: string): Promise<void>;
        tags: { list(): Promise<MailTag[]> };
    };
    compose: {
        beginReply(id: number, type: ReplyType, details: { identityId: string }): Promise<unknown>;
        beginForward(id: number, forward_type: undefined, details: { identityId: string }): Promise<unknown>;
        beginNew(): Promise<unknown>;
    };
    folders: SpecialFolderApi["folders"] & { markAsRead(folder_id: string): Promise<void> };
}

/** What the router hands a handler: the API subset, the window the key was pressed in and the ids of the messages selected when the key was pressed. */
export interface HandlerScope<Api = MessageApi> {
    api: Api;
    window_id: number;
    message_ids: number[];
    /** The count typed before the key, 1 when none. A command reads it only when its definition says `count: "repeat"`. */
    count: number;
}

// Thunderbird itself keeps a row selected after an archive or a delete (the next message, or the previous one at the end of the list), so the add-on reselects nothing.
export function archive(scope: HandlerScope): Promise<void> {
    return scope.api.messages.archive(require_messages(scope.message_ids));
}

// `messages.delete` without `skipTrash` moves the messages to Trash.
export function delete_messages(scope: HandlerScope): Promise<void> {
    return scope.api.messages.delete(require_messages(scope.message_ids));
}
