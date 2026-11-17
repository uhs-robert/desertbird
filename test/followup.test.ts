import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { followup_due_ms } from "../src/background/followup_presets.ts";
import { FOLLOWUP_RECORD_VERSION, FOLLOWUP_STORAGE_KEY, create_followup_store, migrate_followup_record } from "../src/background/followup_store.ts";
import type { FollowupItem } from "../src/background/followup_store.ts";
import { FOLLOWUP_START_GRACE_MS, cancel_followups, fire_followup, open_followup_anchor, past_start_grace, remind_messages } from "../src/background/handlers/followup.ts";
import type { FollowupApi, FollowupFireApi, FollowupOpenApi } from "../src/background/handlers/followup.ts";
import type { MessageHeader } from "../src/background/handlers/message.ts";
import { CATCH_UP_ALARM, create_scheduler } from "../src/background/scheduler.ts";
import { fake_alarms, fake_api, fake_storage } from "./fake_api.ts";
import { create_new_mail_notifier } from "../src/background/new_mail_notify.ts";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";

const NOW = new Date(2026, 10, 18, 10, 15);
const DAY = 24 * 60 * 60 * 1000;
const ANCHOR_DATE = new Date(2026, 10, 18, 9, 0);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

interface Stored {
    id: number;
    header: string;
    subject: string;
    folder_id: string;
    account_id: string;
    date: Date;
    tags: string[];
    headers: Record<string, string[]>;
    use?: string;
}

/** A small mailbox with the calls the follow-up handlers make. */
function mailbox(options: { storage?: Record<string, unknown>; header_failures?: number; page_size?: number } = {}) {
    const storage = fake_storage(options.storage ?? {});
    const store = create_followup_store({ storage: storage.api });
    const messages: Stored[] = [];
    const notices: { id: string | undefined; message: string }[] = [];
    const toast_kinds: { window_id: number; text: string; is_error: boolean }[] = [];
    const opened: number[] = [];
    const known_tags: { key: string; tag: string }[] = [];
    const created_tags: string[] = [];
    let header_failures = options.header_failures ?? 0;
    let next_id = 1;
    const lists = new Map<string, MessageHeader[][]>();
    const header_of = (message: Stored): MessageHeader => ({ id: message.id, date: message.date, headerMessageId: message.header, subject: message.subject, tags: message.tags, folder: { id: message.folder_id, accountId: message.account_id, specialUse: message.use === undefined ? [] : [message.use] } });
    const page_of = (matches: MessageHeader[]) => {
        const size = options.page_size ?? matches.length + 1;
        const pages: MessageHeader[][] = [];
        for (let start = 0; start < matches.length; start += size) pages.push(matches.slice(start, start + size));
        if (pages.length === 0) pages.push([]);
        const list_id = `list-${lists.size}`;
        lists.set(list_id, pages.slice(1));
        return { id: pages.length > 1 ? list_id : null, messages: pages[0]! };
    };
    const api = {
        messages: {
            query: async (query: { headerMessageId?: string; folderId?: string; accountId?: string; includeSubFolders?: boolean; fromDate?: Date }) =>
                page_of(messages.filter((message) => (query.accountId === undefined || message.account_id === query.accountId) && (query.headerMessageId === undefined || message.header === query.headerMessageId) && (query.folderId === undefined || message.folder_id === query.folderId || (query.includeSubFolders === true && message.folder_id.startsWith(`${query.folderId}-`))) && (query.fromDate === undefined || message.date >= query.fromDate)).map(header_of)),
            continueList: async (list_id: string) => {
                const [page = [], ...rest] = lists.get(list_id) ?? [];
                lists.set(list_id, rest);
                return { id: rest.length > 0 ? list_id : null, messages: page };
            },
            get: async (id: number) => {
                const found = messages.find((message) => message.id === id);
                if (found === undefined) throw new Error(`Message not found: ${id}.`);
                return header_of(found);
            },
            update: async (id: number, properties: { tags: string[] }) => void (messages.find((message) => message.id === id)!.tags = properties.tags),
            getHeaders: async (id: number) => {
                if (header_failures > 0) {
                    header_failures--;
                    throw new Error("the message is not available yet");
                }
                return messages.find((message) => message.id === id)!.headers;
            },
            tags: {
                list: async () => known_tags,
                create: async (key: string, tag: string) => void (created_tags.push(key), known_tags.push({ key, tag })),
            },
        },
        folders: {
            query: async (query: { accountId?: string; specialUse?: string[] }) => [
                { id: `${query.accountId}-inbox`, accountId: query.accountId!, path: "/INBOX", specialUse: ["inbox"] },
                { id: `${query.accountId}-archives`, accountId: query.accountId!, path: "/Archives", specialUse: ["archives"] },
            ].filter((folder) => query.specialUse?.some((use) => folder.specialUse.includes(use))),
        },
        followup: { items: store, now: () => NOW },
        notifications: { create: async (id: string | undefined, notification: { message: string }) => (notices.push({ id, message: notification.message }), "n") },
        // Answers false so the system notification still fires and `notices` stays complete.
        toasts: { toast: async (window_id: number, text: string, is_error: boolean) => (toast_kinds.push({ window_id, text, is_error }), false) },
        messageDisplay: { open: async (properties: { messageId: number }) => void opened.push(properties.messageId) },
    };
    const add = (header: string, extra: Partial<Stored> = {}) => {
        const message = { id: next_id++, header, subject: `Subject of ${header}`, folder_id: "imap-inbox", account_id: "imap", date: ANCHOR_DATE, tags: [], headers: {}, ...extra };
        messages.push(message);
        return message;
    };
    return { api: api as unknown as FollowupApi & FollowupFireApi & FollowupOpenApi & { notifications: { create: unknown } }, store, storage, messages, add, notices, toast_kinds, opened, created_tags };
}

