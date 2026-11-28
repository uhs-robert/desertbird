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
    { id: "receipts", accountId: "a1", path: "/Receipts" },
    { id: "imap-receipts", accountId: "a2", path: "/Receipts" },
];

interface Stored {
    id: number;
    header?: string;
    folder: string;
    read?: boolean;
    flagged?: boolean;
    junk?: boolean;
    tags?: string[];
    /** The Date header, in ms. Copies that share a Message-ID differ here. */
    date?: number;
    size?: number;
}

/**
 * A mail store that behaves as the API does where undo depends on it: a move gives the message a new id, a delete moves to the Trash of the account (or removes the message for good from Trash), and an archive files into a year folder it makes on first use.
 * `hide_lookups` makes that many next queries find nothing, as an IMAP server that has not synced the moved copy yet.
 * `unindexed` names folders with no summary file: a query finds nothing there, a query of a parent with subfolders skips them, and `getFolderInfo` throws, until the verb `indexFolder` parses the folder. `info_fails` names folders whose `getFolderInfo` throws the same generic error for another cause, which a parse does not end. Only the folders of account a1 are local, and the verb refuses the others without parsing. `index` says what the verb does: `parses` (the default) builds the summary, `never_loads` waits out its timeout and answers false, and `holds` keeps the parse running, with the folder locked, until `finish_parse` is called.
 */
