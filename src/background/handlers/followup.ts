import { RuntimeRefusal } from "../../../vendor/desertfox/command.ts";
import type { CheckedArgs } from "../../../vendor/desertfox/command.ts";
import { for_each_message } from "./each_message.ts";
import type { HandlerScope, MailTag, MessageHeader } from "./message.ts";
import { query_all } from "./message_query.ts";
import type { MessageQueryApi } from "./message_query.ts";
import type { SpecialFolderApi, SpecialUse } from "./special_folder.ts";
import { followup_due_ms } from "../followup_presets.ts";
import type { FollowupPreset } from "../followup_presets.ts";
import type { FollowupItem, FollowupStore, StillWanted } from "../followup_store.ts";
import { notify_refusal, notify_result } from "../notify.ts";
import type { NotificationsApi } from "../notify.ts";

export const FOLLOWUP_TAG_KEY = "desertbirdfollowup";
export const FOLLOWUP_TAG_NAME = "Follow up";
const FOLLOWUP_TAG_COLOR = "#e8590c";
/** The notification id carries the anchor, so a click after a restart still finds it and no map lives in memory. */
const NOTIFICATION_PREFIX = "desertbird-followup:";
/** Folders whose messages the user threw away. An anchor there counts as deleted. */
const DISCARD_FOLDER_USES: string[] = ["trash", "junk"];
/** The reply check also reads these folders, since a reply the user archived is still a reply. */
const REPLY_FOLDER_USES: SpecialUse[] = ["inbox", "archives"];
/** After a start the folders have not synced yet, so a reply that came while Thunderbird was closed is not in them. The follow-up listener waits this long. */
export const FOLLOWUP_START_GRACE_MS = 5 * 60 * 1000;

/** True once the grace after the background start is over. */
export const past_start_grace = (started_ms: number, now_ms: number) => now_ms - started_ms >= FOLLOWUP_START_GRACE_MS;

interface FollowupMessagesApi extends MessageQueryApi {
    get(id: number): Promise<MessageHeader>;
    update(id: number, properties: { tags: string[] }): Promise<void>;
    /** Header names are lower case. */
    getHeaders(id: number): Promise<Record<string, string[]>>;
    tags: { list(): Promise<MailTag[]>; create(key: string, tag: string, color: string): Promise<void> };
}

/** What `msg.remind` and `msg.remind_cancel` need, beyond the notification call. */
export interface FollowupApi {
    messages: FollowupMessagesApi;
    followup: { items: Pick<FollowupStore, "add" | "remove">; now(): Date };
}

/** What the due run and the notification click need. */
export interface FollowupFireApi extends NotificationsApi, SpecialFolderApi {
    /** Reads the `notice_show_subject` setting. Absent means the subject stays out. */
    show_subject?: () => Promise<boolean>;
    messages: FollowupMessagesApi;
}

export interface FollowupOpenApi {
    messages: Pick<FollowupMessagesApi, "query" | "continueList">;
    messageDisplay: { open(properties: { messageId: number; location: "tab" }): Promise<unknown> };
}

// Local on purpose: it moves to `notify.ts` when that file takes an id and a click.
async function raise_notification(api: NotificationsApi, id: string, message: string): Promise<void> {
    await api.notifications.create(id, { type: "basic", title: "DesertBird", message });
}

const header_ids_of = (value: string[] | undefined) => (value ?? []).flatMap((line) => line.split(/\s+/)).map((token) => token.replace(/^<|>$/g, "")).filter((token) => token !== "");
const bare = (header_message_id: string) => header_message_id.replace(/^<|>$/g, "");

export async function remind_messages(scope: HandlerScope<FollowupApi & NotificationsApi>, args: CheckedArgs): Promise<void> {
    const { api } = scope;
    const due_ms = followup_due_ms(String(args["after"]) as FollowupPreset, api.followup.now());
    await for_each_message(scope.message_ids, async (id) => {
        const message = await api.messages.get(id);
        const header_message_id = message.headerMessageId;
        const account_id = message.folder?.accountId;
        if (header_message_id === undefined || header_message_id === "" || account_id === undefined) throw new RuntimeRefusal("This message has no Message-ID header, so a reminder cannot find it again.");
        await api.followup.items.add({ header_message_id, account_id, anchor_date_ms: message.date.getTime(), due_ms });
    });
    const count = scope.message_ids.length;
    await notify_result(api, `Reminder set for ${count} message${count === 1 ? "" : "s"} on ${new Date(due_ms).toLocaleString()}, unless a reply arrives first.`, scope.window_id);
}

export async function cancel_followups(scope: HandlerScope<FollowupApi & NotificationsApi>): Promise<void> {
    const { api } = scope;
    let cancelled = 0;
    await for_each_message(scope.message_ids, async (id) => {
        const message = await api.messages.get(id);
        const account_id = message.folder?.accountId;
        if (message.headerMessageId !== undefined && account_id !== undefined && (await api.followup.items.remove(message.headerMessageId, account_id))) cancelled++;
        // The tag from an earlier fire goes too, so a cancel leaves the message clean.
        const tags = message.tags ?? [];
        if (tags.includes(FOLLOWUP_TAG_KEY)) await api.messages.update(id, { tags: tags.filter((key) => key !== FOLLOWUP_TAG_KEY) });
    });
    if (cancelled === 0) await notify_refusal(api, "No pending reminder on the selected messages.", scope.window_id);
    else await notify_result(api, `Cancelled ${cancelled} reminder${cancelled === 1 ? "" : "s"}.`, scope.window_id);
}