const item_of = (header: string, due_ms = NOW.getTime() + DAY): FollowupItem => ({ header_message_id: header, account_id: "imap", anchor_date_ms: ANCHOR_DATE.getTime(), due_ms });
const remind = (box: ReturnType<typeof mailbox>, ids: number[], after = "one_day") => remind_messages({ api: box.api as never, window_id: 1, message_ids: ids, count: 1 }, { after });
const fire_due = (box: ReturnType<typeof mailbox>, now_ms: number, api: FollowupFireApi = box.api) => box.store.fire_due(now_ms, (item, still_wanted) => fire_followup(api, item, still_wanted));

test("due math: each preset is that many 24 hour days after now", () => {
    assert.equal(followup_due_ms("one_day", NOW), NOW.getTime() + DAY);
    assert.equal(followup_due_ms("three_days", NOW), NOW.getTime() + 3 * DAY);
    assert.equal(followup_due_ms("one_week", NOW), NOW.getTime() + 7 * DAY);
});

test("msg.remind stores the header id, the account, the anchor date and the due time", async () => {
    const box = mailbox();
    const anchor = box.add("<a@x>");
    await remind(box, [anchor.id], "three_days");
    assert.deepEqual(await box.store.list(), [item_of("<a@x>", NOW.getTime() + 3 * DAY)]);
    assert.match(box.notices[0]!.message, /^Reminder set for 1 message on /);
    assert.deepEqual([box.toast_kinds[0]!.window_id, box.toast_kinds[0]!.is_error], [1, false]);
});

test("msg.remind again replaces the earlier reminder, and a message without a Message-ID is refused", async () => {
    const box = mailbox();
    const anchor = box.add("<a@x>");
    await remind(box, [anchor.id], "one_day");
    await remind(box, [anchor.id], "one_week");
    assert.deepEqual((await box.store.list()).map((item) => item.due_ms), [NOW.getTime() + 7 * DAY]);
    const bare = box.add("");
    await assert.rejects(remind(box, [bare.id]), /no Message-ID/);
});

test("the registry checks the preset and takes no argument for the cancel", () => {
    const remind_command = registry.get("msg.remind")!;
    assert.equal(check_args(remind_command, { after: "one_day" }).ok, true);
    assert.equal(check_args(remind_command, { after: "two_days" }).ok, false);
    assert.equal(check_args(registry.get("msg.remind_cancel")!, {}).ok, true);
});

test("nothing fires before the due time", async () => {
    const box = mailbox();
    box.add("<a@x>");
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY - 1);
    assert.equal(box.notices.length, 0);
    assert.equal((await box.store.list()).length, 1);
});