function mail_store(messages: Stored[], options: { rows?: ViewRow[]; current?: number; retry_delays_ms?: number[]; storage?: ReturnType<typeof fake_storage>; failing_folder_query?: boolean; unindexed?: string[]; info_fails?: string[]; index?: "parses" | "never_loads" | "holds"; experiment?: false } = {}) {
    const folders = structuredClone(FOLDERS);
    const box = new Map(messages.map((message) => [message.id, { ...message }]));
    let next_id = Math.max(0, ...box.keys()) + 1;
    const calls: string[] = [];
    const notices: string[] = [];
    let hide_lookups = 0;
    const failing_accounts = new Set<string>();
    const unindexed = new Set(options.unindexed ?? []);
    const parsing = new Set<string>();
    let finish_parse = () => {};
    let parse_started = () => {};
    const parse_start = new Promise<void>((resolve) => (parse_started = resolve));
    let tag_keys = ["work", "home"];
    const folder = (id: string) => folders.find((entry) => entry.id === id)!;
    const header_of = (message: Stored): MessageHeader => ({ id: message.id, date: new Date(message.date ?? 0), ...(message.size !== undefined && { size: message.size }), ...(message.header !== undefined && { headerMessageId: message.header }), read: message.read === true, flagged: message.flagged === true, junk: message.junk === true, ...(message.tags !== undefined && { tags: [...message.tags] }), folder: { ...folder(message.folder) } });
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
    const parsed: string[] = [];
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
                if (parsing.has(folder_id)) throw new Error("The folder is busy: NS_MSG_FOLDER_BUSY.");
                relocate(ids, folder_id);
            },
            update: async (id: number, properties: Partial<Stored>) => {
                calls.push(`update ${id} ${JSON.stringify(properties)}`);
                Object.assign(known(id), properties);
            },
            query: async (query: MessageQuery) => {
                calls.push(`query ${query.headerMessageId} ${query.folderId}${query.includeSubFolders ? " +sub" : ""}`);
                if (hide_lookups > 0) return (hide_lookups--, { messages: [] });
                if (query.folderId !== undefined && unindexed.has(query.folderId)) return { messages: [] };
                const base = query.folderId === undefined ? undefined : folder(query.folderId);
                const inside = (message: Stored) => unindexed.has(message.folder) ? false : base === undefined || message.folder === base.id || (query.includeSubFolders === true && folder(message.folder).accountId === base.accountId && folder(message.folder).path.startsWith(`${base.path}/`));
                return { messages: [...box.values()].filter((message) => message.header === query.headerMessageId && inside(message)).map(header_of) };
            },
            continueList: async () => ({ messages: [] }),
            tags: { list: async () => tag_keys.map((key) => ({ key, tag: key })) },
        },
        folders: {
            getFolderInfo: async (folder_id: string) => {
                folder(folder_id);
                if (unindexed.has(folder_id) || options.info_fails?.includes(folder_id)) throw new Error("An unexpected error occurred");
                return { totalMessageCount: 0 };
            },
            get: async (folder_id: string) => folder(folder_id),
            getSubFolders: async (folder_id: string) => {
                const below = (parent: MailFolder): unknown[] => folders.filter((entry) => entry.accountId === parent.accountId && entry.path.startsWith(`${parent.path}/`) && !entry.path.slice(parent.path.length + 1).includes("/")).map((child) => ({ ...child, subFolders: below(child) }));
                return below(folder(folder_id));
            },
            query: async (query: { accountId?: string; specialUse?: string[]; path?: string }) => {
                if ((options.failing_folder_query === true && query.specialUse !== undefined) || failing_accounts.has(query.accountId ?? "")) throw new Error("folder lookup failed");
                return folders.filter((entry) => (query.accountId === undefined || entry.accountId === query.accountId) && (query.path === undefined || entry.path === query.path) && (query.specialUse === undefined || query.specialUse.some((use) => entry.specialUse?.includes(use))));
            },
        },
        accounts: { list: async () => [{ id: "a1", name: "Work" }, { id: "a2", name: "Home" }] },
        notifications: { create: async (_id: string | undefined, notification: { message: string }) => (notices.push(notification.message), "n1") },
        app: { viewRows: async ({ first, last }: { first: number; last: number }) => ({ current: options.current ?? -1, rows: (options.rows ?? []).filter((row) => row.index >= first && row.index <= last) }) },
        folderpane:
            options.experiment === false
                ? undefined
                : {
                      indexFolder: async ({ folderId }: { folderId: string }) => {
                          calls.push(`index ${folderId}`);
                          if (folder(folderId).accountId !== "a1") return false;
                          if (options.index === "never_loads") return false;
                          parsed.push(folderId);
                          if (options.index === "holds") {
                              parsing.add(folderId);
                              parse_started();
                              await new Promise<void>((resolve) => (finish_parse = resolve));
                              parsing.delete(folderId);
                          }
                          unindexed.delete(folderId);
                          return true;
                      },
                  },
        undo: { log, retry_delays_ms: options.retry_delays_ms ?? [1, 1] },
    };
    const router = create_router(registry, api as unknown as RouterApi);
    const run = (command: string, message_ids: number[] = [], args: Record<string, string> = {}, count = 1) => router.run({ command, args, count, windowId: 3, messageIds: message_ids });
    return {
        run,
        calls,
        notices,
        storage,
        delete_tag: (key: string) => void (tag_keys = tag_keys.filter((other) => other !== key)),
        /** The folders the verb really parsed. A refused folder (not local) is not in it. */
        parsed,
        /** Resolves once the verb has started a parse that `holds`. */
        parse_start,
        finish_parse: () => finish_parse(),
        /** The user shows the folder: Thunderbird builds its summary. */
        open_folder: (id: string) => void unindexed.delete(id),
        /** The summary file of the folder goes missing or out of date. */
        lose_summary: (id: string) => void unindexed.add(id),
        hide_next_lookups: (count: number) => void (hide_lookups = count),
        /** Where each Message-ID sits now, as `header@folder`, sorted. */
        places: () => [...box.values()].map((message) => `${message.header ?? "-"}@${message.folder}`).sort(),
        message: (header: string) => [...box.values()].find((message) => message.header === header),
        id_of: (header: string) => [...box.values()].find((message) => message.header === header)!.id,
        drop: (header: string) => [...box.entries()].filter(([, message]) => message.header === header).forEach(([id]) => box.delete(id)),
        put: (header: string, folder_id: string, more: Partial<Stored> = {}) => void box.set(next_id, { id: next_id++, header, folder: folder_id, ...more }),
        message_by_id: (id: number) => box.get(id),
        message_in: (folder_id: string) => [...box.values()].find((message) => message.folder === folder_id),
        fail_trash_lookup: (account_id: string) => void failing_accounts.add(account_id),
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

test("a move to another account with --account then u moves the message back", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.move", [1], { folder: "/INBOX", account: "Home" });
    assert.deepEqual(mail.places(), ["a@x@imap-inbox"]);
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

test("a message gone from Trash: u retries, refuses, marks the step, and keeps it", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.delete", [1, 2]);
    mail.drop("a@x");
    await mail.run("msg.undo");
    assert.equal(mail.calls.filter((call) => call.startsWith("query a@x")).length, 4, "three tries while waiting, one more under the log");
    assert.deepEqual(mail.moves(), [], "b@x stays too: nothing moves while a message is missing");
    assert.match(mail.notices.at(-1) ?? "", /^1 of 2 messages are no longer in Trash, so nothing changed\. Press u again to drop this step\.$/);
    assert.equal(mail.entries(), 1);
    // The message turns up again (a sync, a restore by hand), and the kept entry still works.
    mail.put("a@x", "trash");
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@inbox"]);
    assert.equal(mail.entries(), 0);
});

test("a second u on a refused step looks once more, moves back what it finds, drops the rest and reaches the older step", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2), inbox("c@x", 3)]);
    await mail.run("msg.archive", [3]);
    await mail.run("msg.delete", [1, 2]);
    mail.drop("a@x");
    await mail.run("msg.undo");
    mail.calls.length = 0;
    await mail.run("msg.undo");
    assert.equal(mail.calls.filter((call) => call.startsWith("query a@x")).length, 2, "one look in the wait and the last one before the undo, no retries on a step that already refused");
    assert.deepEqual(mail.places(), ["b@x@inbox", "c@x@archives-2026"]);
    assert.match(mail.notices.at(-1) ?? "", /^Undid the delete of 1 message\. Dropped 1 message that is no longer in Trash\.$/);
    assert.equal(mail.entries(), 1);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["b@x@inbox", "c@x@inbox"]);
});

