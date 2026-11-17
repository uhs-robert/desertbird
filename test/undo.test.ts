import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import type { MessageHeader } from "../src/background/handlers/message.ts";
import type { MessageQuery } from "../src/background/handlers/message_query.ts";
import type { ViewRow } from "../src/shared/protocol.ts";
import { UNDO_STACK_LIMIT, UNDO_STORAGE_KEY, create_undo_log, migrate_undo_record } from "../src/background/undo_log.ts";
import { fake_storage } from "./fake_api.ts";

const FOLDERS: MailFolder[] = [
    { id: "inbox", accountId: "a1", path: "/Inbox", specialUse: ["inbox"] },
    { id: "work", accountId: "a1", path: "/Work" },
    { id: "trash", accountId: "a1", path: "/Trash", specialUse: ["trash"] },
    { id: "archives", accountId: "a1", path: "/Archives", specialUse: ["archives"] },
    { id: "imap-inbox", accountId: "a2", path: "/INBOX", specialUse: ["inbox"] },
    { id: "imap-trash", accountId: "a2", path: "/Trash", specialUse: ["trash"] },
];

interface Stored {
    id: number;
    header?: string;
    folder: string;
    read?: boolean;
    flagged?: boolean;
    junk?: boolean;
}

/**
 * A mail store that behaves as the API does where undo depends on it: a move gives the message a new id, a delete moves to the Trash of the account (or removes the message for good from Trash), and an archive files into a year folder it makes on first use.
 * `hide_lookups` makes that many next queries find nothing, as an IMAP server that has not synced the moved copy yet.
 */
function mail_store(messages: Stored[], options: { rows?: ViewRow[]; current?: number; retry_delays_ms?: number[]; storage?: ReturnType<typeof fake_storage> } = {}) {
    const folders = structuredClone(FOLDERS);
    const box = new Map(messages.map((message) => [message.id, { ...message }]));
    let next_id = Math.max(0, ...box.keys()) + 1;
    const calls: string[] = [];
    const notices: string[] = [];
    let hide_lookups = 0;
    const folder = (id: string) => folders.find((entry) => entry.id === id)!;
    const header_of = (message: Stored): MessageHeader => ({ id: message.id, date: new Date(0), ...(message.header !== undefined && { headerMessageId: message.header }), read: message.read === true, flagged: message.flagged === true, junk: message.junk === true, folder: { ...folder(message.folder) } });
    const known = (id: number) => {
        const message = box.get(id);
        if (message === undefined) throw new Error(`Message not found: ${id}.`);
        return message;
    };
    const relocate = (ids: number[], folder_id: string) => {
        for (const id of ids) {
            const message = known(id);
            box.delete(id);
            const moved = { ...message, id: next_id++, folder: folder_id };
            box.set(moved.id, moved);
        }
    };
    const storage = options.storage ?? fake_storage();
    const log = create_undo_log({ storage: storage.api });
    const api = {
        messages: {
            get: async (id: number) => header_of(known(id)),
            delete: async (ids: number[]) => {
                calls.push(`delete ${ids.join(",")}`);
                for (const id of ids) {
                    const message = known(id);
                    const trash = folders.find((entry) => entry.accountId === folder(message.folder).accountId && entry.specialUse?.includes("trash"))!;
                    if (message.folder === trash.id) box.delete(id);
                    else relocate([id], trash.id);
                }
            },
            archive: async (ids: number[]) => {
                calls.push(`archive ${ids.join(",")}`);
                if (!folders.some((entry) => entry.id === "archives-2026")) folders.push({ id: "archives-2026", accountId: "a1", path: "/Archives/2026" });
                relocate(ids, "archives-2026");
            },
            move: async (ids: number[], folder_id: string) => {
                calls.push(`move ${ids.join(",")} ${folder_id}`);
                if (!folders.some((entry) => entry.id === folder_id)) throw new Error(`Folder not found: ${folder_id}.`);
                relocate(ids, folder_id);
            },
            update: async (id: number, properties: Partial<Stored>) => {
                calls.push(`update ${id} ${JSON.stringify(properties)}`);
                Object.assign(known(id), properties);
            },
            query: async (query: MessageQuery) => {
                calls.push(`query ${query.headerMessageId} ${query.folderId}${query.includeSubFolders ? " +sub" : ""}`);
                if (hide_lookups > 0) return (hide_lookups--, { messages: [] });
                const base = query.folderId === undefined ? undefined : folder(query.folderId);
                const inside = (message: Stored) => base === undefined || message.folder === base.id || (query.includeSubFolders === true && folder(message.folder).accountId === base.accountId && folder(message.folder).path.startsWith(`${base.path}/`));
                return { messages: [...box.values()].filter((message) => message.header === query.headerMessageId && inside(message)).map(header_of) };
            },
            continueList: async () => ({ messages: [] }),
        },
        folders: {
            query: async (query: { accountId?: string; specialUse?: string[]; path?: string }) => folders.filter((entry) => (query.accountId === undefined || entry.accountId === query.accountId) && (query.path === undefined || entry.path === query.path) && (query.specialUse === undefined || query.specialUse.some((use) => entry.specialUse?.includes(use)))),
        },
        notifications: { create: async (_id: string | undefined, notification: { message: string }) => (notices.push(notification.message), "n1") },
        keys: { viewRows: async ({ first, last }: { first: number; last: number }) => ({ current: options.current ?? -1, rows: (options.rows ?? []).filter((row) => row.index >= first && row.index <= last) }) },
        undo: { log, retry_delays_ms: options.retry_delays_ms ?? [1, 1] },
    };
    const router = create_router(registry, api as unknown as RouterApi);
    const run = (command: string, message_ids: number[] = [], args: Record<string, string> = {}, count = 1) => router.run({ command, args, count, windowId: 3, messageIds: message_ids });
    return {
        run,
        calls,
        notices,
        storage,
        hide_next_lookups: (count: number) => void (hide_lookups = count),
        /** Where each Message-ID sits now, as `header@folder`, sorted. */
        places: () => [...box.values()].map((message) => `${message.header ?? "-"}@${message.folder}`).sort(),
        message: (header: string) => [...box.values()].find((message) => message.header === header),
        id_of: (header: string) => [...box.values()].find((message) => message.header === header)!.id,
        drop: (header: string) => [...box.entries()].filter(([, message]) => message.header === header).forEach(([id]) => box.delete(id)),
        put: (header: string, folder_id: string) => void box.set(next_id, { id: next_id++, header, folder: folder_id }),
        remove_folder: (id: string) => void folders.splice(folders.findIndex((entry) => entry.id === id), 1),
        folder_of: (id: number) => box.get(id)?.folder,
        top_items: () => ((storage.data[UNDO_STORAGE_KEY] as { entries: { items: unknown[] }[] }).entries.at(-1)?.items ?? []).length,
        entries: () => ((storage.data[UNDO_STORAGE_KEY] as { entries?: unknown[] } | undefined)?.entries ?? []).length,
        moves: () => calls.filter((call) => call.startsWith("move")),
    };
}

