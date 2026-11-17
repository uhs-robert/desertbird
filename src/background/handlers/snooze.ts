import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { for_each_message } from "./each_message.ts";
import type { MailFolder } from "./displayed_folder.ts";
import type { HandlerScope, MessageHeader } from "./message.ts";
import { notify_refusal } from "../notify.ts";
import type { NotificationsApi } from "../notify.ts";
import { preset_due_ms } from "../snooze_presets.ts";
import type { SnoozePreset } from "../snooze_presets.ts";
import type { SnoozeItem, SnoozeStore } from "../snooze_store.ts";
import { special_folder } from "./special_folder.ts";
import type { SpecialFolderApi } from "./special_folder.ts";

const SNOOZED_NAME = "Snoozed";
const SNOOZED_PATH = `/${SNOOZED_NAME}`;
/** The account type Thunderbird gives Local Folders. */
const LOCAL_ACCOUNT_TYPE = "none";

interface MessageQueryApi {
    messages: { query(query: { headerMessageId: string }): Promise<{ messages: MessageHeader[] }> };
}

/** What `msg.snooze` needs, beyond the notification call. */
export interface SnoozeApi extends MessageQueryApi {
    messages: MessageQueryApi["messages"] & { get(id: number): Promise<MessageHeader>; move(ids: number[], folder_id: string): Promise<void> };
    folders: SpecialFolderApi["folders"] & { create(parent_folder_id: string, name: string): Promise<MailFolder> };
    accounts: { list(): Promise<{ id: string; type: string }[]> };
    snooze: { items: Pick<SnoozeStore, "add" | "list">; now(): Date };
}

/** What the wake needs. */
export interface WakeApi extends MessageQueryApi, SpecialFolderApi, NotificationsApi {
    messages: MessageQueryApi["messages"] & { move(ids: number[], folder_id: string): Promise<void>; update(id: number, properties: { read: boolean }): Promise<void> };
}

async function find_or_create_snoozed(api: SnoozeApi, account_id: string): Promise<MailFolder> {
    const [existing] = await api.folders.query({ accountId: account_id, path: SNOOZED_PATH });
    if (existing !== undefined) return existing;
    const [root] = await api.folders.query({ accountId: account_id, isRoot: true });
    if (root === undefined) throw new RuntimeRefusal("The account has no root folder to hold a Snoozed folder.");
    return api.folders.create(root.id, SNOOZED_NAME);
}

// The Snoozed folder stays in the message's own account, so an IMAP message stays on its server. An account that cannot hold the folder (a refused create) falls back to Local Folders.
async function snoozed_folder(api: SnoozeApi, account_id: string): Promise<MailFolder> {
    try {
        return await find_or_create_snoozed(api, account_id);
    } catch (error) {
        const local = (await api.accounts.list()).find((account) => account.type === LOCAL_ACCOUNT_TYPE);
        if (local === undefined || local.id === account_id) throw error;
        return find_or_create_snoozed(api, local.id);
    }
}

const is_same_message = (item: SnoozeItem, header_message_id: string) => item.header_message_id === header_message_id;

export async function snooze_messages(scope: HandlerScope<SnoozeApi & NotificationsApi>, args: CheckedArgs): Promise<void> {
    const { api } = scope;
    const now = api.snooze.now();
    const due_ms = preset_due_ms(String(args["until"]) as SnoozePreset, now);
    const folders = new Map<string, MailFolder>();
    await for_each_message(scope.message_ids, async (id) => {
        const message = await api.messages.get(id);
        const account_id = message.folder?.accountId;
        if (message.headerMessageId === undefined || message.headerMessageId === "" || account_id === undefined) throw new RuntimeRefusal("This message has no Message-ID header, so it cannot come back at the due time.");
        if (message.folder?.path === SNOOZED_PATH) {
            // Snoozed again from the Snoozed folder: the message stays and only the time changes. Its origin account is the one stored, since this folder may sit in Local Folders.
            const stored = (await api.snooze.items.list()).find((item) => is_same_message(item, message.headerMessageId!));
            await api.snooze.items.add({ header_message_id: message.headerMessageId, origin_account_id: stored?.origin_account_id ?? account_id, due_ms });
            return;
        }
        const target = folders.get(account_id) ?? (await snoozed_folder(api, account_id));
        folders.set(account_id, target);
        await api.messages.move([id], target.id);
        await api.snooze.items.add({ header_message_id: message.headerMessageId, origin_account_id: account_id, due_ms });
    });
    const count = scope.message_ids.length;
    await notify_refusal(api, `Snoozed ${count} message${count === 1 ? "" : "s"} until ${new Date(due_ms).toLocaleString()}.`);
}

// Runs at each tick for an item that came due. It is safe to repeat: it finds the message wherever the last try left it, and a thrown error keeps the item for the next tick.
export async function wake_snoozed(api: WakeApi, item: SnoozeItem): Promise<void> {
    const inbox = await special_folder(api, "inbox", item.origin_account_id).catch(() => undefined);
    if (inbox === undefined) {
        await notify_refusal(api, "A snoozed message could not return, because its account has no Inbox any more. It stays in the Snoozed folder.");
        return;
    }
    const copies = async () => (await api.messages.query({ headerMessageId: item.header_message_id })).messages;
    const waiting = (await copies()).find((message) => message.folder?.path === SNOOZED_PATH);
    if (waiting !== undefined) await api.messages.move([waiting.id], inbox.id);
    // The move gives the message a new id, so the unread mark needs a fresh lookup.
    const returned = (await copies()).find((message) => message.folder?.id === inbox.id);
    if (returned === undefined && waiting === undefined) {
        await notify_refusal(api, "A snoozed message is gone, so it did not return.");
        return;
    }
    if (returned !== undefined) await api.messages.update(returned.id, { read: false });
    await notify_refusal(api, `Snoozed message back in the Inbox: ${(waiting ?? returned)?.subject ?? item.header_message_id}`);
}