test("u does not hold the log while it waits for a missing message, so a d d runs at once", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)], { retry_delays_ms: [40, 40] });
    await mail.run("msg.delete", [1]);
    mail.drop("a@x");
    mail.calls.length = 0;
    const undoing = mail.run("msg.undo");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await mail.run("msg.delete", [2]);
    assert.deepEqual(mail.calls.filter((call) => call.startsWith("delete") || call.startsWith("query a@x")), ["query a@x trash", "delete 2"], "the delete ran while the undo waited");
    await undoing;
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

test("duplicate Message-IDs: u moves only as many copies as were recorded, the one with the recorded date", async () => {
    // An older copy of the same message already sits in Trash.
    const mail = mail_store([{ id: 1, header: "a@x", folder: "trash", date: 1000 }, inbox("a@x", 2, { date: 2000 })]);
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

test("3 m r marks three rows read, and one u writes all three back", async () => {
    const rows = [1, 2, 3, 4].map((id, index) => ({ index, id, depth: 0, collapsed: false, unread: true, flags: 0 }));
    const mail = mail_store([1, 2, 3, 4].map((id) => inbox(`m${id}@x`, id, { read: false })), { rows, current: 0 });
    await mail.run("msg.read", [1], { state: "read" }, 3);
    assert.deepEqual([1, 2, 3, 4].map((id) => mail.message(`m${id}@x`)!.read), [true, true, true, false]);
    await mail.run("msg.undo");
    assert.deepEqual([1, 2, 3, 4].map((id) => mail.message(`m${id}@x`)!.read), [false, false, false, false]);
    assert.deepEqual(mail.notices.at(-1), "Undid the read change of 3 messages.");
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
    assert.equal(migrate_undo_record({ record_version: 3, entries: [] }), undefined);
    assert.equal(migrate_undo_record(undefined), undefined);
    const record = migrate_undo_record({ record_version: 1, entries: [{ id: "e", kind: "moved", action: "delete", items: [] }, { id: "f", kind: "state", field: "read", items: [{ header_message_id: "a", folder_id: "f", old: true }] }, null] });
    assert.deepEqual(record?.entries.map((entry) => entry.id), ["f"]);
    const storage = fake_storage({ [UNDO_STORAGE_KEY]: { record_version: 9, entries: "nope" } });
    const log = create_undo_log({ storage: storage.api });
    assert.equal(await log.undo_newest(async () => {}, async () => ({ left: [] })), undefined);
});

test("copies that share a Message-ID each go back to their own folder, matched by date", async () => {
    const mail = mail_store([inbox("a@x", 1, { date: 1000 }), { id: 2, header: "a@x", folder: "work", date: 2000 }]);
    await mail.run("msg.delete", [1, 2]);
    await mail.run("msg.undo");
    const home = (date: number) => [...[1, 2, 3, 4, 5, 6, 7, 8]].map((id) => mail.message_by_id(id)).find((message) => message?.date === date)?.folder;
    assert.deepEqual([home(1000), home(2000)], ["inbox", "work"]);
});

test("u after x leaves an older archived copy alone, though the API gave it the larger id", async () => {
    // The older copy is not seen until the undo queries Archives, so its id comes last.
    const mail = mail_store([inbox("a@x", 1, { date: 5000 })]);
    await mail.run("msg.archive", [1]);
    mail.put("a@x", "archives-2026", { date: 1000 });
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@archives-2026", "a@x@inbox"]);
    assert.equal(mail.message_in("inbox")?.date, 5000);
});

test("a count that overlaps the selection acts on each message once, and its undo works", async () => {
    const rows = [1, 2, 3].map((id, index) => ({ index, id, depth: 0, collapsed: false, unread: false, flags: 0 }));
    const mail = mail_store([1, 2, 3].map((id) => inbox(`m${id}@x`, id)), { rows, current: 0 });
    // A range selected upward: the current row is its top, so the rows below are in the selection already.
    await mail.run("msg.archive", [3, 2, 1], {}, 3);
    assert.deepEqual(mail.calls.filter((call) => call.startsWith("archive")), ["archive 3,2,1"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["m1@x@inbox", "m2@x@inbox", "m3@x@inbox"]);
});

test("a failed folder lookup after the move still keeps the change, warns, and reports no failure", async () => {
    const mail = mail_store([inbox("a@x", 1)], { failing_folder_query: true });
    await mail.run("msg.delete", [1]);
    assert.deepEqual(mail.places(), ["a@x@trash"]);
    assert.deepEqual(mail.notices, ["u cannot undo this for this message: no Message-ID, or no copy DesertBird can find again."]);
});

test("a failed folder lookup for one account keeps the entry for the others", async () => {
    const mail = mail_store([inbox("a@x", 1), { id: 2, header: "b@x", folder: "imap-inbox" }]);
    mail.fail_trash_lookup("a2");
    await mail.run("msg.delete", [1, 2]);
    assert.match(mail.notices[0] ?? "", /^u cannot undo this for 1 of 2 messages/);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@imap-trash"]);
});

test("two quick undos apply in stack order, even when the newer one waits longer", async () => {
    const log = create_undo_log({ storage: fake_storage().api });
    const item = (old: boolean) => ({ header_message_id: "m@x", folder_id: "inbox", old });
    await log.record(async (keep) => keep({ kind: "state", field: "read", items: [item(false)] }));
    await log.record(async (keep) => keep({ kind: "state", field: "read", items: [item(true)] }));
    const applied: boolean[] = [];
    const undo_once = (wait_ms: number) =>
        log.undo_newest(
            () => new Promise((resolve) => setTimeout(resolve, wait_ms)),
            async (entry) => (applied.push((entry.items[0] as { old: boolean }).old), { left: [] }),
        );
    await Promise.all([undo_once(30), undo_once(0)]);
    assert.deepEqual(applied, [true, false], "the newer change undoes first, so the message ends as it began");
});

test("a u pressed while the last entry waits queues behind it and gets that entry if it stays", async () => {
    const log = create_undo_log({ storage: fake_storage().api });
    await log.record(async (keep) => keep({ kind: "state", field: "read", items: [{ header_message_id: "m@x", folder_id: "inbox", old: false }] }));
    const first = log.undo_newest(
        () => new Promise((resolve) => setTimeout(resolve, 20)),
        async (entry) => ({ left: entry.items, refused: true, refusal: "missing" }),
    );
    const second = await log.undo_newest(async () => {}, async () => ({ left: [] }));
    await first;
    assert.equal(second?.entry.refused, true, "the second u reached the refused entry, not an empty stack");
});

test("x runs while an undo waits for its copies", async () => {
    const log = create_undo_log({ storage: fake_storage().api });
    await log.record(async (keep) => keep({ kind: "state", field: "read", items: [{ header_message_id: "m@x", folder_id: "inbox", old: false }] }));
    const order: string[] = [];
    const undoing = log.undo_newest(
        () => new Promise((resolve) => setTimeout(resolve, 30)),
        async () => (order.push("undo"), { left: [] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await log.record(async () => void order.push("record"));
    await undoing;
    assert.deepEqual(order, ["record", "undo"]);
});

test("m t then u: the tag goes back off every message that gained it, as one step", async () => {
    const mail = mail_store([inbox("a@x", 1, { tags: ["home"] }), inbox("b@x", 2), inbox("c@x", 3, { tags: ["work"] })]);
    await mail.run("msg.tag", [1, 2, 3], { tag: "work" });
    assert.deepEqual([mail.message("a@x")!.tags, mail.message("b@x")!.tags, mail.message("c@x")!.tags], [["home", "work"], ["work"], ["work"]]);
    assert.equal(mail.entries(), 1);
    await mail.run("msg.undo");
    assert.deepEqual([mail.message("a@x")!.tags, mail.message("b@x")!.tags, mail.message("c@x")!.tags], [["home"], [], ["work"]]);
    assert.equal(mail.notices.at(-1), "Undid the tag change of 2 messages.");
});

test("m t that removes a tag then u puts it back only where the message had it", async () => {
    const mail = mail_store([inbox("a@x", 1, { tags: ["work", "home"] }), inbox("b@x", 2), inbox("c@x", 3, { tags: ["work"] })]);
    await mail.run("msg.tag", [1, 2, 3], { tag: "work" });
    assert.deepEqual([mail.message("a@x")!.tags, mail.message("b@x")!.tags], [["home"], undefined]);
    await mail.run("msg.undo");
    assert.deepEqual([mail.message("a@x")!.tags, mail.message("b@x")!.tags, mail.message("c@x")!.tags], [["home", "work"], undefined, ["work"]]);
});

test("a tag undo keeps a tag added by hand since", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.tag", [1], { tag: "work" });
    mail.message("a@x")!.tags!.push("home");
    await mail.run("msg.undo");
    assert.deepEqual(mail.message("a@x")!.tags, ["home"]);
});

test("m t on a message with no Message-ID warns and records nothing for it", async () => {
    const mail = mail_store([{ id: 1, folder: "inbox" }, inbox("b@x", 2)]);
    await mail.run("msg.tag", [1, 2], { tag: "work" });
    assert.match(mail.notices.at(-1) ?? "", /^u cannot undo this for 1 of 2 messages/);
    assert.equal(mail.top_items(), 1);
});

test("a tag undo that must put back a tag deleted since fails that item and keeps the step", async () => {
    const mail = mail_store([inbox("a@x", 1, { tags: ["work"] })]);
    await mail.run("msg.tag", [1], { tag: "work" });
    mail.delete_tag("work");
    await mail.run("msg.undo");
    assert.match(mail.notices.at(-1) ?? "", /1 message could not go back: the tag work no longer exists\. The step keeps it\.$/);
    assert.deepEqual(mail.message("a@x")!.tags, []);
    assert.equal(mail.entries(), 1);
});

test("a tag undo of an added tag succeeds when the tag was deleted since", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.tag", [1], { tag: "work" });
    mail.delete_tag("work");
    await mail.run("msg.undo");
    assert.deepEqual(mail.message("a@x")!.tags, []);
    assert.equal(mail.entries(), 0);
});

test("a tag undo of a message that left its folder is refused, then dropped on the next u", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.tag", [1], { tag: "work" });
    mail.drop("a@x");
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 1);
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 0);
});

test("tag entries count toward the stack limit", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    for (let turn = 0; turn < UNDO_STACK_LIMIT + 3; turn++) await mail.run("msg.tag", [1], { tag: "work" });
    assert.equal(mail.entries(), UNDO_STACK_LIMIT);
});

