import assert from "node:assert/strict";
import { test } from "node:test";
import { ACT_REFUSALS, MAX_ACT_IDS, create_bridge_acts } from "../src/background/bridge/acts.ts";
import type { ActSettings, ActsApi } from "../src/background/bridge/acts.ts";
import type { ConfirmRequest, ConfirmResult } from "../src/background/bridge/confirm.ts";
import { never_listed } from "../src/background/bridge/run.ts";
import { registry } from "../src/background/commands/index.ts";
import { SETTING_DEFAULTS } from "../src/background/config/settings.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import { create_undo_log } from "../src/background/undo_log.ts";
import { fake_storage } from "./fake_api.ts";

interface Folder {
    id: string;
    accountId: string;
    path: string;
    name: string;
    specialUse?: string[];
    isRoot?: boolean;
    isVirtual?: boolean;
}

const FOLDERS: Folder[] = [
    { id: "a1-root", accountId: "a1", path: "/", name: "Work", isRoot: true },
    { id: "inbox", accountId: "a1", path: "/Inbox", name: "Inbox", specialUse: ["inbox"] },
    { id: "work", accountId: "a1", path: "/Work", name: "Work" },
    { id: "trash", accountId: "a1", path: "/Trash", name: "Trash", specialUse: ["trash"] },
    { id: "archives", accountId: "a1", path: "/Archives", name: "Archives", specialUse: ["archives"] },
    { id: "saved", accountId: "a1", path: "/Saved", name: "Saved", isVirtual: true },
    { id: "imap-inbox", accountId: "a2", path: "/INBOX", name: "INBOX", specialUse: ["inbox"] },
    { id: "imap-trash", accountId: "a2", path: "/Trash", name: "Trash", specialUse: ["trash"] },
    { id: "nt-inbox", accountId: "a3", path: "/Inbox", name: "Inbox", specialUse: ["inbox"] },
];

interface Stored {
    id: number;
    header: string;
    folder: string;
    subject?: string | undefined;
    author?: string | undefined;
}

const inbox = (header: string, id: number, more: Partial<Stored> = {}): Stored => ({ id, header, folder: "inbox", subject: `Subject ${header}`, author: `Sender <${header}>`, ...more });