const inbox = (header: string, id: number, more: Partial<Stored> = {}): Stored => ({ id, header, folder: "inbox", ...more });

test("d d then u moves the message back from Trash to its folder", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.delete", [1]);
    assert.deepEqual(mail.places(), ["a@x@trash", "b@x@inbox"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@inbox"]);
    assert.deepEqual(mail.notices, ["Undid the delete of 1 message."]);
    assert.equal(mail.entries(), 0);
});

test("x then u finds the message in the year folder Archives made, and moves it back", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.archive", [1, 2]);
    assert.deepEqual(mail.places(), ["a@x@archives-2026", "b@x@archives-2026"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@inbox"]);
    assert.ok(mail.calls.includes("query a@x archives +sub"));
});

test("a move then u moves the message back", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.move", [1], { folder: "/Work" });
    assert.deepEqual(mail.places(), ["a@x@work"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox"]);
});

test("a selection across folders and accounts returns each message to its own folder", async () => {
    const mail = mail_store([inbox("a@x", 1), { id: 2, header: "b@x", folder: "work" }, { id: 3, header: "c@x", folder: "imap-inbox" }]);
    await mail.run("msg.delete", [1, 2, 3]);
    assert.deepEqual(mail.places(), ["a@x@trash", "b@x@trash", "c@x@imap-trash"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@work", "c@x@imap-inbox"]);
});

test("u with nothing recorded says so and moves nothing", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.notices, ["Nothing to undo."]);
    assert.deepEqual(mail.moves(), []);
});

test("u steps back through the stack, newest first", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.delete", [1]);
    await mail.run("msg.archive", [2]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@trash", "b@x@inbox"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@inbox"]);
});

test("a message gone from Trash: u retries, then refuses, moves nothing and keeps the entry", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.delete", [1, 2]);
    mail.drop("a@x");
    await mail.run("msg.undo");
    assert.equal(mail.calls.filter((call) => call.startsWith("query a@x")).length, 3, "one lookup and two retries");
    assert.deepEqual(mail.moves(), [], "b@x stays too: nothing moves while a message is missing");
    assert.match(mail.notices.at(-1) ?? "", /^1 of 2 messages are no longer in Trash, so nothing changed\. The step stays/);
    assert.equal(mail.entries(), 1);
    // The message turns up again (a sync, a restore by hand), and the kept entry now works.
    mail.put("a@x", "trash");
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@inbox"]);
    assert.equal(mail.entries(), 0);
});

