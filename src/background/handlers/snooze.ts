import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { for_each_message } from "./each_message.ts";
import type { MailFolder } from "./displayed_folder.ts";
import type { HandlerScope, MessageHeader } from "./message.ts";
import { past_start_grace } from "./followup.ts";
import { notify_refusal, notify_result } from "../notify.ts";
import type { NotificationsApi } from "../notify.ts";
import { preset_due_ms } from "../snooze_presets.ts";
import type { SnoozePreset } from "../snooze_presets.ts";
import type { SnoozeItem, SnoozeStore } from "../snooze_store.ts";
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
        query(query: { headerMessageId?: string; folderId?: string; accountId?: string; unread?: true; messagesPerPage?: number; autoPaginationTimeout: number }): Promise<MessagePage>;
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
    accounts: { list(): Promise<{ id: string; type: string }[]> };
    /** Reads the `notice_show_subject` setting. Absent means the subject stays out. */
    show_subject?: () => Promise<boolean>;
    messages: MessageQueryApi["messages"] & { move(ids: number[], folder_id: string): Promise<void>; update(id: number, properties: { read: boolean }): Promise<void> };
}

/** Every page of one query. A page ends after a set number of matches, so the first page alone can miss the message. */
async function query_all(api: MessageQueryApi, header_message_id: string, folder_id?: string): Promise<MessageHeader[]> {
    const found: MessageHeader[] = [];
    let page = await api.messages.query({ headerMessageId: header_message_id, ...(folder_id === undefined ? {} : { folderId: folder_id }), autoPaginationTimeout: 0 });
    for (;;) {
        found.push(...page.messages);
        if (page.id === undefined || page.id === null) return found;
        page = await api.messages.continueList(page.id);
    }
}

async function existing_snoozed(api: SpecialFolderApi, account_id: string): Promise<MailFolder | undefined> {
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
    // `canAddSubfolders` is a query filter, not a field of the folder the query returns. A root that cannot hold subfolders (a news account) matches nothing, and that is the one case that falls back. Any other failure refuses the snooze.
    const [root] = await api.folders.query({ accountId: account_id, isRoot: true, canAddSubfolders: true });
    if (root === undefined) return undefined;
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
        const origin_folder_id = message.folder?.id;
        if (origin_folder_id === undefined) throw new RuntimeRefusal("This message is not in a folder, so it cannot come back to one.");
        if (header_message_id === undefined || header_message_id === "" || account_id === undefined) throw new RuntimeRefusal("This message has no Message-ID header, so it cannot come back at the due time.");
        // A message already waiting in its Snoozed folder (it has an item for this folder) only gets a new time. Its origin account is the stored one, since the folder may sit in Local Folders.
        const stored = (await api.snooze.items.list()).find((item) => item.header_message_id === header_message_id && item.folder_id === message.folder?.id);
        if (stored !== undefined) {
            await api.snooze.items.add({ ...stored, due_ms });
            return;
        }
        const target = folders.get(account_id) ?? (await snoozed_folder(api, account_id));
        folders.set(account_id, target);
        // Recorded before the move: a quit between the two would otherwise leave a hidden message with no item to bring it back. A move that fails leaves an item for a message still in place, and the wake handles that.
        await api.snooze.items.add({ header_message_id, origin_account_id: account_id, folder_id: target.id, origin_folder_id, due_ms });
        if (target.id !== message.folder?.id) await api.messages.move([id], target.id);
    });
    const count = scope.message_ids.length;
    await notify_result(api, `Snoozed ${count} message${count === 1 ? "" : "s"} until ${new Date(due_ms).toLocaleString()}.`, scope.window_id);
}

/** A message missing from both folders keeps its item this long after the due time, since an account can show it late. The wait only counts once the start grace is over, so a Thunderbird that was closed past the due time still gets its sync. */
const MISSING_MESSAGE_GIVE_UP_MS = 30 * 60 * 1000;

/** The clock of one wake: the tick time and when the background page started. */
export interface WakeTiming {
    now_ms: number;
    started_ms: number;
}

