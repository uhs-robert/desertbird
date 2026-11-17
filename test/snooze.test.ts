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
function mailbox(options: { cannot_create_in?: string[]; create_fails_in?: string[]; hang_create_in?: string[]; namespace_in?: string[]; create_delay_ms?: number; page_size?: number; empty_first_page?: boolean; no_inbox_in?: string[]; write_delay_ms?: number; inbox_lookup_failures?: number } = {}) {
    const storage = fake_storage({}, options.write_delay_ms ?? 0);
    const store = create_snooze_store({ storage: storage.api });
    const folders: (MailFolder & { isRoot?: boolean })[] = [
        { id: "imap-root", accountId: "imap", path: "/", isRoot: true },
        { id: "imap-sent", accountId: "imap", path: "/Sent", specialUse: ["sent"] },
        { id: "imap-inbox", accountId: "imap", path: "/INBOX", specialUse: ["inbox"] },
        { id: "imap-other", accountId: "imap", path: "/Other" },
        { id: "imap-archive", accountId: "imap", path: "/Archive", specialUse: ["archives"] },
        { id: "local-root", accountId: "local", path: "/", isRoot: true },
        { id: "local-inbox", accountId: "local", path: "/Inbox", specialUse: ["inbox"] },
    ];
    const messages: StoredMessage[] = [];
    const log: string[] = [];
    const notices: string[] = [];
    let next_id = 100;
    let inbox_lookup_failures = options.inbox_lookup_failures ?? 0;
    const lists = new Map<string, MessageHeader[][]>();
    const header_of = (message: StoredMessage): MessageHeader => {
        const folder = folders.find((candidate) => candidate.id === message.folder_id)!;
        return { id: message.id, date: new Date(0), read: message.read, headerMessageId: message.header, subject: message.subject, folder: { id: folder.id, accountId: folder.accountId, path: folder.path, ...(folder.specialUse === undefined ? {} : { specialUse: folder.specialUse }) } };
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
            // A page holds `page_size` matches. The rest come through continueList.
            query: async (query: { headerMessageId: string; folderId?: string; accountId?: string }) => {
                const matches = messages.filter((message) => message.header === query.headerMessageId && (query.folderId === undefined || message.folder_id === query.folderId) && (query.accountId === undefined || folders.find((folder) => folder.id === message.folder_id)?.accountId === query.accountId)).map(header_of);
                const size = options.page_size ?? matches.length + 1;
                const pages: MessageHeader[][] = options.empty_first_page ? [[]] : [];
                for (let start = 0; start < matches.length; start += size) pages.push(matches.slice(start, start + size));
                if (pages.length === 0) pages.push([]);
                const list_id = `list-${lists.size}`;
                lists.set(list_id, pages.slice(1));
                return { id: pages.length > 1 ? list_id : null, messages: pages[0]! };
            },
            continueList: async (list_id: string) => {
                const [page = [], ...rest] = lists.get(list_id) ?? [];
                lists.set(list_id, rest);
                return { id: rest.length > 0 ? list_id : null, messages: page };
            },
            update: async (id: number, properties: { read: boolean }) => void (messages.find((message) => message.id === id)!.read = properties.read),
        },
        folders: {
            // `canAddSubfolders` filters root folders and never appears on a returned folder, as in the real API.
            query: async (query: { accountId?: string; path?: string; isRoot?: boolean; specialUse?: string[]; canAddSubfolders?: boolean; folderId?: string }) => {
                if (query.specialUse?.includes("inbox") && inbox_lookup_failures > 0) {
                    inbox_lookup_failures--;
                    throw new Error("the folder tree is not loaded yet");
                }
                // The real API throws for a folder id it does not know.
                if (query.folderId !== undefined && !folders.some((folder) => folder.id === query.folderId)) throw new Error(`Folder not found: ${query.folderId}.`);
                return folders.filter((folder) => (query.folderId === undefined || folder.id === query.folderId) && (query.canAddSubfolders === undefined || !options.cannot_create_in?.includes(folder.accountId) === query.canAddSubfolders) && !(query.specialUse?.includes("inbox") && options.no_inbox_in?.includes(folder.accountId)) && (query.accountId === undefined || folder.accountId === query.accountId) && (query.path === undefined || folder.path === query.path) && (query.isRoot === undefined || folder.isRoot === query.isRoot) && (query.specialUse === undefined || query.specialUse.some((use) => folder.specialUse?.includes(use))));
            },
            create: async (parent_id: string, name: string) => {
                const parent = folders.find((folder) => folder.id === parent_id)!;
                log.push(`create ${parent.accountId} ${name}`);
                if (options.hang_create_in?.includes(parent.accountId)) return new Promise<MailFolder>(() => {});
                await new Promise((resolve) => setTimeout(resolve, options.create_delay_ms ?? 0));
                if (options.create_fails_in?.includes(parent.accountId)) throw new Error("The server refused the folder.");
                if (folders.some((folder) => folder.accountId === parent.accountId && folder.id === `${parent.accountId}-${name}`)) throw new Error(`${name} already exists.`);
                const created = { id: `${parent.accountId}-${name}`, accountId: parent.accountId, path: options.namespace_in?.includes(parent.accountId) ? `/INBOX/${name}` : `/${name}` };
                folders.push(created);
                return created;
            },
        },
        accounts: { list: async () => [{ id: "imap", type: "imap" }, { id: "local", type: "none" }] },
        snooze: { items: store, now: () => NOW, create_timeout_ms: 60 },
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
    assert.deepEqual(await box.store.list(), [{ header_message_id: "<a@x>", origin_account_id: "imap", folder_id: "imap-Snoozed", origin_folder_id: "imap-inbox", due_ms: tomorrow_8 }]);
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

test("when Local Folders cannot hold the folder either, the snooze fails and stores nothing", async () => {
    const box = mailbox({ cannot_create_in: ["imap", "local"] });
    const message = box.add("<a@x>");
    await assert.rejects(snooze(box, [message.id]), /cannot hold a Snoozed folder/);
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
    assert.deepEqual(box.notices, ["A snoozed message returned."]);
});

test("a wake from the Local Folders fallback returns the message to the origin account", async () => {
    const box = mailbox({ cannot_create_in: ["imap"] });
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    await box.store.wake_due(tomorrow_8, (item) => wake_snoozed(box.api, item));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
});

test("a message in neither folder keeps the item for a bounded number of ticks, then drops it with a notification", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.messages.length = 0;
    box.notices.length = 0;
    box.log.length = 0;
    const original_error = console.error;
    console.error = () => {};
    try {
        for (let tick = 0; tick < 29; tick++) await box.store.wake_due(tomorrow_8 + tick * MINUTE, (item) => wake_snoozed(box.api, item));
        assert.equal((await box.store.list()).length, 1);
        assert.deepEqual(box.notices, []);
        await box.store.wake_due(tomorrow_8 + 29 * MINUTE, (item) => wake_snoozed(box.api, item));
    } finally {
        console.error = original_error;
    }
    assert.deepEqual(box.notices, ["A snoozed message is no longer in the Snoozed folder, so it did not return."]);
    assert.deepEqual(box.log, []);
    assert.deepEqual(await box.store.list(), []);
});