test("a version 1 record keeps its entries and is re-stamped, a version 2 record round trips with a tag entry", () => {
    const moved = { id: "m", kind: "moved", action: "delete", items: [{ header_message_id: "a", from_folder_id: "f", to_folder_ids: ["t"], to_subfolders: false }] };
    const state = { id: "s", kind: "state", field: "read", items: [{ header_message_id: "a", folder_id: "f", old: true }] };
    const tag = { id: "t", kind: "tag", items: [{ header_message_id: "a", folder_id: "f", tag_key: "work", had: false }] };
    const old = migrate_undo_record({ record_version: 1, entries: [moved, state] });
    assert.equal(old?.record_version, 2);
    assert.deepEqual(old?.entries.map((entry) => entry.id), ["m", "s"]);
    assert.deepEqual(migrate_undo_record({ record_version: 2, entries: [moved, state, tag, { id: "bad", kind: "tag", items: [{ header_message_id: "a" }] }] })?.entries.map((entry) => entry.id), ["m", "s", "t"]);
    assert.equal(migrate_undo_record({ record_version: 3, entries: [tag] }), undefined);
});

test("m t and u at once: u waits for the tag entry, so it undoes the tag and not the older delete", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)]);
    await mail.run("msg.delete", [1]);
    await Promise.all([mail.run("msg.tag", [2], { tag: "work" }), mail.run("msg.undo")]);
    assert.deepEqual(mail.places(), ["a@x@trash", "b@x@inbox"]);
    assert.deepEqual(mail.message("b@x")!.tags, []);
});

