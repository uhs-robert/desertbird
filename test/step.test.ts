import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import { find_flagged_row } from "../src/chrome/flag_scan.ts";
import type { FolderpaneViewFindRowArgs, ViewRow } from "../src/shared/protocol.ts";

// `flagged` and `attachment` stand for the bits of the flags word, so a test reads like the list.
interface Flags {
    unread?: boolean;
    flagged?: boolean;
    attachment?: boolean;
}
interface FolderSpec {
    id: string;
    unread: number;
    special?: string[];
    virtual?: boolean;
    root?: boolean;
    /** `getFolderInfo` throws for this folder, as Thunderbird does for one it has not opened. */
    broken?: boolean;
}

// Row ids are index + 100. `flagged_rows` maps a row index to its flags. Folders default to one folder, "f1", that is shown.
function step_fake(options: { rows: number; current: number; flags?: Record<number, Flags>; folders?: FolderSpec[]; shown?: string; count?: number; empty_first_page?: boolean }) {
    const calls: string[] = [];
    const rows = Array.from({ length: options.rows }, (_, index): ViewRow => {
        const marked = options.flags?.[index];
        return { index, id: index + 100, depth: 0, collapsed: false, unread: marked?.unread === true, flags: (marked?.unread ? 0 : 0x1) | (marked?.flagged ? 0x4 : 0) | (marked?.attachment ? 0x10000000 : 0) };
    });
    const folders = options.folders ?? [{ id: "f1", unread: 0 }];
    // A test sets `after_scan` to change the list right after the chrome scan answers.
    const hooks = { after_scan: () => {} };
    const app = {
        viewRows: async ({ first, last }: { first: number; last: number }) => (calls.push(`viewRows ${first} ${last}`), { current: options.current, rows: rows.slice(first, last + 1) }),
        paneFocus: async ({ pane }: { pane: string }) => (calls.push(`focus ${pane}`), true),
    };
    const mailTabs = {
        query: async () => [{ id: 9, displayedFolder: { id: options.shown ?? "f1", accountId: "a", path: "/x" } }],
        update: async (_tab: number, update: { displayedFolder: { id: string } }) => void calls.push(`show ${update.displayedFolder.id}`),
        setSelectedMessages: async (tab_id: number, ids: number[]) => void calls.push(`select ${tab_id} ${ids.join(",")}`),
    };
    const api = {
        app,
        folderpane: {
            viewRowCount: async () => (calls.push("viewRowCount"), rows.length),
            // The chrome scan, over the same rows and flags as viewRows.
            // The chrome scan itself, over the same rows as viewRows. The id is the one the parent converts from the found header.
            viewFindRow: async (search: Omit<FolderpaneViewFindRowArgs, "windowId">) => {
                calls.push(`viewFindRow ${search.from} ${search.forward} ${search.flag} ${search.wanted}`);
                const { index } = find_flagged_row({ rowCount: rows.length, getMsgHdrAt: (at) => rows[at] ?? null }, search);
                const found = { index, id: rows[index]?.id ?? null };
                hooks.after_scan();
                return found;
            },
        },
        mailTabs,
        folders: {
            query: async () => folders.map((folder) => ({ id: folder.id, accountId: "a", path: `/${folder.id}`, specialUse: folder.special, isVirtual: folder.virtual, isRoot: folder.root })),
            getFolderInfo: async (id: string) => {
                calls.push(`info ${id}`);
                const folder = folders.find((candidate) => candidate.id === id);
                if (folder?.broken || folder?.root) throw new Error("An unexpected error occurred");
                return { unreadMessageCount: folder?.unread };
            },
        },
        messages: {
            query: async (query: { folderId: string }) => (calls.push(`query ${query.folderId}`), options.empty_first_page ? { id: "p1", messages: [] } : { messages: [{ id: 900 }] }),
            continueList: async () => (calls.push("continueList"), { messages: [{ id: 900 }] }),
        },
        notifications: { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") },
    } as unknown as RouterApi;
    const run = (command: string, args: Record<string, unknown>) => create_router(registry, api).run({ command, args: args as never, count: options.count ?? 1, windowId: 3, messageIds: [] });
    return {
        run,
        calls: () => calls.filter((call) => !call.startsWith("viewRow") && !call.startsWith("viewFindRow")),
        all: calls,
        rows,
        set after_scan(change: () => void) {
            hooks.after_scan = change;
        },
    };
}

test("the step commands check their typed args", () => {
    const ok = (id: string, args: Record<string, unknown>) => check_args(registry.get(id)!, args).ok;
    assert.equal(ok("step.unread", { direction: "next", scope: "all_folders" }), true);
    assert.equal(ok("step.unread", { direction: "next" }), true);
    assert.equal(ok("step.unread", { direction: "next", scope: "world" }), false);
    assert.equal(ok("step.starred", { direction: "previous" }), true);
    assert.equal(ok("step.attachment", {}), false);
});

test("] and [ bind the step keys and the keymap still compiles", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    assert.deepEqual(normal["]u"], { id: "step.unread", args: { direction: "next", scope: "folder" }, label: "Unread" });
    assert.deepEqual(normal["[U"], { id: "step.unread", args: { direction: "previous", scope: "all_folders" }, label: "Unread in all folders" });
    assert.deepEqual(normal["]s"], { id: "step.starred", args: { direction: "next" }, label: "Starred" });
    assert.deepEqual(normal["[a"], { id: "step.attachment", args: { direction: "previous" }, label: "Attachment" });
    assert.deepEqual(compile_default_keymap().warnings ?? [], []);
});

