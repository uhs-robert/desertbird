import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import type { MessageHeader } from "../src/background/handlers/message.ts";
import { snooze_messages, wake_snoozed } from "../src/background/handlers/snooze.ts";
import type { SnoozeApi, WakeApi } from "../src/background/handlers/snooze.ts";
import { CATCH_UP_ALARM, create_scheduler } from "../src/background/scheduler.ts";
import { create_snooze_store } from "../src/background/snooze_store.ts";
import { create_router } from "../src/background/router.ts";
import { fake_alarms, fake_api, fake_storage } from "./fake_api.ts";

const NOW = new Date(2026, 10, 18, 10, 15);
const MINUTE = 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

interface StoredMessage {
    id: number;
    header: string;
    subject: string;
    folder_id: string;
    read: boolean;
}

/** A small mailbox that keeps what the real API does: a move gives the message a new id and puts it in the target folder. */
function mailbox(options: { cannot_create_in?: string[]; write_delay_ms?: number; move_failures?: number } = {}) {
    const storage = fake_storage({}, options.write_delay_ms ?? 0);
    const store = create_snooze_store({ storage: storage.api });
    const folders: (MailFolder & { isRoot?: boolean })[] = [
        { id: "imap-root", accountId: "imap", path: "/", isRoot: true },
        { id: "imap-inbox", accountId: "imap", path: "/INBOX", specialUse: ["inbox"] },
        { id: "local-root", accountId: "local", path: "/", isRoot: true },
        { id: "local-inbox", accountId: "local", path: "/Inbox", specialUse: ["inbox"] },
    ];
    const messages: StoredMessage[] = [];
    const log: string[] = [];
    const notices: string[] = [];
    let next_id = 100;
    const header_of = (message: StoredMessage): MessageHeader => {
        const folder = folders.find((candidate) => candidate.id === message.folder_id)!;
        return { id: message.id, date: new Date(0), read: message.read, headerMessageId: message.header, subject: message.subject, folder: { id: folder.id, accountId: folder.accountId, path: folder.path } };
    };
    const api = {
        messages: {
            get: async (id: number) => {
                const found = messages.find((message) => message.id === id);
                if (found === undefined) throw new Error(`Message not found: ${id}.`);
                return header_of(found);
            },
            move: async (ids: number[], folder_id: string) => {
                for (const id of ids) {
                    const found = messages.find((message) => message.id === id)!;
                    log.push(`move ${found.header} ${found.folder_id} -> ${folder_id}`);
                    found.id = next_id++;
                    found.folder_id = folder_id;
                }
            },
            query: async (query: { headerMessageId: string }) => ({ messages: messages.filter((message) => message.header === query.headerMessageId).map(header_of) }),
            update: async (id: number, properties: { read: boolean }) => void (messages.find((message) => message.id === id)!.read = properties.read),
        },
        folders: {
            query: async (query: { accountId?: string; path?: string; isRoot?: boolean; specialUse?: string[] }) =>
                folders.filter((folder) => (query.accountId === undefined || folder.accountId === query.accountId) && (query.path === undefined || folder.path === query.path) && (query.isRoot === undefined || folder.isRoot === query.isRoot) && (query.specialUse === undefined || query.specialUse.some((use) => folder.specialUse?.includes(use)))),
            create: async (parent_id: string, name: string) => {
                const parent = folders.find((folder) => folder.id === parent_id)!;
                log.push(`create ${parent.accountId} ${name}`);
                if (options.cannot_create_in?.includes(parent.accountId)) throw new Error("This account cannot create folders.");
                const created = { id: `${parent.accountId}-${name}`, accountId: parent.accountId, path: `/${name}` };
                folders.push(created);
                return created;
            },
        },
        accounts: { list: async () => [{ id: "imap", type: "imap" }, { id: "local", type: "none" }] },
        snooze: { items: store, now: () => NOW },
        notifications: { create: async (_id: string | undefined, notification: { message: string }) => (notices.push(notification.message), "n") },
    };
    const add = (header: string, folder_id = "imap-inbox") => {
        const message = { id: next_id++, header, subject: `Subject of ${header}`, folder_id, read: true };
        messages.push(message);
        return message;
    };
    const where = (header: string) => messages.filter((message) => message.header === header).map((message) => message.folder_id);
    return { api: api as unknown as SnoozeApi & WakeApi, store, storage, messages, add, where, log, notices };
}