test("a message that shows up in the Snoozed folder after a missed tick still returns", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const [held] = box.messages.splice(0);
    const original_error = console.error;
    console.error = () => {};
    try {
        await box.store.wake_due(tomorrow_8, (item) => wake_snoozed(box.api, item));
    } finally {
        console.error = original_error;
    }
    box.messages.push(held!);
    await box.store.wake_due(tomorrow_8 + MINUTE, (item) => wake_snoozed(box.api, item));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
    assert.deepEqual(await box.store.list(), []);
});

test("every copy that shares a Message-ID returns on one wake", async () => {
    const box = mailbox();
    const first = box.add("<a@x>");
    const second = box.add("<a@x>", "imap-sent");
    await snooze(box, [first.id]);
    await snooze(box, [second.id]);
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed", "imap-Snoozed"]);
    assert.equal((await box.store.list()).length, 1);
    await box.store.wake_due(tomorrow_8, (item) => wake_snoozed(box.api, item));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox", "imap-inbox"]);
    assert.deepEqual(box.messages.map((message) => message.read), [false, false]);
});

test("a Snoozed folder that was deleted or renamed does not stall the wake: the message is found by its Message-ID in the account", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.messages[0]!.folder_id = "imap-other";
    const renamed = { ...(await box.store.list())[0]!, folder_id: "deleted-folder" };
    await box.store.add(renamed);
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
    assert.deepEqual(await box.store.list(), []);
});