/** A mail store that behaves as the API does where the act depends on it: a move gives a message a new id, an archive files into a year folder, and `messages.delete` would delete a message in Trash for good. */
function acts_under_test(stored: Stored[], options: { settings?: Partial<ActSettings>; answer?: ConfirmResult; fail_move_after?: number; archive_skips?: string[] } = {}) {
    const folders = structuredClone(FOLDERS);
    const box = new Map(stored.map((message) => [message.id, { ...message }]));
    let next_id = 100;
    const calls: string[] = [];
    const prompts: ConfirmRequest[] = [];
    const settings: ActSettings = { bridge: true, bridge_allow_actions: true, bridge_share_folders: true, ...options.settings };
    let moves_left = options.fail_move_after ?? Infinity;
    const folder = (id: string) => folders.find((entry) => entry.id === id)!;
    const known = (id: number) => {
        const message = box.get(id);
        if (message === undefined) throw new Error(`Message not found: ${id}.`);
        return message;
    };
    const relocate = (ids: number[], folder_id: string) => {
        for (const id of ids) {
            if (moves_left-- <= 0) throw new Error("move failed: Subject secret");
            const message = known(id);
            box.delete(id);
            box.set(next_id, { ...message, id: next_id++, folder: folder_id });
        }
    };
    const header_of = (message: Stored) => ({ id: message.id, date: new Date(0), headerMessageId: message.header, ...(message.subject !== undefined && { subject: message.subject }), ...(message.author !== undefined && { author: message.author }), folder: { ...folder(message.folder) } });
    const log = create_undo_log({ storage: fake_storage().api });
    let on_prompt: () => void = () => {};
    const api = {
        messages: {
            get: async (id: number) => header_of(known(id)),
            delete: async (ids: number[]) => void calls.push(`delete ${ids.join(",")}`),
            archive: async (ids: number[]) => {
                calls.push(`archive ${ids.join(",")}`);
                if (!folders.some((entry) => entry.id === "archives-2026")) folders.push({ id: "archives-2026", accountId: "a1", path: "/Archives/2026", name: "2026" });
                // The archiver skips a message whose identity has archiving off, and still resolves.
                relocate(ids.filter((id) => !options.archive_skips?.includes(known(id).header)), "archives-2026");
            },
            move: async (ids: number[], folder_id: string) => {
                calls.push(`move ${ids.join(",")} ${folder_id}`);
                relocate(ids, folder_id);
            },
            query: async (query: { headerMessageId?: string; folderId?: string; includeSubFolders?: boolean }) => {
                const base = query.folderId === undefined ? undefined : folder(query.folderId);
                const inside = (message: Stored) => base === undefined || message.folder === base.id || (query.includeSubFolders === true && folder(message.folder).path.startsWith(`${base.path}/`));
                return { messages: [...box.values()].filter((message) => message.header === query.headerMessageId && inside(message)).map(header_of) };
            },
            continueList: async () => ({ messages: [] }),
        },
        folderpane: { indexFolder: async () => true },
        folders: {
            getFolderInfo: async () => ({}),
            get: async (folder_id: string) => {
                const found = folders.find((entry) => entry.id === folder_id);
                if (found === undefined) throw new Error(`Folder not found: ${folder_id}`);
                return found;
            },
            query: async (query: { accountId?: string; specialUse?: string[] }) => folders.filter((entry) => (query.accountId === undefined || entry.accountId === query.accountId) && (query.specialUse === undefined || query.specialUse.some((use) => entry.specialUse?.includes(use)))),
        },
        accounts: { list: async () => [{ id: "a1", name: "Work" }, { id: "a2", name: "Home" }] },
        notifications: { create: async () => "n1" },
        keys: undefined,
        undo: { log, retry_delays_ms: [1, 1] },
    };
    const acts = create_bridge_acts({
        api: api as unknown as ActsApi,
        read_settings: async () => ({ ...settings }),
        request_confirm: async (request) => {
            prompts.push(request);
            on_prompt();
            return options.answer ?? "yes";
        },
        target_window: async () => 3,
    });
    const router = create_router(registry, api as unknown as RouterApi);
    return {
        act: (request: Record<string, unknown>) => acts.act({ verb: "act", request_id: 1, ...request }),
        calls,
        prompts,
        settings,
        places: () => [...box.values()].map((message) => `${message.header}@${message.folder}`).sort(),
        id_of: (header: string) => [...box.values()].find((message) => message.header === header)!.id,
        undo: () => router.run({ command: "msg.undo", args: {}, count: 1, windowId: 3, messageIds: [] }),
        during_prompt: (run: () => void) => void (on_prompt = run),
        move_away: (id: number, folder_id: string) => relocate([id], folder_id),
        remove_folder: (id: string) => void folders.splice(folders.findIndex((entry) => entry.id === id), 1),
        moves: () => calls.filter((call) => /^(move|archive|delete)/.test(call)),
    };
}

test("bridge_allow_actions defaults to off", () => {
    assert.equal(SETTING_DEFAULTS.bridge_allow_actions, false);
});

test("with bridge or bridge_allow_actions off the act answers off, prompts nothing and moves nothing", async () => {
    for (const settings of [{ bridge: false }, { bridge_allow_actions: false }]) {
        const mail = acts_under_test([inbox("a@x", 1)], { settings });
        assert.deepEqual(await mail.act({ action: "archive", ids: [1] }), ACT_REFUSALS.off);
        assert.deepEqual(mail.prompts, []);
        assert.deepEqual(mail.moves(), []);
    }
});

test("a move with folder sharing off answers off before it looks the folder up", async () => {
    const mail = acts_under_test([inbox("a@x", 1)], { settings: { bridge_share_folders: false } });
    assert.deepEqual(await mail.act({ action: "move", ids: [1], folder: "no-such-folder" }), ACT_REFUSALS.off);
    assert.deepEqual(await mail.act({ action: "move", ids: [1], folder: "work" }), ACT_REFUSALS.off);
    assert.deepEqual(mail.prompts, []);
    assert.deepEqual((await acts_under_test([inbox("a@x", 1)], { settings: { bridge_share_folders: false } }).act({ action: "archive", ids: [1] })).ok, true, "archive needs no folder sharing");
});