test("a tag undo picks the copy that still carries the change among two copies of one Message-ID", async () => {
    const mail = mail_store([inbox("a@x", 1, { tags: ["home"] }), inbox("a@x", 2)]);
    await mail.run("msg.tag", [2], { tag: "work" });
    await mail.run("msg.undo");
    assert.deepEqual([mail.message_by_id(1)!.tags, mail.message_by_id(2)!.tags], [["home"], []]);
});

test("u after a move into a folder with no summary parses the folder once, queries again and moves the message back", async () => {
    const mail = mail_store([inbox("a@x", 1)], { unindexed: ["receipts"] });
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox"]);
    assert.deepEqual(mail.parsed, ["receipts"]);
    assert.equal(mail.calls.filter((call) => call.startsWith("index")).length, 1, "one parse, not one per retry");
    assert.deepEqual(mail.notices, ["Undid the move of 1 message."]);
    assert.equal(mail.entries(), 0);
});

test("a folder that is indexed is never parsed, however many messages are missing from it", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.delete", [1]);
    mail.drop("a@x");
    await mail.run("msg.undo");
    assert.deepEqual(mail.calls.filter((call) => call.startsWith("index")), []);
    assert.match(mail.notices.at(-1) ?? "", /no longer in Trash/);
});

test("a move into the folder while it parses fails as busy, and the undo still finishes", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)], { unindexed: ["receipts"], index: "holds" });
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    const undoing = mail.run("msg.undo");
    await mail.parse_start;
    await mail.run("msg.move", [2], { folder: "/Receipts" });
    assert.match(mail.notices.at(-1) ?? "", /busy/);
    assert.deepEqual(mail.places(), ["a@x@receipts", "b@x@inbox"], "the busy move changed nothing");
    assert.equal(mail.entries(), 1, "and left no undo step of its own");
    mail.finish_parse();
    await undoing;
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@inbox"]);
    assert.equal(mail.entries(), 0);
});