test("reply absent: the due item notifies with the anchor id, tags the anchor, creates the tag once and leaves the store", async () => {
    const box = mailbox();
    const anchor = box.add("<a@x>", { tags: ["$label1"] });
    box.add("<other@x>", { date: new Date(2026, 10, 18, 9, 30), headers: { references: ["<unrelated@x>"] } });
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY);
    assert.deepEqual(box.notices, [{ id: `desertbird-followup:${JSON.stringify(["imap", "<a@x>"])}`, message: "No reply yet to a message you set a reminder for. Click to open it." }]);
    assert.deepEqual(box.messages.find((message) => message.id === anchor.id)!.tags, ["$label1", "desertbirdfollowup"]);
    assert.deepEqual(box.created_tags, ["desertbirdfollowup"]);
    assert.deepEqual(await box.store.list(), []);
});

test("reply seen: a later message whose References or In-Reply-To names the anchor cancels the reminder with no notice", async () => {
    for (const headers of [{ references: ["<root@x> <a@x>"] }, { "in-reply-to": ["<a@x>"] }]) {
        const box = mailbox();
        const anchor = box.add("<a@x>");
        box.add("<reply@x>", { date: new Date(2026, 10, 18, 9, 30), headers });
        await box.store.add(item_of("<a@x>"));
        await fire_due(box, NOW.getTime() + DAY);
        assert.deepEqual(box.notices, []);
        assert.deepEqual(box.messages.find((message) => message.id === anchor.id)!.tags, []);
        assert.deepEqual(await box.store.list(), []);
    }
});

test("a message that names the anchor but is not newer than it is no reply", async () => {
    const box = mailbox();
    box.add("<a@x>");
    box.add("<old@x>", { date: new Date(2026, 10, 18, 8, 0), headers: { references: ["<a@x>"] } });
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY);
    assert.equal(box.notices.length, 1);
});

test("the reply check reads every page of the newer messages", async () => {
    const box = mailbox({ page_size: 2 });
    box.add("<a@x>");
    for (let index = 0; index < 4; index++) box.add(`<n${index}@x>`, { date: new Date(2026, 10, 18, 9, 10 + index) });
    box.add("<reply@x>", { date: new Date(2026, 10, 18, 9, 40), headers: { references: ["<a@x>"] } });
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY);
    assert.deepEqual(box.notices, []);
});

test("a reply that arrived while Thunderbird was closed is found at the first run after start", async () => {
    const data: Record<string, unknown> = {};
    const first = mailbox({ storage: data });
    first.add("<a@x>");
    await remind(first, [1]);
    assert.equal((data[FOLLOWUP_STORAGE_KEY] as { items: unknown[] }).items.length, 1);
    // Closed: the reply lands, and the due time passes. The next start reads the stored item.
    const second = mailbox({ storage: data });
    second.add("<a@x>");
    second.add("<reply@x>", { date: new Date(2026, 10, 18, 12, 0), headers: { "in-reply-to": ["<a@x>"] } });
    await fire_due(second, NOW.getTime() + 3 * DAY);
    assert.deepEqual(second.notices, []);
    assert.deepEqual(await second.store.list(), []);
});

test("restart rebuild: an item stored before the restart is read after the restart, and the alarm is created again", async () => {
    const data: Record<string, unknown> = {};
    const alarms = fake_alarms();
    const first = mailbox({ storage: data });
    first.add("<a@x>");
    await remind(first, [1]);
    alarms.restart();
    const second = mailbox({ storage: data });
    second.add("<a@x>");
    let clock = NOW.getTime() + DAY + 5000;
    const scheduler = create_scheduler({ alarms: alarms.api }, () => clock);
    scheduler.on_due((now_ms) => second.store.fire_due(now_ms, (item, still_wanted) => fire_followup(second.api, item, still_wanted)));
    await scheduler.start();
    assert.deepEqual(alarms.names(), [CATCH_UP_ALARM]);
    assert.equal(second.notices.length, 1);
    clock += 60_000;
    alarms.fire(CATCH_UP_ALARM);
    await settle();
    assert.equal(second.notices.length, 1);
});