test("] u selects the next unread row and [ u the previous one", async () => {
    const flags = { 1: { unread: true }, 4: { unread: true }, 7: { unread: true } };
    const forward = step_fake({ rows: 10, current: 4, flags });
    await forward.run("step.unread", { direction: "next", scope: "folder" });
    assert.deepEqual(forward.calls(), ["select 9 107"]);
    const backward = step_fake({ rows: 10, current: 4, flags });
    await backward.run("step.unread", { direction: "previous", scope: "folder" });
    assert.deepEqual(backward.calls(), ["select 9 101"]);
});

test("a count steps that many matches and stops at the last one", async () => {
    const flags = { 2: { flagged: true }, 5: { flagged: true }, 8: { flagged: true } };
    const two = step_fake({ rows: 10, current: 0, flags, count: 2 });
    await two.run("step.starred", { direction: "next" });
    assert.deepEqual(two.calls(), ["select 9 105"]);
    const many = step_fake({ rows: 10, current: 0, flags, count: 9 });
    await many.run("step.starred", { direction: "next" });
    assert.deepEqual(many.calls(), ["select 9 108"]);
});

test("] a finds an attachment in a later block of rows", async () => {
    const fake = step_fake({ rows: 1200, current: 3, flags: { 1100: { attachment: true } } });
    await fake.run("step.attachment", { direction: "next" });
    assert.deepEqual(fake.calls(), ["select 9 1200"]);
    const back = step_fake({ rows: 1200, current: 1190, flags: { 20: { attachment: true } } });
    await back.run("step.attachment", { direction: "previous" });
    assert.deepEqual(back.calls(), ["select 9 120"]);
});

test("with no match the step says so and moves nothing", async () => {
    const fake = step_fake({ rows: 5, current: 2, flags: { 1: { flagged: true } } });
    await fake.run("step.starred", { direction: "next" });
    assert.deepEqual(fake.calls(), ["notify No later starred message."]);
    await fake.run("step.unread", { direction: "previous", scope: "folder" });
    assert.equal(fake.calls().at(-1), "notify No earlier unread message.");
});