test("a gone Snoozed folder with several copies moves only the waiting one, not a Sent or filed copy", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.add("<a@x>", "imap-sent");
    box.add("<a@x>", "imap-archive");
    const gone = { ...(await box.store.list())[0]!, folder_id: "deleted-folder" };
    await box.store.add(gone);
    box.messages[0]!.folder_id = "imap-other";
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>").sort(), ["imap-archive", "imap-inbox", "imap-sent"]);
});

test("a gone Snoozed folder in Local Folders still finds the message there", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.messages[0]!.folder_id = "local-inbox";
    const gone = { ...(await box.store.list())[0]!, folder_id: "deleted-folder" };
    await box.store.add(gone);
    box.messages[0]!.folder_id = "local-root";
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
});

test("the item is stored before the message moves", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    const failing: SnoozeApi & WakeApi = { ...box.api, messages: { ...box.api.messages, move: async () => Promise.reject(new Error("offline")) } };
    await assert.rejects(snooze({ ...box, api: failing } as typeof box, [message.id]), /offline/);
    assert.equal((await box.store.list()).length, 1);
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

test("an account with no Inbox gets the message back in the folder it came from", async () => {
    const box = mailbox({ no_inbox_in: ["imap"] });
    const message = box.add("<a@x>", "imap-sent");
    await snooze(box, [message.id]);
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>"), ["imap-sent"]);
    assert.equal(box.messages[0]?.read, false);
    assert.deepEqual(await box.store.list(), []);
});

test("an account with no Inbox and no origin folder drops the item with a notification and leaves the message in Snoozed", async () => {
    const box = mailbox({ no_inbox_in: ["imap"] });
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const [item] = await box.store.list();
    box.notices.length = 0;
    await wake_snoozed(box.api, { ...item!, origin_folder_id: "removed-folder" });
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed"]);
    assert.match(box.notices[0]!, /no Inbox and its folder is gone/);
});

test("a wake whose Snoozed folder no longer exists drops the item with a notification and does not retry", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    box.notices.length = 0;
    const missing_folder = { ...(await box.store.list())[0]!, folder_id: "deleted-folder" };
    await box.store.add(missing_folder);
    box.messages.length = 0;
    const original_error = console.error;
    console.error = () => {};
    try {
        for (let tick = 0; tick < 30; tick++) await box.store.wake_due(tomorrow_8 + tick * MINUTE, (found) => wake_snoozed(box.api, found));
    } finally {
        console.error = original_error;
    }
    assert.deepEqual(await box.store.list(), []);
    assert.match(box.notices.at(-1)!, /Snoozed folder is gone/);
});