test("anchor deleted: the item is dropped with no notice", async () => {
    const box = mailbox();
    await box.store.add(item_of("<gone@x>"));
    await fire_due(box, NOW.getTime() + DAY);
    assert.deepEqual(box.notices, []);
    assert.deepEqual(await box.store.list(), []);
});

test("the due notice names the subject only when the setting is on", async () => {
    const box = mailbox();
    box.add("<a@x>");
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY, { ...box.api, show_subject: async () => true });
    assert.equal(box.notices.at(-1)?.message, "No reply yet: Subject of <a@x>");
});

test("a failed tag still notifies, and a failed notification keeps the item", async () => {
    const box = mailbox();
    box.add("<a@x>");
    await box.store.add(item_of("<a@x>"));
    const broken_tags = { ...box.api, messages: { ...box.api.messages, tags: { list: async () => { throw new Error("no tag list"); }, create: async () => {} } } };
    const silence = console.error;
    console.error = () => {};
    try {
        await fire_due(box, NOW.getTime() + DAY, broken_tags as never);
        assert.equal(box.notices.length, 1);
        assert.deepEqual(await box.store.list(), []);
        await box.store.add(item_of("<a@x>"));
        const broken_notice = { ...box.api, notifications: { create: async () => { throw new Error("no notifications"); } } };
        await fire_due(box, NOW.getTime() + DAY, broken_notice as never);
    } finally {
        console.error = silence;
    }
    assert.equal((await box.store.list()).length, 1);
});

test("cancel racing a due fire: a cancel during the reply check wins and nothing is shown", async () => {
    const box = mailbox();
    box.add("<a@x>");
    box.add("<n@x>", { date: new Date(2026, 10, 18, 9, 30) });
    await box.store.add(item_of("<a@x>"));
    const slow = { ...box.api, messages: { ...box.api.messages, getHeaders: async (id: number) => {
        await box.store.remove("<a@x>", "imap");
        return box.api.messages.getHeaders(id);
    } } };
    await fire_due(box, NOW.getTime() + DAY, slow as never);
    assert.deepEqual(box.notices, []);
    assert.deepEqual(await box.store.list(), []);
});

test("a reminder set again while the old one fires survives the old one's removal", async () => {
    const box = mailbox();
    box.add("<a@x>");
    await box.store.add(item_of("<a@x>"));
    const renewed = item_of("<a@x>", NOW.getTime() + 7 * DAY);
    const slow = { ...box.api, messages: { ...box.api.messages, getHeaders: async (id: number) => {
        await box.store.add(renewed);
        return box.api.messages.getHeaders(id);
    } } };
    box.add("<n@x>", { date: new Date(2026, 10, 18, 9, 30) });
    await fire_due(box, NOW.getTime() + DAY, slow as never);
    assert.deepEqual(box.notices, []);
    assert.deepEqual(await box.store.list(), [renewed]);
});

test("two ticks at once fire an item once", async () => {
    const box = mailbox();
    box.add("<a@x>");
    await box.store.add(item_of("<a@x>"));
    await Promise.all([fire_due(box, NOW.getTime() + DAY), fire_due(box, NOW.getTime() + DAY)]);
    assert.equal(box.notices.length, 1);
});

test("msg.remind_cancel drops the pending item and the tag, and says so when nothing was pending", async () => {
    const box = mailbox();
    const anchor = box.add("<a@x>", { tags: ["desertbirdfollowup", "$label1"] });
    await remind(box, [anchor.id]);
    await cancel_followups({ api: box.api as never, window_id: 1, message_ids: [anchor.id], count: 1 });
    assert.deepEqual(await box.store.list(), []);
    assert.deepEqual(box.messages[0]!.tags, ["$label1"]);
    assert.equal(box.notices.at(-1)!.message, "Cancelled 1 reminder.");
    assert.deepEqual([box.toast_kinds.at(-1)!.window_id, box.toast_kinds.at(-1)!.is_error], [1, false]);
    await cancel_followups({ api: box.api as never, window_id: 1, message_ids: [anchor.id], count: 1 });
    assert.equal(box.notices.at(-1)!.message, "No pending reminder on the selected messages.");
    assert.deepEqual([box.toast_kinds.at(-1)!.window_id, box.toast_kinds.at(-1)!.is_error], [1, true]);
});

