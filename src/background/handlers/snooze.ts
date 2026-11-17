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
/** Where an existing Snoozed folder sits: under the account root, or under INBOX on a server whose personal namespace is `INBOX.`. */
const SNOOZED_PATHS = [`/${SNOOZED_NAME}`, `/INBOX/${SNOOZED_NAME}`];
/** The account type Thunderbird gives Local Folders. */
const LOCAL_ACCOUNT_TYPE = "none";

interface MessagePage {
    /** Set while more pages follow. */
    id?: string | null;
    messages: MessageHeader[];
}

interface MessageQueryApi {
    messages: {
        query(query: { headerMessageId: string; folderId: string; autoPaginationTimeout: number }): Promise<MessagePage>;
        continueList(list_id: string): Promise<MessagePage>;
    };
}

/** What `msg.snooze` needs, beyond the notification call. */
export interface SnoozeApi extends MessageQueryApi {
    messages: MessageQueryApi["messages"] & { get(id: number): Promise<MessageHeader>; move(ids: number[], folder_id: string): Promise<void> };
    folders: SpecialFolderApi["folders"] & { create(parent_folder_id: string, name: string): Promise<MailFolder> };
    accounts: { list(): Promise<{ id: string; type: string }[]> };
    snooze: { items: Pick<SnoozeStore, "add" | "list">; now(): Date; create_timeout_ms: number };
}

/** What the wake needs. */
export interface WakeApi extends MessageQueryApi, SpecialFolderApi, NotificationsApi {
    messages: MessageQueryApi["messages"] & { move(ids: number[], folder_id: string): Promise<void>; update(id: number, properties: { read: boolean }): Promise<void> };
    accounts: { list(): Promise<{ id: string }[]> };
}

/** Every page of one query. A page ends after a set number of matches, so the first page alone can miss the message. */
async function query_all(api: MessageQueryApi, header_message_id: string, folder_id: string): Promise<MessageHeader[]> {
    const found: MessageHeader[] = [];
    let page = await api.messages.query({ headerMessageId: header_message_id, folderId: folder_id, autoPaginationTimeout: 0 });
    for (;;) {
        found.push(...page.messages);
        if (page.id === undefined || page.id === null) return found;
        page = await api.messages.continueList(page.id);
    }
}

async function existing_snoozed(api: SnoozeApi, account_id: string): Promise<MailFolder | undefined> {
    for (const path of SNOOZED_PATHS) {
        const [folder] = await api.folders.query({ accountId: account_id, path });
        if (folder !== undefined) return folder;
    }
    return undefined;
}

function with_timeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => void (timer = setTimeout(() => reject(new Error(`${what} timed out. The message stays where it is.`)), ms)));
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// One lookup-and-create per account at a time: two quick snoozes in an account with no Snoozed folder yet would otherwise both create it, and the second create fails with "already exists".
const resolving = new Map<string, Promise<MailFolder | undefined>>();

async function create_snoozed(api: SnoozeApi, root: MailFolder): Promise<MailFolder> {
    try {
        return await with_timeout(api.folders.create(root.id, SNOOZED_NAME), api.snooze.create_timeout_ms, "Creating the Snoozed folder");
    } catch (error) {
        // A create that lost a race fails because the folder now exists.
        const raced = await existing_snoozed(api, root.accountId);
        if (raced !== undefined) return raced;
        throw error;
    }
}

async function resolve_snoozed(api: SnoozeApi, account_id: string): Promise<MailFolder | undefined> {
    const existing = await existing_snoozed(api, account_id);
    if (existing !== undefined) return existing;
    const [root] = await api.folders.query({ accountId: account_id, isRoot: true });
    // An account that cannot hold subfolders (the root says so) is the one case that falls back. Any other failure refuses the snooze.
    if (root === undefined || root.canAddSubfolders === false) return undefined;
    return create_snoozed(api, root);
}

