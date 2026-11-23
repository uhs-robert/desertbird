import { refused_as } from "../../shared/swallow.ts";
import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { AppApi } from "../../shared/protocol.ts";
import { require_messages } from "./each_message.ts";
import type { AccountsApi } from "./account_choice.ts";
import type { IdentityApi } from "./identity.ts";
import type { SpecialFolderApi } from "./special_folder.ts";
import { record_moved } from "./undo.ts";
import type { UndoApi } from "./undo.ts";

/** A message as `messages.get` returns it. Only the members the handlers read are listed. */
export interface MessageHeader {
    id: number;
    date: Date;
    size?: number;
    read?: boolean;
    flagged?: boolean;
    junk?: boolean;
    tags?: string[];
    recipients?: string[];
    ccList?: string[];
    bccList?: string[];
    headerMessageId?: string;
    subject?: string;
    author?: string;
    folder?: { id?: string; accountId: string; path?: string; specialUse?: string[] };
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
    accounts: IdentityApi["accounts"] & AccountsApi["accounts"];
    messages: {
        archive(ids: number[]): Promise<void>;
        delete(ids: number[]): Promise<void>;
        get(id: number): Promise<MessageHeader>;
        update(id: number, properties: MessageUpdate): Promise<void>;
        move(ids: number[], folder_id: string): Promise<void>;
        copy(ids: number[], folder_id: string): Promise<void>;
        tags: { list(): Promise<MailTag[]> };
    };
    compose: {
        beginReply(id: number, type: ReplyType, details: { identityId: string }): Promise<{ id?: number } | undefined>;
        beginForward(id: number, forward_type: undefined, details: { identityId: string }): Promise<unknown>;
        beginNew(message_id?: undefined, details?: { to: string[]; subject: string; plainTextBody: string; isPlainText: true; identityId: string }): Promise<unknown>;
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

/** What archive and delete need: the undo log, and the thread list rows a count reaches. */
export type TrashApi = MessageApi & UndoApi & { app: Pick<AppApi, "viewRows"> | undefined };

// A count acts on that many rows from the current one, as `3dd` deletes three lines in vim. The rows are read when the command runs, so the current row must still be one the key press selected.
export async function counted_messages(scope: HandlerScope<TrashApi>): Promise<number[]> {
    const ids = require_messages(scope.message_ids);
    if (scope.count <= 1) return ids;
    const app = scope.api.app;
    if (app === undefined) throw new RuntimeRefusal("A count needs the DesertBird Experiment, which is not loaded.");
    const { current } = await refused_as(app.viewRows({ windowId: scope.window_id, first: 0, last: 0 }), { current: -1 });
    if (current < 0) throw new RuntimeRefusal("A count works only in the thread list, so nothing changed.");
    const [first, ...following] = (await app.viewRows({ windowId: scope.window_id, first: current, last: current + scope.count - 1 })).rows;
    if (first?.id === null || first?.id === undefined || !ids.includes(first.id)) throw new RuntimeRefusal("The selection moved before the count ran, so nothing changed.");
    // The row of a closed thread names only its first message, so a count would split the thread.
    if (following.some((row) => row.collapsed)) throw new RuntimeRefusal("A count does not reach into a closed thread, so nothing changed. Open the thread, or select the messages with v.");
    // A range selected upward ends at its top row, so the rows below can be in the selection already.
    return [...new Set([...ids, ...following.flatMap((row) => (row.id === null ? [] : [row.id]))])];
}

// Thunderbird itself keeps a row selected after an archive or a delete (the next message, or the previous one at the end of the list), so the add-on reselects nothing.
// Archiving makes the year folder on the fly, so the undo searches every Archives folder with its subfolders.
export function archive(scope: HandlerScope<TrashApi>): Promise<void> {
    return record_moved(scope, "archive", async () => {
        const ids = await counted_messages(scope);
        let archive_folder_ids: Promise<string[]> | undefined;
        return {
            ids,
            act: () => scope.api.messages.archive(ids),
            async destination_of() {
                archive_folder_ids ??= scope.api.folders.query({ specialUse: ["archives"] }).then((folders) => folders.map((folder) => folder.id));
                const to_folder_ids = await archive_folder_ids;
                return to_folder_ids.length === 0 ? undefined : { to_folder_ids, to_subfolders: true };
            },
        };
    });
}

// `messages.delete` without `skipTrash` moves the messages to the Trash of their account. A message already in Trash is deleted for good, so it gets no undo item.
export function delete_messages(scope: HandlerScope<TrashApi>): Promise<void> {
    return record_moved(scope, "delete", async () => {
        const ids = await counted_messages(scope);
        const trash_of = new Map<string, Promise<string | undefined>>();
        return {
            ids,
            act: () => scope.api.messages.delete(ids),
            async destination_of(message) {
                if (message.folder.specialUse?.includes("trash")) return undefined;
                const account_id = message.folder.accountId;
                if (!trash_of.has(account_id)) trash_of.set(account_id, scope.api.folders.query({ accountId: account_id, specialUse: ["trash"] }).then(([trash]) => trash?.id));
                const trash_id = await trash_of.get(account_id);
                return trash_id === undefined ? undefined : { to_folder_ids: [trash_id], to_subfolders: false };
            },
        };
    });
}