test("a click on the notification opens the anchor, and other notifications are ignored", async () => {
    const box = mailbox();
    const anchor = box.add("<a@x>");
    await open_followup_anchor(box.api, `desertbird-followup:${JSON.stringify(["imap", "<a@x>"])}`);
    await open_followup_anchor(box.api, "something-else");
    await open_followup_anchor(box.api, `desertbird-followup:${JSON.stringify(["imap", "<gone@x>"])}`);
    assert.deepEqual(box.opened, [anchor.id]);
});

test("store migration: a current record reads, a newer or malformed one reads as empty, and invalid items are dropped", async () => {
    const good = item_of("<a@x>");
    assert.deepEqual(migrate_followup_record({ record_version: FOLLOWUP_RECORD_VERSION, items: [good, { header_message_id: 5 }, null] }), { record_version: FOLLOWUP_RECORD_VERSION, items: [good] });
    assert.equal(migrate_followup_record({ record_version: FOLLOWUP_RECORD_VERSION + 1, items: [good] }), undefined);
    assert.equal(migrate_followup_record({ items: [good] }), undefined);
    assert.equal(migrate_followup_record(undefined), undefined);
    const box = mailbox({ storage: { [FOLLOWUP_STORAGE_KEY]: { record_version: 99, items: [good] } } });
    assert.deepEqual(await box.store.list(), []);
});

test("the fake API wires msg.remind through the router shape", async () => {
    const { api } = fake_api();
    await api.followup.items.add(item_of("<a@x>"));
    assert.equal((await api.followup.items.remove("<a@x>", "imap")), true);
});

test("an anchor in Trash or Junk counts as deleted: the item is dropped with no notice", async () => {
    for (const use of ["trash", "junk"]) {
        const box = mailbox();
        const anchor = box.add("<a@x>", { use, folder_id: `imap-${use}` });
        await box.store.add(item_of("<a@x>"));
        await fire_due(box, NOW.getTime() + DAY);
        assert.deepEqual(box.notices, []);
        assert.deepEqual(box.messages.find((message) => message.id === anchor.id)!.tags, []);
        assert.deepEqual(await box.store.list(), []);
    }
});

test("a reply the user archived counts, and a copy of the anchor in Trash does not hide the live one", async () => {
    const box = mailbox();
    box.add("<a@x>", { use: "trash", folder_id: "imap-trash" });
    box.add("<a@x>");
    box.add("<reply@x>", { date: new Date(2026, 10, 18, 9, 30), folder_id: "imap-archives", headers: { references: ["<a@x>"] } });
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY);
    assert.deepEqual(box.notices, []);
});

test("the anchor lookup names the account first, and a message that left the account is still found", async () => {
    const box = mailbox();
    box.add("<a@x>", { account_id: "other", folder_id: "other-inbox" });
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY);
    assert.equal(box.notices.length, 1);
});

test("a header that cannot be read is skipped, and the rest of the check still finds the reply", async () => {
    const box = mailbox({ header_failures: 1 });
    box.add("<a@x>");
    box.add("<unreadable@x>", { date: new Date(2026, 10, 18, 9, 20) });
    box.add("<reply@x>", { date: new Date(2026, 10, 18, 9, 30), headers: { references: ["<a@x>"] } });
    await box.store.add(item_of("<a@x>"));
    const silence = console.error;
    console.error = () => {};
    try {
        await fire_due(box, NOW.getTime() + DAY);
    } finally {
        console.error = silence;
    }
    assert.deepEqual(box.notices, []);
    assert.deepEqual(await box.store.list(), []);
});

test("a cancel during the tagging clears the tag the fire added and shows nothing", async () => {
    const box = mailbox();
    const anchor = box.add("<a@x>");
    await box.store.add(item_of("<a@x>"));
    const slow = { ...box.api, messages: { ...box.api.messages, tags: { list: async () => {
        await box.store.remove("<a@x>", "imap");
        return [];
    }, create: async () => {} } } };
    await fire_due(box, NOW.getTime() + DAY, slow as never);
    assert.deepEqual(box.notices, []);
    assert.deepEqual(box.messages.find((message) => message.id === anchor.id)!.tags, []);
});