test("when FolderLoaded never fires, u refuses with the folder name and the second u parses again and drops the step", async () => {
    const mail = mail_store([inbox("a@x", 1)], { unindexed: ["receipts"], index: "never_loads" });
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    await mail.run("msg.undo");
    assert.equal(mail.notices.at(-1), "Thunderbird has not indexed /Receipts yet, so u cannot find the message. Open the folder once and press u, or press u again to drop this step.");
    assert.equal(mail.entries(), 1);
    assert.deepEqual(mail.places(), ["a@x@receipts"]);
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 0, "the second u drops the step");
    assert.equal(mail.calls.filter((call) => call.startsWith("index")).length, 2, "it tried the folder again");
    assert.deepEqual(mail.places(), ["a@x@receipts"]);
});

test("a step whose folder never indexes no longer blocks an older delete behind it", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)], { unindexed: ["receipts"], index: "never_loads" });
    await mail.run("msg.delete", [2]);
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 2);
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 1, "the second u drops the move step");
    assert.equal(mail.notices.at(-1), "Dropped the move step. Dropped 1 message in the folder of the move, which Thunderbird has not indexed.");
    assert.deepEqual(mail.places(), ["a@x@receipts", "b@x@trash"]);
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@receipts", "b@x@inbox"]);
    assert.equal(mail.entries(), 0);
});

test("a folder that is opened after the refusal lets the second u move the message back", async () => {
    const mail = mail_store([inbox("a@x", 1)], { unindexed: ["receipts"], index: "never_loads" });
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    await mail.run("msg.undo");
    mail.open_folder("receipts");
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox"]);
    assert.equal(mail.entries(), 0);
});

test("an IMAP folder with no summary is refused without a parse, and the second u drops the step", async () => {
    const mail = mail_store([{ id: 1, header: "a@x", folder: "imap-inbox" }], { unindexed: ["imap-receipts"] });
    await mail.run("msg.move", [1], { folder: "/Receipts", account: "Home" });
    await mail.run("msg.undo");
    assert.deepEqual(mail.parsed, [], "no reparse of a folder that is not local");
    assert.equal(mail.notices.at(-1), "Thunderbird has not indexed /Receipts yet, so u cannot find the message. Open the folder once and press u, or press u again to drop this step.");
    assert.equal(mail.entries(), 1);
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 0, "the second u drops the step");
    assert.equal(mail.notices.at(-1), "Dropped the move step. Dropped 1 message in the folder of the move, which Thunderbird has not indexed.");
    assert.deepEqual(mail.places(), ["a@x@imap-receipts"]);
});