const snooze = (box: ReturnType<typeof mailbox>, ids: number[], until = "tomorrow") => snooze_messages({ api: box.api, window_id: 1, message_ids: ids, count: 1 }, { until });
const tomorrow_8 = new Date(2026, 10, 19, 8).getTime();

test("a snooze creates the Snoozed folder in the message's account, moves the message and stores the header id and the account", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed"]);
    assert.deepEqual(box.log, ["create imap Snoozed", "move <a@x> imap-inbox -> imap-Snoozed"]);
    assert.deepEqual(await box.store.list(), [{ header_message_id: "<a@x>", origin_account_id: "imap", due_ms: tomorrow_8 }]);
    assert.match(box.notices[0]!, /^Snoozed 1 message until /);
});

test("the second snooze reuses the folder and a selection snoozes every message", async () => {
    const box = mailbox();
    const first = box.add("<a@x>");
    await snooze(box, [first.id]);
    const others = [box.add("<b@x>"), box.add("<c@x>")];
    await snooze(box, others.map((message) => message.id), "monday");
    assert.equal(box.log.filter((line) => line.startsWith("create")).length, 1);
    assert.deepEqual((await box.store.list()).map((item) => item.header_message_id), ["<a@x>", "<b@x>", "<c@x>"]);
});

test("an account that cannot create the folder falls back to Local Folders and keeps the origin account", async () => {
    const box = mailbox({ cannot_create_in: ["imap"] });
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    assert.deepEqual(box.where("<a@x>"), ["local-Snoozed"]);
    assert.equal((await box.store.list())[0]?.origin_account_id, "imap");
});

test("when Local Folders cannot create the folder either, the snooze fails and stores nothing", async () => {
    const box = mailbox({ cannot_create_in: ["imap", "local"] });
    const message = box.add("<a@x>");
    await assert.rejects(snooze(box, [message.id]), /cannot create folders/);
    assert.deepEqual(await box.store.list(), []);
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
});

test("a message with no Message-ID header is refused and stays where it is", async () => {
    const box = mailbox();
    const message = box.add("");
    await assert.rejects(snooze(box, [message.id]), /no Message-ID/);
    assert.deepEqual(box.where(""), ["imap-inbox"]);
});

test("snoozing from the Snoozed folder changes only the time and keeps the origin account", async () => {
    const box = mailbox({ cannot_create_in: ["imap"] });
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const waiting = box.messages[0]!;
    await snooze(box, [waiting.id], "monday");
    assert.deepEqual(box.where("<a@x>"), ["local-Snoozed"]);
    const items = await box.store.list();
    assert.equal(items.length, 1);
    assert.equal(items[0]?.origin_account_id, "imap");
    assert.equal(items[0]?.due_ms, new Date(2026, 10, 23, 8).getTime());
});

test("two snoozes at once on slow storage lose no item", async () => {
    const box = mailbox({ write_delay_ms: 15 });
    const one = box.add("<a@x>");
    const two = box.add("<b@x>");
    await Promise.all([snooze(box, [one.id]), snooze(box, [two.id], "weekend")]);
    assert.deepEqual((await box.store.list()).map((item) => item.header_message_id).sort(), ["<a@x>", "<b@x>"]);
});

test("a wake returns the message to the origin account's Inbox as unread, notifies and drops the item", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.notices.length = 0;
    await box.store.wake_due(tomorrow_8, (item) => wake_snoozed(box.api, item));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
    assert.equal(box.messages[0]?.read, false);
    assert.deepEqual(await box.store.list(), []);
    assert.deepEqual(box.notices, ["Snoozed message back in the Inbox: Subject of <a@x>"]);
});

test("a wake from the Local Folders fallback returns the message to the origin account", async () => {
    const box = mailbox({ cannot_create_in: ["imap"] });
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    await box.store.wake_due(tomorrow_8, (item) => wake_snoozed(box.api, item));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
});

test("a message gone at wake time is dropped with a notification and nothing moves", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.messages.length = 0;
    box.notices.length = 0;
    box.log.length = 0;
    await box.store.wake_due(tomorrow_8, (item) => wake_snoozed(box.api, item));
    assert.deepEqual(box.notices, ["A snoozed message is gone, so it did not return."]);
    assert.deepEqual(box.log, []);
    assert.deepEqual(await box.store.list(), []);
});