test("start grace: a reply that appears during the grace is seen, and nothing fires before the grace is over", async () => {
    const alarms = fake_alarms();
    const box = mailbox();
    box.add("<a@x>");
    await box.store.add(item_of("<a@x>"));
    const started_ms = NOW.getTime() + 2 * DAY;
    let clock = started_ms;
    const scheduler = create_scheduler({ alarms: alarms.api }, () => clock);
    // The wiring of main.ts.
    scheduler.on_due((now_ms) => (past_start_grace(started_ms, now_ms) ? box.store.fire_due(now_ms, (item, still_wanted) => fire_followup(box.api, item, still_wanted)) : undefined));
    await scheduler.start();
    assert.equal(box.notices.length, 0);
    assert.equal((await box.store.list()).length, 1);
    // The folders sync and the reply lands during the grace.
    box.add("<reply@x>", { date: new Date(2026, 10, 19, 12, 0), headers: { "in-reply-to": ["<a@x>"] } });
    clock = started_ms + 60_000;
    alarms.fire(CATCH_UP_ALARM);
    await settle();
    assert.equal((await box.store.list()).length, 1);
    clock = started_ms + FOLLOWUP_START_GRACE_MS;
    alarms.fire(CATCH_UP_ALARM);
    await settle();
    assert.deepEqual(box.notices, []);
    assert.deepEqual(await box.store.list(), []);
});

test("a reply archived into a year subfolder of Archives cancels the reminder", async () => {
    const box = mailbox();
    box.add("<a@x>");
    box.add("<reply@x>", { date: new Date(2026, 10, 18, 9, 30), folder_id: "imap-archives-2026", headers: { references: ["<a@x>"] } });
    await box.store.add(item_of("<a@x>"));
    await fire_due(box, NOW.getTime() + DAY);
    assert.deepEqual(box.notices, []);
});

test("a click on a follow-up notice and a click on a new-mail notice each open only their own message", async () => {
    const box = mailbox();
    const anchor = box.add("<a@x>");
    const created: string[] = [];
    const clicked: ((id: string) => void)[] = [];
    const new_mail: ((folder: { specialUse: string[] }, list: { messages: { id: number; subject: string }[] }) => void)[] = [];
    const opened: number[] = [];
    const known_new_mail_ids = [900];
    const shared_notifications = {
        create: async (id: string | undefined, notification: unknown) => (created.push(id!), box.api.notifications.create(id as never, notification as never)),
        clear: async () => true,
        onClicked: { addListener: (listener: (id: string) => void) => void clicked.push(listener) },
        onClosed: { addListener: () => {} },
    };
    const open = async ({ messageId }: { messageId: number }) => void opened.push(messageId);
    create_new_mail_notifier(
        {
            messages: { get: async (id: number) => (known_new_mail_ids.includes(id) ? { id } : Promise.reject(new Error("gone"))), onNewMailReceived: { addListener: (listener) => void new_mail.push(listener as never) } },
            messageDisplay: { open },
            notifications: shared_notifications,
            storage: { onChanged: { addListener: () => {} } },
        },
        async () => true,
    ).register();
    // The wiring of main.ts: the follow-up click handler is its own listener.
    clicked.push((id) => void open_followup_anchor({ messages: box.api.messages, messageDisplay: { open } }, id));
    new_mail.forEach((listener) => listener({ specialUse: ["inbox"] }, { messages: [{ id: 900, subject: "new" }] }));
    await settle();
    await box.store.add(item_of("<a@x>"));
    await box.store.fire_due(NOW.getTime() + DAY, (item, still_wanted) => fire_followup({ ...box.api, notifications: shared_notifications } as never, item, still_wanted));
    const [new_mail_id, followup_id] = created as [string, string];
    assert.match(new_mail_id, /^desertbird-new-mail-/);
    assert.match(followup_id, /^desertbird-followup:/);
    clicked.forEach((listener) => listener(followup_id));
    await settle();
    assert.deepEqual(opened, [anchor.id]);
    clicked.forEach((listener) => listener(new_mail_id));
    await settle();
    assert.deepEqual(opened, [anchor.id, 900]);
});