test("a refused create or a create that never settles refuses the snooze, leaves the message in place and does not fall back", async () => {
    const refused = mailbox({ create_fails_in: ["imap"] });
    const one = refused.add("<a@x>");
    await assert.rejects(snooze(refused, [one.id]), /server refused/);
    assert.deepEqual(refused.where("<a@x>"), ["imap-inbox"]);
    assert.equal(refused.log.some((line) => line.includes("create local")), false);
    const hung = mailbox({ hang_create_in: ["imap"] });
    const two = hung.add("<b@x>");
    await assert.rejects(snooze(hung, [two.id]), /timed out/);
    assert.deepEqual(hung.where("<b@x>"), ["imap-inbox"]);
    assert.deepEqual(await hung.store.list(), []);
    assert.equal(hung.log.some((line) => line.includes("create local")), false);
});

test("two snoozes at once in one account create the Snoozed folder once and both messages wait in it", async () => {
    const box = mailbox({ create_delay_ms: 15 });
    const one = box.add("<a@x>");
    const two = box.add("<b@x>");
    await Promise.all([snooze(box, [one.id]), snooze(box, [two.id], "monday")]);
    assert.equal(box.log.filter((line) => line.startsWith("create")).length, 1);
    assert.deepEqual([box.where("<a@x>"), box.where("<b@x>")], [["imap-Snoozed"], ["imap-Snoozed"]]);
});

test("a create that lost a race to another create finds the folder and uses it, with no fallback", async () => {
    const box = mailbox({ create_delay_ms: 5 });
    const one = box.add("<a@x>");
    const racing = box.api.folders.create("imap-root", "Snoozed");
    await snooze(box, [one.id]);
    await racing;
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed"]);
    assert.equal(box.log.some((line) => line.includes("local")), false);
});

test("a Snoozed folder under INBOX is found again, and the wake reads the stored folder", async () => {
    const box = mailbox({ namespace_in: ["imap"] });
    const one = box.add("<a@x>");
    const two = box.add("<b@x>");
    await snooze(box, [one.id]);
    await snooze(box, [two.id]);
    assert.equal(box.log.filter((line) => line.startsWith("create")).length, 1);
    assert.deepEqual((await box.store.list()).map((found) => found.folder_id), ["imap-Snoozed", "imap-Snoozed"]);
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual([box.where("<a@x>"), box.where("<b@x>")], [["imap-inbox"], ["imap-inbox"]]);
});

test("the wake reads past an empty first page to find the waiting message", async () => {
    const box = mailbox({ empty_first_page: true });
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
    assert.deepEqual(await box.store.list(), []);
});

test("a copy in another folder is never taken, even when pages hold one match each", async () => {
    const box = mailbox({ page_size: 1 });
    box.add("<a@x>", "imap-sent");
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>").sort(), ["imap-inbox", "imap-sent"]);
    assert.deepEqual(await box.store.list(), []);
});

test("a copy of the message in the origin Inbox and one in another account do not stand in for the Snoozed copy", async () => {
    const box = mailbox();
    const message = box.add("<a@x>");
    box.add("<a@x>", "local-inbox");
    await snooze(box, [message.id]);
    await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>").sort(), ["imap-inbox", "local-inbox"]);
});

test("an Inbox lookup that fails keeps the item, and the next tick wakes the message", async () => {
    const box = mailbox({ inbox_lookup_failures: 1 });
    const message = box.add("<a@x>");
    await snooze(box, [message.id]);
    const original_error = console.error;
    console.error = () => {};
    try {
        await box.store.wake_due(tomorrow_8, (found) => wake_snoozed(box.api, found));
    } finally {
        console.error = original_error;
    }
    assert.equal((await box.store.list()).length, 1);
    assert.deepEqual(box.where("<a@x>"), ["imap-Snoozed"]);
    await box.store.wake_due(tomorrow_8 + MINUTE, (found) => wake_snoozed(box.api, found));
    assert.deepEqual(box.where("<a@x>"), ["imap-inbox"]);
    assert.deepEqual(await box.store.list(), []);
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
    assert.equal(box.notices.filter((notice) => notice.startsWith("A snoozed message returned")).length, 1);
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