test("a copy that shows up late, as on IMAP, is found by a retry", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.delete", [1]);
    mail.hide_next_lookups(2);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox"]);
});

test("a message moved out of Trash by hand is never taken from where it went", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.delete", [1]);
    // A move outside DesertBird: no entry.
    const id = mail.id_of("a@x");
    mail.drop("a@x");
    mail.put("a@x", "work");
    assert.notEqual(mail.id_of("a@x"), id);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@work"]);
    assert.deepEqual(mail.moves(), []);
    assert.equal(mail.entries(), 1);
});

test("duplicate Message-IDs: u moves only as many copies as were recorded, the newest first", async () => {
    // An older copy of the same message already sits in Trash.
    const mail = mail_store([{ id: 1, header: "a@x", folder: "trash" }, inbox("a@x", 2)]);
    await mail.run("msg.delete", [2]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "a@x@trash"]);
    assert.equal(mail.folder_of(1), "trash", "the old copy stays put");
});

test("duplicate Message-IDs: two copies deleted together both come back", async () => {
    const mail = mail_store([inbox("a@x", 1), { id: 2, header: "a@x", folder: "work" }]);
    await mail.run("msg.delete", [1, 2]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "a@x@work"]);
});

test("a message with no Message-ID records nothing and warns, and the rest still undo", async () => {
    const mail = mail_store([{ id: 1, folder: "inbox" }, inbox("b@x", 2)]);
    await mail.run("msg.delete", [1, 2]);
    assert.deepEqual(mail.places(), ["-@trash", "b@x@trash"]);
    assert.match(mail.notices[0] ?? "", /^u cannot undo this for 1 of 2 messages/);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["-@trash", "b@x@inbox"]);
    const alone = mail_store([{ id: 1, folder: "inbox" }]);
    await alone.run("msg.delete", [1]);
    assert.equal(alone.entries(), 0);
    await alone.run("msg.undo");
    assert.deepEqual(alone.notices, ["u cannot undo this for this message: no Message-ID, or no copy DesertBird can find again.", "Nothing to undo."]);
});

test("a delete from Trash is for good, so it records nothing and warns", async () => {
    const mail = mail_store([{ id: 1, header: "a@x", folder: "trash" }]);
    await mail.run("msg.delete", [1]);
    assert.equal(mail.entries(), 0);
    assert.equal(mail.notices.length, 1);
});

test("the stack keeps the newest entries up to its limit", async () => {
    const messages = Array.from({ length: UNDO_STACK_LIMIT + 5 }, (_, index) => inbox(`m${index}@x`, index + 1));
    const mail = mail_store(messages);
    for (const message of messages) await mail.run("msg.delete", [message.id]);
    assert.equal(mail.entries(), UNDO_STACK_LIMIT);
    await mail.run("msg.undo");
    assert.equal(mail.message(`m${UNDO_STACK_LIMIT + 4}@x`)?.folder, "inbox");
});

test("two quick u presses undo two entries, each once", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.delete", [1]);
    await mail.run("msg.delete", [2]);
    await Promise.all([mail.run("msg.undo"), mail.run("msg.undo")]);
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@inbox"]);
    assert.equal(mail.moves().length, 2);
    assert.equal(mail.entries(), 0);
});

test("d d and u at once: u waits for the delete's entry, so it undoes that delete", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.delete", [1]);
    await Promise.all([mail.run("msg.delete", [2]), mail.run("msg.undo")]);
    assert.deepEqual(mail.places(), ["a@x@trash", "b@x@inbox"]);
});

test("changes from two windows at once both land on the stack, with slow storage", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)], { storage: fake_storage({}, 5) });
    await Promise.all([mail.run("msg.delete", [1]), mail.run("msg.archive", [2])]);
    assert.equal(mail.entries(), 2);
});

test("a folder gone before the undo keeps the messages it could not take back", async () => {
    const mail = mail_store([inbox("a@x", 1), { id: 2, header: "b@x", folder: "work" }]);
    await mail.run("msg.delete", [1, 2]);
    mail.remove_folder("work");
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@trash"]);
    assert.match(mail.notices.at(-1) ?? "", /^1 message could not go back: Folder not found: work\. The step keeps it\.$/);
    assert.deepEqual(mail.top_items(), 1);
});