test("] U with no unread row left goes to the next folder that has unread mail, skipping Trash and virtual folders, and wraps", async () => {
    const folders: FolderSpec[] = [{ id: "a", unread: 2 }, { id: "b", unread: 0 }, { id: "c", unread: 9, special: ["trash"] }, { id: "d", unread: 4, virtual: true }, { id: "e", unread: 1 }];
    const fake = step_fake({ rows: 3, current: 1, folders, shown: "b" });
    await fake.run("step.unread", { direction: "next", scope: "all_folders" });
    assert.deepEqual(fake.calls().filter((call) => !call.startsWith("info")), ["query e", "show e", "focus threads", "select 9 900"]);
    const wrap = step_fake({ rows: 3, current: 1, folders, shown: "e" });
    await wrap.run("step.unread", { direction: "next", scope: "all_folders" });
    assert.deepEqual(wrap.calls().filter((call) => !call.startsWith("info")), ["query a", "show a", "focus threads", "select 9 900"]);
    const back = step_fake({ rows: 3, current: 1, folders, shown: "e" });
    await back.run("step.unread", { direction: "previous", scope: "all_folders" });
    assert.deepEqual(back.calls().filter((call) => !call.startsWith("info")), ["query a", "show a", "focus threads", "select 9 900"]);
});

test("] U prefers an unread row in the shown folder to any other folder", async () => {
    const fake = step_fake({ rows: 4, current: 0, flags: { 3: { unread: true } }, folders: [{ id: "a", unread: 5 }, { id: "b", unread: 5 }], shown: "a" });
    await fake.run("step.unread", { direction: "next", scope: "all_folders" });
    assert.deepEqual(fake.calls(), ["select 9 103"]);
});

test("] U refuses when no folder has unread mail, and ] u never leaves the folder", async () => {
    const folders: FolderSpec[] = [{ id: "a", unread: 0 }, { id: "b", unread: 0 }];
    const none = step_fake({ rows: 3, current: 1, folders, shown: "a" });
    await none.run("step.unread", { direction: "next", scope: "all_folders" });
    assert.equal(none.calls().at(-1), "notify No later unread message.");
    const stay = step_fake({ rows: 3, current: 1, folders: [{ id: "a", unread: 0 }, { id: "b", unread: 5 }], shown: "a" });
    await stay.run("step.unread", { direction: "next", scope: "folder" });
    assert.deepEqual(stay.calls(), ["notify No later unread message."]);
});

test("] U in an empty folder with no current row still goes to a folder with unread mail", async () => {
    const fake = step_fake({ rows: 0, current: -1, folders: [{ id: "a", unread: 0 }, { id: "b", unread: 3 }], shown: "a" });
    await fake.run("step.unread", { direction: "next", scope: "all_folders" });
    assert.deepEqual(fake.calls().filter((call) => !call.startsWith("info")), ["query b", "show b", "focus threads", "select 9 900"]);
});

test("] U goes on to the next page when the first one comes back empty", async () => {
    const fake = step_fake({ rows: 3, current: 1, folders: [{ id: "a", unread: 0 }, { id: "b", unread: 3 }], shown: "a", empty_first_page: true });
    await fake.run("step.unread", { direction: "next", scope: "all_folders" });
    assert.deepEqual(fake.calls().filter((call) => !call.startsWith("info")), ["query b", "continueList", "show b", "focus threads", "select 9 900"]);
});

test("] U skips root folders and folders whose unread count Thunderbird cannot read", async () => {
    const folders: FolderSpec[] = [{ id: "r", unread: 0, root: true }, { id: "a", unread: 0 }, { id: "b", unread: 9, broken: true }, { id: "c", unread: 2 }];
    const fake = step_fake({ rows: 3, current: 1, folders, shown: "a" });
    await fake.run("step.unread", { direction: "next", scope: "all_folders" });
    assert.deepEqual(fake.calls().filter((call) => !call.startsWith("info")), ["query c", "show c", "focus threads", "select 9 900"]);
    assert.equal(fake.calls().includes("info r"), false);
});