test("a failed move keeps the item, the next tick retries, and the message returns once", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const original_error = console.error;
    console.error = () => {};
    let failures = 1;
    const flaky: WakeApi = { ...box.api, messages: { ...box.api.messages, move: async (ids, folder_id) => (failures-- > 0 ? Promise.reject(new Error("offline")) : box.api.messages.move(ids, folder_id)) } };
    try {
        await box.store.wake_due(tomorrow_8, (item) => wake_snoozed(flaky, item));
    } finally {
        console.error = original_error;
    }
    assert.equal((await box.store.list()).length, 1);
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed"]);
    await box.store.wake_due(tomorrow_8 + MINUTE, (item) => wake_snoozed(flaky, item));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
    assert.deepEqual(await box.store.list(), []);
});

test("a repeat of a wake that already moved the message only marks it unread and notifies", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const [item] = await box.store.list();
    await wake_snoozed(box.api, item!);
    box.messages[0]!.read = true;
    box.log.length = 0;
    await wake_snoozed(box.api, item!);
    assert.deepEqual(box.log, []);
    assert.equal(box.messages[0]?.read, false);
});

test("an account with no Inbox keeps the message in Snoozed and drops the item with a notification", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const [item] = await box.store.list();
    box.notices.length = 0;
    await wake_snoozed(box.api, { ...item!, origin_account_id: "removed" });
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed"]);
    assert.match(box.notices[0]!, /no Inbox/);
});

/** One background run wired as main.ts does it: the listener is added before start. */
function boot(box: ReturnType<typeof mailbox>, clock: { now: number }) {
    const alarms = fake_alarms();
    const scheduler = create_scheduler({ alarms: alarms.api }, () => clock.now);
    const store = create_snooze_store({ storage: box.storage.api });
    scheduler.on_due((now_ms) => store.wake_due(now_ms, (item) => wake_snoozed(box.api, item)));
    return { alarms, scheduler };
}

test("restart: a snooze stored before the restart wakes on its alarm tick after Thunderbird starts again", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const clock = { now: NOW.getTime() };
    const first = boot(box, clock);
    await first.scheduler.start();
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed"]);
    first.alarms.restart();
    const second = boot(box, clock);
    await second.scheduler.start();
    assert.deepEqual(second.alarms.names(), [CATCH_UP_ALARM]);
    clock.now = tomorrow_8 + MINUTE;
    second.alarms.fire(CATCH_UP_ALARM);
    await settle();
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
});

test("overdue on start: a snooze that came due while Thunderbird was closed wakes at the next start", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const { scheduler } = boot(box, { now: tomorrow_8 + 3 * 60 * MINUTE });
    await scheduler.start();
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
    assert.equal(box.messages[0]?.read, false);
});

test("a tick during start does not wake the message twice", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.log.length = 0;
    const { scheduler, alarms } = boot(box, { now: tomorrow_8 + MINUTE });
    const started = scheduler.start();
    alarms.fire(CATCH_UP_ALARM);
    alarms.fire(CATCH_UP_ALARM);
    await started;
    await settle();
    assert.deepEqual(box.log, ["move <a@x> imap-Snoozed -> imap-inbox"]);
    assert.equal(box.notices.filter((notice) => notice.startsWith("Snoozed message back")).length, 1);
});

test("msg.snooze is registered with its four presets, runs in the background and is not bridge safe", async () => {
    const command = registry.get("msg.snooze");
    assert.equal(command?.runs_in, "background");
    assert.equal(command?.bridge, false);
    const { api, calls } = fake_api({ messages: [{ id: 1, headerMessageId: "<a@x>", folder: { accountId: "a1", path: "/INBOX" } }], now: NOW });
    await create_router(registry, api).run({ command: "msg.snooze", args: { until: "someday" }, count: 1, windowId: 3, messageIds: [1] });
    assert.equal(calls.some((call) => call.startsWith("messages.move")), false);
    assert.equal(calls.filter((call) => call.startsWith("notify")).length, 1);
});

test("through the router, msg.snooze on an empty selection refuses and moves nothing", async () => {
    const { api, calls } = fake_api({ now: NOW });
    await create_router(registry, api).run({ command: "msg.snooze", args: { until: "tomorrow" }, count: 1, windowId: 3, messageIds: [] });
    assert.deepEqual(calls.filter((call) => !call.startsWith("notify")), []);
    assert.equal(calls.filter((call) => call.startsWith("notify")).length, 1);
});
