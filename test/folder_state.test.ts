import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import type { MailFolder } from "../src/background/handlers/displayed_folder.ts";
import { FOLDER_STATE_KEY, empty_folder_state, migrate_folder_state, read_folder_state } from "../src/background/handlers/folder_state.ts";
import type { FolderState } from "../src/background/handlers/folder_state.ts";
import { start_jump_history } from "../src/background/handlers/jump_history.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import { fake_api } from "./fake_api.ts";

const folder = (path: string, account = "a1"): MailFolder => ({ id: `${account}:${path}`, accountId: account, path });
const A = folder("/A");
const B = folder("/B");
const C = folder("/C");
const D = folder("/D");
const ALL = [A, B, C, D];

const run = (api: RouterApi, command: string, count = 1) => create_router(registry, api).run({ command, args: {}, count, windowId: 3, messageIds: [] });
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify")).map((call) => call.slice(7));
const updates = (calls: string[]) => calls.filter((call) => call.startsWith("mailTabs.update")).map((call) => call.split(" ")[2]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Shows the folders in order the way a click would: through the API, with the history listening. */
async function visit(api: RouterApi, ...folders: MailFolder[]) {
    for (const shown of folders) await api.mailTabs.update(1, { displayedFolder: shown });
    await settle();
}

const stored = (storage: Record<string, unknown>) => storage[FOLDER_STATE_KEY] as FolderState;

test("a record of the current version reads back as stored", () => {
    const state: FolderState = { record_version: 1, marks: { a: { account_id: "a1", path: "/A" } }, history: { entries: [{ account_id: "a1", path: "/A" }], cursor: 0 } };
    assert.deepEqual(migrate_folder_state(state), state);
});

test("a missing, damaged or newer record reads as empty", () => {
    const newer = { ...empty_folder_state(), record_version: 99 };
    const damaged_cursor = { ...empty_folder_state(), history: { entries: [], cursor: 4 } };
    const damaged_mark = { ...empty_folder_state(), marks: { a: "/A" } };
    for (const value of [undefined, null, "text", [], {}, { record_version: "1" }, newer, damaged_cursor, damaged_mark]) assert.deepEqual(migrate_folder_state(value), empty_folder_state());
});

test("an old record migrates one version at a time and a gap in the chain reads as empty", () => {
    // Version 0 kept one marks list of [slot, path] pairs and no history. Version 1 is the current shape.
    const old = { record_version: 0, marks: [["a", "/A"]] };
    const migrations = { 0: (record: Record<string, unknown>) => ({ marks: Object.fromEntries((record.marks as string[][]).map(([slot, path]) => [slot, { account_id: "a1", path }])), history: { entries: [], cursor: -1 } }) };
    assert.deepEqual(migrate_folder_state(old, migrations, 1), { record_version: 1, marks: { a: { account_id: "a1", path: "/A" } }, history: { entries: [], cursor: -1 } });
    assert.deepEqual(migrate_folder_state(old, {}, 1), empty_folder_state());
});

test("the next command reads what an outside write left in storage", async () => {
    const storage: Record<string, unknown> = {};
    const { api, calls } = fake_api({ folders: ALL, displayed: A, storage });
    assert.deepEqual((await read_folder_state(api)).marks, {});
    storage[FOLDER_STATE_KEY] = { ...empty_folder_state(), marks: { b: { account_id: "a1", path: "/B" } } };
    await run(api, "mark.jump", 1);
    await create_router(registry, api).run({ command: "mark.jump", args: { slot: "b" }, count: 1, windowId: 3, messageIds: [] });
    assert.deepEqual(updates(calls), ["a1:/B"]);
});

test("a visit adds an entry, a repeat adds none and a new visit after a jump back drops the entries ahead", async () => {
    const storage: Record<string, unknown> = {};
    const { api } = fake_api({ folders: ALL, displayed: A, storage });
    start_jump_history(api);
    await visit(api, B, B, C);
    assert.deepEqual(stored(storage).history.entries.map((entry) => entry.path), ["/B", "/C"]);
    await run(api, "jump.back");
    await visit(api, D);
    assert.deepEqual(stored(storage).history.entries.map((entry) => entry.path), ["/B", "/D"]);
    assert.equal(stored(storage).history.cursor, 1);
});

test("a jump records nothing of its own: back then forward walks the same entries", async () => {
    const storage: Record<string, unknown> = {};
    const { api, calls, displayed } = fake_api({ folders: ALL, displayed: A, storage });
    start_jump_history(api);
    await visit(api, B, C, D);
    await run(api, "jump.back");
    await settle();
    assert.equal(displayed()?.path, "/C");
    assert.deepEqual(stored(storage).history.entries.map((entry) => entry.path), ["/B", "/C", "/D"]);
    assert.equal(stored(storage).history.cursor, 1);
    await run(api, "jump.forward");
    await settle();
    assert.equal(displayed()?.path, "/D");
    assert.equal(stored(storage).history.cursor, 2);
    assert.deepEqual(notifications(calls), []);
});

test("a held <C-o> walks back one entry per press, in order, with no entry lost to the display events", async () => {
    const storage: Record<string, unknown> = {};
    const { api, displayed } = fake_api({ folders: ALL, displayed: A, storage });
    start_jump_history(api);
    await visit(api, B, C, D);
    await Promise.all([run(api, "jump.back"), run(api, "jump.back")]);
    await settle();
    assert.equal(displayed()?.path, "/B");
    assert.equal(stored(storage).history.entries.length, 3);
});

test("a count goes that many entries back and stops at the end of the history", async () => {
    const storage: Record<string, unknown> = {};
    const { api, calls, displayed } = fake_api({ folders: ALL, displayed: A, storage });
    start_jump_history(api);
    await visit(api, B, C, D);
    await run(api, "jump.back", 2);
    assert.equal(displayed()?.path, "/B");
    await run(api, "jump.back", 5);
    assert.deepEqual(notifications(calls), ["There is no earlier folder in the history."]);
    await run(api, "jump.forward", 9);
    assert.equal(displayed()?.path, "/D");
    await run(api, "jump.forward");
    assert.deepEqual(notifications(calls).at(-1), "There is no later folder in the history.");
});

test("a jump skips an entry whose folder is gone", async () => {
    const storage: Record<string, unknown> = {};
    const first = fake_api({ folders: ALL, displayed: A, storage });
    start_jump_history(first.api);
    await visit(first.api, B, C, D);
    const later = fake_api({ folders: [A, B, D], displayed: D, storage });
    await run(later.api, "jump.back");
    assert.equal(later.displayed()?.path, "/B");
});

test("the history survives a background restart and holds at most 100 entries", async () => {
    const storage: Record<string, unknown> = {};
    const first = fake_api({ folders: ALL, displayed: A, storage });
    start_jump_history(first.api);
    for (let round = 0; round < 60; round++) await visit(first.api, B, C);
    assert.equal(stored(storage).history.entries.length, 100);
    const restarted = fake_api({ folders: ALL, displayed: C, storage });
    await run(restarted.api, "jump.back");
    assert.equal(restarted.displayed()?.path, "/B");
});

test("an account root or a missing folder in the display event is not recorded", async () => {
    const storage: Record<string, unknown> = {};
    const { api } = fake_api({ folders: ALL, displayed: A, storage });
    const listeners: ((tab: { id: number }, folder?: MailFolder) => void)[] = [];
    api.mailTabs.onDisplayedFolderChanged = { addListener: (listener) => void listeners.push(listener) };
    start_jump_history(api);
    listeners[0]?.({ id: 1 }, { ...B, isRoot: true } as MailFolder);
    listeners[0]?.({ id: 1 });
    await settle();
    assert.equal(storage[FOLDER_STATE_KEY], undefined);
});

test("a jump whose display fails keeps the cursor where it was", async () => {
    const storage: Record<string, unknown> = {};
    const { api, calls } = fake_api({ folders: ALL, displayed: A, storage });
    start_jump_history(api);
    await visit(api, B, C);
    api.mailTabs.update = (async () => {
        throw new Error("The folder is locked");
    }) as typeof api.mailTabs.update;
    await run(api, "jump.back");
    assert.match(notifications(calls)[0] as string, /locked/);
    assert.equal(stored(storage).history.cursor, 1);
});