test("with no row selected ] steps from before the first row and [ from after the last", async () => {
    const flags = { 2: { flagged: true }, 5: { flagged: true } };
    const forward = step_fake({ rows: 8, current: -1, flags });
    await forward.run("step.starred", { direction: "next" });
    assert.deepEqual(forward.calls(), ["select 9 102"]);
    const backward = step_fake({ rows: 8, current: -1, flags });
    await backward.run("step.starred", { direction: "previous" });
    assert.deepEqual(backward.calls(), ["select 9 105"]);
});

test("[ with no row selected in a list of exactly one block finds the last row", async () => {
    const fake = step_fake({ rows: 500, current: -1, flags: { 499: { unread: true } } });
    await fake.run("step.unread", { direction: "previous", scope: "folder" });
    assert.deepEqual(fake.calls(), ["select 9 599"]);
});

test("[ with no row selected asks the row count once and reads only the last block, not the whole list", async () => {
    const fake = step_fake({ rows: 5000, current: -1, flags: { 4990: { unread: true } } });
    await fake.run("step.unread", { direction: "previous", scope: "folder" });
    assert.deepEqual(fake.calls(), ["select 9 5090"]);
    assert.deepEqual(fake.all.filter((call) => call.startsWith("view")), ["viewRows 0 0", "viewRowCount", "viewFindRow 4999 false unread 1", "viewRows 4990 4990"]);
});

test("] u finds an unread row far ahead with one scan and one row read, and with none ahead it reads no blocks", async () => {
    const far = step_fake({ rows: 10000, current: 0, flags: { 9000: { unread: true } } });
    await far.run("step.unread", { direction: "next", scope: "folder" });
    assert.deepEqual(far.calls(), ["select 9 9100"]);
    assert.deepEqual(far.all.filter((call) => call.startsWith("view")), ["viewRows 0 0", "viewFindRow 1 true unread 1", "viewRows 9000 9000"]);
    const none = step_fake({ rows: 10000, current: 0 });
    await none.run("step.unread", { direction: "next", scope: "folder" });
    assert.deepEqual(none.calls(), ["notify No later unread message."]);
    assert.deepEqual(none.all.filter((call) => call.startsWith("view")), ["viewRows 0 0", "viewFindRow 1 true unread 1"]);
});

// A quick filter that lands between the scan and the row read moves the rows, so the found index names another message. The step refuses and selects nothing.
test("a quick filter that empties the found row during the scan makes the step refuse and select nothing", async () => {
    const fake = step_fake({ rows: 2000, current: 0, flags: { 1500: { unread: true } } });
    const narrowed = fake.rows.filter((row) => row.index % 2 === 0).map((row, index) => ({ ...row, index, unread: false }));
    fake.after_scan = () => void fake.rows.splice(0, fake.rows.length, ...narrowed);
    await fake.run("step.unread", { direction: "next", scope: "folder" });
    assert.deepEqual(fake.calls(), ["notify The list changed during the step. Press the key again."]);
});

// New mail inserted above the found row shifts every row down one, so the index now holds another starred message.
test("a shift that puts another flagged row at the found index refuses, and an unchanged view selects the found message", async () => {
    const flags = { 1: { flagged: true }, 2: { flagged: true } };
    // From row 1 the scan finds row 2. After the shift row 2 holds the starred message of row 1.
    const shifted = step_fake({ rows: 10, current: 1, flags });
    shifted.after_scan = () => {
        const moved = shifted.rows.map((row) => ({ ...row, index: row.index + 1 }));
        shifted.rows.splice(0, shifted.rows.length, { index: 0, id: 999, depth: 0, collapsed: false, unread: false, flags: 0x1 }, ...moved);
    };
    await shifted.run("step.starred", { direction: "next" });
    assert.deepEqual(shifted.calls(), ["notify The list changed during the step. Press the key again."]);
    const unchanged = step_fake({ rows: 10, current: 1, flags });
    await unchanged.run("step.starred", { direction: "next" });
    assert.deepEqual(unchanged.calls(), ["select 9 102"]);
});