/** The folder, or undefined when it is gone. The API throws for a folder id it does not know. */
async function folder_by_id(api: WakeApi, folder_id: string): Promise<MailFolder | undefined> {
    try {
        return (await api.folders.query({ folderId: folder_id }))[0];
    } catch (error) {
        // Only the unknown-folder error means gone. A transient failure retries at the next tick.
        if (error instanceof Error && /not found/i.test(error.message)) return undefined;
        throw error;
    }
}

/** Where the message waits: the stored Snoozed folder, or, when that folder is gone or renamed, the Snoozed folder found again by path in the origin account and in Local Folders (the only fallback home of one). Nothing outside those folders is queried, so a Gmail Starred, label or All Mail copy, a filed copy and an other-account copy stay put. */
async function waiting_copies(api: WakeApi, item: SnoozeItem, folder_still_there: boolean): Promise<MessageHeader[]> {
    if (folder_still_there) return query_all(api, item.header_message_id, item.folder_id);
    const local_ids = (await api.accounts.list()).filter((account) => account.type === LOCAL_ACCOUNT_TYPE).map((account) => account.id);
    const found: MessageHeader[] = [];
    for (const account_id of new Set([item.origin_account_id, ...local_ids])) {
        // Both paths, not the first match: a stray folder at one path must not hide the one at the other. A folder with a special use (Archives, a Gmail Starred view) is never a Snoozed folder.
        for (const path of SNOOZED_PATHS) {
            for (const folder of await api.folders.query({ accountId: account_id, path })) {
                if (folder.specialUse === undefined || folder.specialUse.length === 0) found.push(...(await query_all(api, item.header_message_id, folder.id)));
            }
        }
    }
    return found;
}

/** The message cannot return yet. The item stays and the next tick retries, until the give-up time passes. Then the item is dropped with a notice. */
async function retry_or_drop(api: WakeApi, item: SnoozeItem, timing: WakeTiming, notice: string): Promise<void> {
    if (timing.now_ms - item.due_ms < MISSING_MESSAGE_GIVE_UP_MS || !past_start_grace(timing.started_ms, timing.now_ms)) throw new Error("A snoozed message could not return yet. Trying again at the next tick.");
    await notify_refusal(api, notice);
}

// Runs at each tick for an item that came due. It is safe to repeat: it finds the message wherever the last try left it. A thrown error keeps the item for the next tick. An item is dropped, with a notice, only when the message could not return (it is not found, or the account has no Inbox) for `MISSING_MESSAGE_GIVE_UP_MS` past its due time. The notice names the subject only when `notice_show_subject` is on, since the notice can reach the desktop.
export async function wake_snoozed(api: WakeApi, item: SnoozeItem, timing: WakeTiming): Promise<void> {
    const snoozed_folder_still_there = (await folder_by_id(api, item.folder_id)) !== undefined;
    // Always the Inbox of the origin account. The recorded origin folder can be a Gmail label view, which is no place to return to.
    const [destination] = await api.folders.query({ accountId: item.origin_account_id, specialUse: ["inbox"] });
    if (destination === undefined) {
        await retry_or_drop(api, item, timing, "A snoozed message did not return, because its account has no Inbox. It stays where it is.");
        return;
    }
    // Every copy moves: two messages with one Message-ID share one item.
    const waiting = (await waiting_copies(api, item, snoozed_folder_still_there)).filter((message) => message.folder?.id !== destination.id);
    if (waiting.length > 0) await api.messages.move(waiting.map((message) => message.id), destination.id);
    // The move gives the message a new id, so the unread mark needs a fresh lookup.
    const returned = await query_all(api, item.header_message_id, destination.id);
    if (returned.length === 0) {
        await retry_or_drop(api, item, timing, snoozed_folder_still_there ? "A snoozed message is no longer in the Snoozed folder, so it did not return." : "A snoozed message could not be found to return.");
        return;
    }
    for (const message of returned) await api.messages.update(message.id, { read: false });
    const subject = returned[0]?.subject;
    await notify_refusal(api, subject !== undefined && (await api.show_subject?.()) === true ? `Snoozed message returned: ${subject}` : "A snoozed message returned.");
}