test("a bad frame is refused before the settings or any message is read", async () => {
    const mail = acts_under_test([inbox("a@x", 1)], { settings: { bridge: false } });
    const many = Array.from({ length: MAX_ACT_IDS + 1 }, (_, index) => index + 1);
    const bad: Record<string, unknown>[] = [
        { action: "delete", ids: [1] },
        { action: "archive" },
        { action: "archive", ids: [] },
        { action: "archive", ids: many },
        { action: "archive", ids: [1, 1] },
        { action: "archive", ids: [0] },
        { action: "archive", ids: [1.5] },
        { action: "archive", ids: ["1"] },
        { action: "archive", ids: [1], folder: "work" },
        { action: "trash", ids: [1], folder: "work" },
        { action: "move", ids: [1] },
        { action: "move", ids: [1], folder: "" },
        { action: "move", ids: [1], folder: "x".repeat(1025) },
        { action: "move", ids: [1], folder: 7 },
        { action: "archive", ids: [1], skip_trash: true },
    ];
    for (const request of bad) assert.deepEqual(await mail.act(request), ACT_REFUSALS.bad_request, JSON.stringify(request).slice(0, 80));
    assert.deepEqual(mail.prompts, []);
    const fifty = acts_under_test(Array.from({ length: MAX_ACT_IDS }, (_, index) => inbox(`m${index}@x`, index + 1)));
    assert.deepEqual(await fifty.act({ action: "archive", ids: Array.from({ length: MAX_ACT_IDS }, (_, index) => index + 1) }), { ok: true, count: MAX_ACT_IDS });
});

test("one missing id or a missing or unlisted folder refuses the whole act before the prompt", async () => {
    const mail = acts_under_test([inbox("a@x", 1), inbox("b@x", 2)]);
    assert.deepEqual(await mail.act({ action: "archive", ids: [1, 99] }), ACT_REFUSALS.no_such_message);
    for (const folder of ["gone", "a1-root", "saved"]) assert.deepEqual(await mail.act({ action: "move", ids: [1], folder }), ACT_REFUSALS.no_such_folder, folder);
    assert.deepEqual(mail.prompts, []);
    assert.deepEqual(mail.moves(), []);
    const no_trash = acts_under_test([inbox("a@x", 1), inbox("n@x", 2, { folder: "nt-inbox" })]);
    assert.deepEqual(await no_trash.act({ action: "trash", ids: [1, 2] }), ACT_REFUSALS.no_such_folder, "an account with no Trash");
    assert.deepEqual(no_trash.prompts, []);
});

test("nothing moves unless the prompt answers yes, and each other answer has its own text", async () => {
    for (const [answer, reply] of [
        ["no", ACT_REFUSALS.denied],
        ["timeout", ACT_REFUSALS.timed_out],
        ["busy", ACT_REFUSALS.busy],
    ] as const) {
        const mail = acts_under_test([inbox("a@x", 1)], { answer });
        assert.deepEqual(await mail.act({ action: "trash", ids: [1] }), reply, answer);
        assert.deepEqual(mail.moves(), [], answer);
        assert.deepEqual(mail.places(), ["a@x@inbox"]);
    }
});

test("the prompt lists every message, with an empty text for a missing subject or sender, and the target folder name", async () => {
    const mail = acts_under_test([inbox("a@x", 1), inbox("b@x", 2, { subject: undefined, author: undefined })]);
    await mail.act({ action: "move", ids: [1, 2], folder: "work" });
    assert.deepEqual(mail.prompts, [
        {
            action: "move",
            count: 2,
            items: [
                { subject: "Subject a@x", from: "Sender <a@x>" },
                { subject: "", from: "" },
            ],
            target_folder_name: "Work (Work)",
        },
    ]);
});