test("m r, m s and m j undo to the old value, and a message that already had the value gets no item", async () => {
    const mail = mail_store([inbox("a@x", 1, { read: false, flagged: true }), inbox("b@x", 2, { read: true })]);
    await mail.run("msg.read", [1, 2], { state: "read" });
    await mail.run("msg.flag", [1, 2]);
    await mail.run("msg.junk", [2]);
    assert.deepEqual([mail.message("a@x")!.flagged, mail.message("b@x")!.flagged, mail.message("b@x")!.junk], [false, false, true]);
    await mail.run("msg.undo");
    assert.equal(mail.message("b@x")!.junk, false);
    await mail.run("msg.undo");
    assert.equal(mail.message("a@x")!.flagged, true);
    mail.calls.length = 0;
    await mail.run("msg.undo");
    assert.deepEqual([mail.message("a@x")!.read, mail.message("b@x")!.read], [false, true]);
    assert.deepEqual(mail.calls.filter((call) => call.startsWith("update")), ['update 1 {"read":false}'], "b@x was read before, so it is left alone");
    assert.deepEqual(mail.notices.at(-1), "Undid the read change of 1 message.");
});

test("a mark undo finds the message after a delete and its undo gave it a new id", async () => {
    const mail = mail_store([inbox("a@x", 1, { read: false })]);
    await mail.run("msg.read", [1], { state: "read" });
    await mail.run("msg.delete", [1]);
    await mail.run("msg.undo");
    await mail.run("msg.undo");
    assert.equal(mail.message("a@x")!.read, false);
    assert.equal(mail.message("a@x")!.folder, "inbox");
});

test("3 d d deletes the current row and the two below it, as one undo step", async () => {
    const rows = [1, 2, 3, 4].map((id, index) => ({ index, id, depth: 0, collapsed: false, unread: false, flags: 0 }));
    const mail = mail_store([1, 2, 3, 4].map((id) => inbox(`m${id}@x`, id)), { rows, current: 0 });
    await mail.run("msg.delete", [1], {}, 3);
    assert.deepEqual(mail.calls.filter((call) => call.startsWith("delete")), ["delete 1,2,3"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["m1@x@inbox", "m2@x@inbox", "m3@x@inbox", "m4@x@inbox"]);
    assert.deepEqual(mail.notices, ["Undid the delete of 3 messages."]);
});

test("a count near the end of the list takes the rows that are there", async () => {
    const rows = [1, 2].map((id, index) => ({ index, id, depth: 0, collapsed: false, unread: false, flags: 0 }));
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)], { rows, current: 1 });
    await mail.run("msg.archive", [2], {}, 5);
    assert.deepEqual(mail.calls.filter((call) => call.startsWith("archive")), ["archive 2"]);
});

test("a count refuses when the selection moved, or when it would reach into a closed thread", async () => {
    const rows = [1, 2, 3].map((id, index) => ({ index, id, depth: 0, collapsed: index === 2, unread: false, flags: 0 }));
    const moved = mail_store([1, 2, 3].map((id) => inbox(`m${id}@x`, id)), { rows, current: 1 });
    await moved.run("msg.delete", [1], {}, 2);
    assert.deepEqual(moved.notices, ["The selection moved before the count ran, so nothing changed."]);
    const closed = mail_store([1, 2, 3].map((id) => inbox(`m${id}@x`, id)), { rows, current: 0 });
    await closed.run("msg.delete", [1], {}, 3);
    assert.match(closed.notices[0] ?? "", /closed thread/);
    const no_list = mail_store([inbox("a@x", 1)], { current: -1 });
    await no_list.run("msg.archive", [1], {}, 2);
    assert.match(no_list.notices[0] ?? "", /only in the thread list/);
    for (const mail of [moved, closed, no_list]) assert.deepEqual(mail.calls.filter((call) => /^(delete|archive)/.test(call)), []);
});

test("an unreadable or newer stored record reads as an empty stack", async () => {
    assert.equal(migrate_undo_record({ record_version: 2, entries: [] }), undefined);
    assert.equal(migrate_undo_record(undefined), undefined);
    const record = migrate_undo_record({ record_version: 1, entries: [{ id: "e", kind: "moved", action: "delete", items: [] }, { id: "f", kind: "state", field: "read", items: [{ header_message_id: "a", folder_id: "f", old: true }] }, null] });
    assert.deepEqual(record?.entries.map((entry) => entry.id), ["f"]);
    const storage = fake_storage({ [UNDO_STORAGE_KEY]: { record_version: 9, entries: "nope" } });
    const log = create_undo_log({ storage: storage.api });
    assert.equal(await log.undo_newest(async () => ({ left: [] })), undefined);
});