function find_or_create_snoozed(api: SnoozeApi, account_id: string): Promise<MailFolder | undefined> {
    const pending = resolving.get(account_id);
    if (pending !== undefined) return pending;
    const started = resolve_snoozed(api, account_id).finally(() => resolving.delete(account_id));
    resolving.set(account_id, started);
    return started;
}

// The Snoozed folder stays in the message's own account, so an IMAP message stays on its server. An account that cannot hold the folder falls back to Local Folders.
async function snoozed_folder(api: SnoozeApi, account_id: string): Promise<MailFolder> {
    const own = await find_or_create_snoozed(api, account_id);
    if (own !== undefined) return own;
    const local = (await api.accounts.list()).find((account) => account.type === LOCAL_ACCOUNT_TYPE);
    const fallback = local === undefined || local.id === account_id ? undefined : await find_or_create_snoozed(api, local.id);
    if (fallback === undefined) throw new RuntimeRefusal("This account cannot hold a Snoozed folder, and Local Folders cannot either.");
    return fallback;
}

export async function snooze_messages(scope: HandlerScope<SnoozeApi & NotificationsApi>, args: CheckedArgs): Promise<void> {
    const { api } = scope;
    const now = api.snooze.now();
    const due_ms = preset_due_ms(String(args["until"]) as SnoozePreset, now);
    const folders = new Map<string, MailFolder>();
    await for_each_message(scope.message_ids, async (id) => {
        const message = await api.messages.get(id);
        const header_message_id = message.headerMessageId;
        const account_id = message.folder?.accountId;
        if (header_message_id === undefined || header_message_id === "" || account_id === undefined) throw new RuntimeRefusal("This message has no Message-ID header, so it cannot come back at the due time.");
        // A message already waiting in its Snoozed folder (it has an item for this folder) only gets a new time. Its origin account is the stored one, since the folder may sit in Local Folders.
        const stored = (await api.snooze.items.list()).find((item) => item.header_message_id === header_message_id && item.folder_id === message.folder?.id);
        if (stored !== undefined) {
            await api.snooze.items.add({ ...stored, due_ms });
            return;
        }
        const target = folders.get(account_id) ?? (await snoozed_folder(api, account_id));
        folders.set(account_id, target);
        if (target.id !== message.folder?.id) await api.messages.move([id], target.id);
        await api.snooze.items.add({ header_message_id, origin_account_id: account_id, folder_id: target.id, due_ms });
    });
    const count = scope.message_ids.length;
    await notify_refusal(api, `Snoozed ${count} message${count === 1 ? "" : "s"} until ${new Date(due_ms).toLocaleString()}.`);
}

// Runs at each tick for an item that came due. It is safe to repeat: it finds the message wherever the last try left it. A thrown error keeps the item for the next tick. Only an account that is gone drops the item, since a folder lookup that fails at start can pass a minute later.
export async function wake_snoozed(api: WakeApi, item: SnoozeItem): Promise<void> {
    let inbox;
    try {
        inbox = await special_folder(api, "inbox", item.origin_account_id);
    } catch (error) {
        if ((await api.accounts.list()).some((account) => account.id === item.origin_account_id)) throw error;
        await notify_refusal(api, "A snoozed message could not return, because its account is gone. It stays in the Snoozed folder.");
        return;
    }
    const waiting = (await query_all(api, item.header_message_id, item.folder_id))[0];
    if (waiting !== undefined) await api.messages.move([waiting.id], inbox.id);
    // The move gives the message a new id, so the unread mark needs a fresh lookup.
    const returned = (await query_all(api, item.header_message_id, inbox.id))[0];
    if (returned === undefined && waiting === undefined) {
        await notify_refusal(api, "A snoozed message is no longer in the Snoozed folder, so it did not return.");
        return;
    }
    if (returned !== undefined) await api.messages.update(returned.id, { read: false });
    await notify_refusal(api, `Snoozed message back in the Inbox: ${(waiting ?? returned)?.subject ?? item.header_message_id}`);
}