async function find_anchor(api: FollowupFireApi, item: FollowupItem): Promise<MessageHeader | undefined> {
    const own = await query_all(api.messages, { headerMessageId: item.header_message_id, accountId: item.account_id, autoPaginationTimeout: 0 });
    // The account is searched first, since an open query reads every folder of every account. A message that moved accounts is found by the open query.
    const found = own.length > 0 ? own : await query_all(api.messages, { headerMessageId: item.header_message_id, autoPaginationTimeout: 0 });
    return found.find((message) => !message.folder?.specialUse?.some((use) => DISCARD_FOLDER_USES.includes(use)));
}

// A reply arrives in the Inbox of the anchor's account, and the user may have archived it since. The folder of the anchor stands in when the account has neither.
async function reply_folder_ids(api: FollowupFireApi, item: FollowupItem, anchor: MessageHeader): Promise<string[]> {
    const folders = await api.folders.query({ accountId: item.account_id, specialUse: REPLY_FOLDER_USES });
    const ids = [...new Set(folders.map((folder) => folder.id))];
    return ids.length > 0 || anchor.folder?.id === undefined ? ids : [anchor.folder.id];
}

/** True when a message newer than the anchor names it in `References` or `In-Reply-To`. Only newer messages are read, so a closed Thunderbird loses no reply once its folders have synced. A message whose headers cannot be read is skipped, so one failure does not repeat the whole scan every minute. */
async function has_reply(api: FollowupFireApi, item: FollowupItem, anchor: MessageHeader): Promise<boolean> {
    const anchor_id = bare(item.header_message_id);
    for (const folder_id of await reply_folder_ids(api, item, anchor)) {
        const newer = (await query_all(api.messages, { folderId: folder_id, includeSubFolders: true, fromDate: new Date(item.anchor_date_ms), autoPaginationTimeout: 0 })).filter((message) => message.id !== anchor.id && message.date.getTime() > item.anchor_date_ms);
        for (const candidate of newer) {
            const headers = await api.messages.getHeaders(candidate.id).catch((error: unknown) => (console.error("desertbird follow-up headers:", error), {}) as Record<string, string[]>);
            if ([...header_ids_of(headers["references"]), ...header_ids_of(headers["in-reply-to"])].includes(anchor_id)) return true;
        }
    }
    return false;
}

async function tag_anchor(api: FollowupFireApi, anchor: MessageHeader): Promise<void> {
    const known = (await api.messages.tags.list()).find((entry) => entry.key === FOLLOWUP_TAG_KEY);
    if (known === undefined) await api.messages.tags.create(FOLLOWUP_TAG_KEY, FOLLOWUP_TAG_NAME, FOLLOWUP_TAG_COLOR);
    // `messages.update` replaces the whole tag list, so the message keeps its own tags.
    const { tags = [] } = await api.messages.get(anchor.id);
    if (!tags.includes(FOLLOWUP_TAG_KEY)) await api.messages.update(anchor.id, { tags: [...tags, FOLLOWUP_TAG_KEY] });
}

// Runs at each tick for an item that came due, and is safe to repeat. A thrown error keeps the item for the next tick. An item is dropped without a notice when its anchor is gone (deleted, or in Trash or Junk) or a reply came. The notification is the last step, so a failed tag never repeats a notice that was shown.
export async function fire_followup(api: FollowupFireApi, item: FollowupItem, still_wanted: StillWanted): Promise<void> {
    const anchor = await find_anchor(api, item);
    if (anchor === undefined || (await has_reply(api, item, anchor))) return;
    // A cancel that lands during the check or the tagging wins, so it is asked again before each visible effect.
    if (!(await still_wanted())) return;
    await tag_anchor(api, anchor).catch((error) => console.error("desertbird follow-up tag:", error));
    if (!(await still_wanted())) {
        // The cancel found no tag to clear, so the fire clears its own.
        const { tags = [] } = await api.messages.get(anchor.id);
        await api.messages.update(anchor.id, { tags: tags.filter((key) => key !== FOLLOWUP_TAG_KEY) });
        return;
    }
    await raise_notification(api, NOTIFICATION_PREFIX + JSON.stringify([item.account_id, item.header_message_id]), (await api.show_subject?.()) === true ? `No reply yet: ${anchor.subject ?? item.header_message_id}` : "No reply yet to a message you set a reminder for. Click to open it.");
}

/** Opens the anchor of a clicked follow-up notification. Any other notification is ignored. */
export async function open_followup_anchor(api: FollowupOpenApi, notification_id: string): Promise<void> {
    if (!notification_id.startsWith(NOTIFICATION_PREFIX)) return;
    const [account_id, header_message_id] = JSON.parse(notification_id.slice(NOTIFICATION_PREFIX.length)) as [string, string];
    const [anchor] = await query_all(api.messages, { headerMessageId: header_message_id, accountId: account_id, autoPaginationTimeout: 0 });
    if (anchor !== undefined) await api.messageDisplay.open({ messageId: anchor.id, location: "tab" });
}