test("a step with one copy found and one in an unindexed folder says what it undid and what it dropped", async () => {
    const mail = mail_store([inbox("a@x", 1), { id: 2, header: "b@x", folder: "imap-inbox" }], { unindexed: ["imap-trash"] });
    await mail.run("msg.delete", [1, 2]);
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 1);
    await mail.run("msg.undo");
    assert.equal(mail.notices.at(-1), "Undid the delete of 1 message. Dropped 1 message in Trash, which Thunderbird has not indexed.");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@imap-trash"]);
    assert.equal(mail.entries(), 0);
});

test("a message truly gone from an indexed folder still takes two u, after an unindexed step was refused", async () => {
    const mail = mail_store([inbox("a@x", 1), inbox("b@x", 2)], { unindexed: ["receipts"], index: "never_loads" });
    await mail.run("msg.delete", [2]);
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 2);
    mail.open_folder("receipts");
    await mail.run("msg.undo");
    assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@trash"]);
    mail.drop("b@x");
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 1, "the first u on the vanished delete only refuses");
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 0);
});

test("a parse that finished but left the generic error takes the normal two u, so the step cannot stay forever", async () => {
    const mail = mail_store([inbox("a@x", 1)], { info_fails: ["receipts"] });
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    mail.drop("a@x");
    await mail.run("msg.undo");
    assert.deepEqual(mail.parsed, ["receipts"]);
    assert.match(mail.notices.at(-1) ?? "", /no longer in the folder of the move/);
    assert.equal(mail.entries(), 1);
    await mail.run("msg.undo");
    assert.equal(mail.entries(), 0, "the second u drops the step");
});

test("a step refused earlier gets one parse of its unindexed folder and no retry, and moves the message back", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    mail.hide_next_lookups(4);
    await mail.run("msg.undo");
    assert.match(mail.notices.at(-1) ?? "", /Press u again to drop this step/);
    mail.lose_summary("receipts");
    const queries_before = mail.calls.filter((call) => call.startsWith("query")).length;
    await mail.run("msg.undo");
    assert.deepEqual(mail.parsed, ["receipts"]);
    assert.deepEqual(mail.places(), ["a@x@inbox"]);
    assert.equal(mail.calls.filter((call) => call.startsWith("query")).length - queries_before, 3, "one lookup, one after the parse and the last one, no retry");
    assert.equal(mail.entries(), 0);
});

test("a step refused earlier whose folder stays unindexed drops on the next u instead of refusing forever", async () => {
    const mail = mail_store([inbox("a@x", 1)], { index: "never_loads" });
    await mail.run("msg.move", [1], { folder: "/Receipts" });
    mail.hide_next_lookups(4);
    await mail.run("msg.undo");
    mail.lose_summary("receipts");
    await mail.run("msg.undo");
    assert.equal(mail.calls.filter((call) => call.startsWith("index")).length, 1);
    assert.equal(mail.entries(), 0);
    assert.match(mail.notices.at(-1) ?? "", /Dropped/);
});

test("u after x parses an unindexed year folder below Archives and moves the message back", async () => {
    const mail = mail_store([inbox("a@x", 1)]);
    await mail.run("msg.archive", [1]);
    mail.lose_summary("archives-2026");
    await mail.run("msg.undo");
    assert.deepEqual(mail.parsed, ["archives-2026"]);
    assert.deepEqual(mail.places(), ["a@x@inbox"]);
    assert.equal(mail.entries(), 0);
});

test("u refuses with a message and keeps the step when the Experiment failed to load", async () => {
    const mail = mail_store([inbox("a@x", 1)], { experiment: false });
    await mail.run("msg.move", [1], { folder: "/Work" });
    await mail.run("msg.undo");
    assert.match(mail.notices.at(-1) ?? "", /^Undo needs the DesertBird Experiment, which is not loaded\.$/);
    assert.equal(mail.entries(), 1);
    assert.deepEqual(mail.places(), ["a@x@work"]);
});