test("archive, trash and move on yes answer only a count, and u reverses each like a key move", async () => {
    for (const [request, after] of [
        [{ action: "archive", ids: [1, 2] }, ["a@x@archives-2026", "b@x@archives-2026"]],
        [{ action: "move", ids: [1, 2], folder: "work" }, ["a@x@work", "b@x@work"]],
        [{ action: "trash", ids: [1, 2] }, ["a@x@trash", "b@x@imap-trash"]],
    ] as const) {
        const mail = acts_under_test([inbox("a@x", 1), inbox("b@x", 2, { folder: "imap-inbox" })]);
        const reply = await mail.act(request);
        assert.deepEqual(reply, { ok: true, count: 2 }, request.action);
        assert.deepEqual(Object.keys(reply).sort(), ["count", "ok"]);
        assert.deepEqual(mail.places(), after, request.action);
        await mail.undo();
        assert.deepEqual(mail.places(), ["a@x@inbox", "b@x@imap-inbox"], `${request.action} undone`);
    }
});

test("trash moves to each account's Trash and never deletes, so a message already in Trash stays", async () => {
    const mail = acts_under_test([inbox("a@x", 1), inbox("t@x", 2, { folder: "trash" })]);
    assert.deepEqual(await mail.act({ action: "trash", ids: [1, 2] }), { ok: false, message: "moved 1 of 2" }, "a message already in Trash did not move");
    assert.deepEqual(mail.moves(), ["move 1 trash"]);
    assert.deepEqual(mail.places(), ["a@x@trash", "t@x@trash"]);
});

test("a setting turned off during the prompt moves nothing and answers off", async () => {
    for (const setting of ["bridge", "bridge_allow_actions", "bridge_share_folders"] as const) {
        const mail = acts_under_test([inbox("a@x", 1)]);
        mail.during_prompt(() => (mail.settings[setting] = false));
        assert.deepEqual(await mail.act({ action: "move", ids: [1], folder: "work" }), ACT_REFUSALS.off, setting);
        assert.deepEqual(mail.moves(), [], setting);
    }
});

test("a message moved by hand during the prompt is left out and counted as not moved", async () => {
    const mail = acts_under_test([inbox("a@x", 1), inbox("b@x", 2)]);
    mail.during_prompt(() => mail.move_away(2, "work"));
    assert.deepEqual(await mail.act({ action: "archive", ids: [1, 2] }), { ok: false, message: "moved 1 of 2" });
    assert.deepEqual(mail.places(), ["a@x@archives-2026", "b@x@work"]);
    const target_gone = acts_under_test([inbox("a@x", 1)]);
    target_gone.during_prompt(() => target_gone.remove_folder("work"));
    assert.deepEqual(await target_gone.act({ action: "move", ids: [1], folder: "work" }), ACT_REFUSALS.no_such_folder);
    assert.deepEqual(target_gone.moves(), []);
});

test("a move that fails part way answers moved n of m with no mail text", async () => {
    const mail = acts_under_test([inbox("a@x", 1), inbox("b@x", 2), inbox("c@x", 3)], { fail_move_after: 1 });
    const reply = await mail.act({ action: "move", ids: [1, 2, 3], folder: "work" });
    assert.deepEqual(reply, { ok: false, message: "moved 1 of 3" });
});

test("no registry command is added, and msg.delete and the rest of the never-list stay refused", () => {
    for (const id of ["msg.delete", "msg.move", "msg.archive", "msg.junk", "msg.snooze", "msg.reply", "msg.forward", "msg.new", "msg.reply_with", "msg.undo", "repeat.last", "mark.set", "search.message", "search.threads"]) assert.ok(never_listed(id), id);
    assert.deepEqual(
        registry.list().filter((command) => /act|confirm|trash/.test(command.id)),
        [],
    );
});

test("an archive that resolves but skips a message answers moved n of m", async () => {
    const mail = acts_under_test([inbox("a@x", 1), inbox("b@x", 2)], { archive_skips: ["b@x"] });
    assert.deepEqual(await mail.act({ action: "archive", ids: [1, 2] }), { ok: false, message: "moved 1 of 2" });
    assert.deepEqual(mail.places(), ["a@x@archives-2026", "b@x@inbox"]);
});
