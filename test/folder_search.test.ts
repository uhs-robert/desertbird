import assert from "node:assert/strict";
import { test } from "node:test";
import { create_search_register } from "../src/background/search/register.ts";
import { create_search_service } from "../src/background/search/service.ts";
import { SEARCH_REGISTER_STORAGE_KEY } from "../src/shared/protocol.ts";
import { fake_storage } from "./fake_api.ts";
import { fake_timers } from "./hud_fakes.ts";

const FOLDERS = [
    { id: "r", accountId: "a", path: "/", isRoot: true },
    { id: "inbox", accountId: "a", path: "/Inbox" },
    { id: "work", accountId: "a", path: "/Inbox/Work" },
    { id: "sent", accountId: "a", path: "/Sent" },
    { id: "network", accountId: "a", path: "/Archive/Network" },
    { id: "workshop", accountId: "a", path: "/Workshop" },
];

function setup(options: { focused?: boolean } = {}) {
    const calls: string[] = [];
    const said: string[] = [];
    const state = { shown: "inbox", focused: options.focused ?? true, select_gate: undefined as Promise<void> | undefined, query_gate: undefined as Promise<void> | undefined, focus_works: true };
    const api = {
        folders: { query: async () => FOLDERS },
        mailTabs: {
            query: async () => {
                await state.query_gate;
                return [{ id: 1, displayedFolder: FOLDERS.find((folder) => folder.id === state.shown) }];
            },
            get: async () => ({ displayedFolder: { id: state.shown } }),
            update: async (_id: number, update: { displayedFolder: { id: string } }) => void (calls.push(`open ${update.displayedFolder.id}`), (state.shown = update.displayedFolder.id)),
            setQuickFilter: async () => calls.push("filter"),
        },
        keys: {
            paneFocus: async ({ pane }: { pane: string }) => {
                calls.push(`focus ${pane}`);
                await state.select_gate;
                return state.focus_works;
            },
        },
        folderpane: {
            focused: async () => state.focused,
        },
    };
    const storage = fake_storage();
    const register = create_search_register(storage.api.local);
    const service = create_search_service({ api: api as never, register, timers: fake_timers(), say: async (_w, text) => void said.push(text) });
    return { service, calls, said, state, storage, register };
}

test("typing moves nothing and counts the name matches, case-insensitively", async () => {
    const { service, calls } = setup();
    await service.start(3, "forward");
    assert.deepEqual(await service.type(3, "WORK"), { note: "1 of 3", is_error: false });
    assert.deepEqual(await service.type(3, "zzz"), { note: "Not found: zzz", is_error: true });
    assert.deepEqual(calls, []);
});

test("the name is the last path segment, so a parent's name does not match its children", async () => {
    const { service, said } = setup();
    await service.start(3, "forward");
    await service.commit(3, "inbox");
    assert.match(said.at(-1)!, /1 of 1/);
});

test("Enter opens the first match in tree order, focuses the folder pane and stores a folder register", async () => {
    const { service, calls, said, storage } = setup();
    await service.start(3, "forward");
    await service.commit(3, "work");
    assert.deepEqual(calls, ["open work", "focus folders"]);
    assert.equal(said.at(-1), "1 of 3");
    assert.deepEqual(storage.data[SEARCH_REGISTER_STORAGE_KEY], { text: "work", direction: "forward", kind: "folders" });
});

test("a match in a collapsed parent opens like any other, and the focus returns to the folder pane", async () => {
    const { service, calls } = setup();
    await service.start(3, "forward");
    await service.commit(3, "network");
    assert.deepEqual(calls, ["open network", "focus folders"]);
});

test("no match keeps the line open and moves nothing", async () => {
    const { service, calls } = setup();
    await service.start(3, "forward");
    await assert.rejects(service.commit(3, "zzz"), /Not found: zzz/);
    assert.deepEqual(calls, []);
    await service.commit(3, "sent");
    assert.deepEqual(calls, ["open sent", "focus folders"]);
});

test("n and N step the matches in tree order and wrap", async () => {
    const { service, said, state } = setup();
    await service.start(3, "forward");
    await service.commit(3, "work");
    await service.step(3, "same");
    assert.equal(state.shown, "network");
    await service.step(3, "same");
    assert.equal(state.shown, "workshop");
    assert.equal(said.at(-1), "3 of 3");
    await service.step(3, "same");
    assert.equal(state.shown, "work");
    assert.equal(said.at(-1), "1 of 3, wrapped");
    await service.step(3, "opposite");
    assert.equal(state.shown, "workshop");
    assert.equal(said.at(-1), "3 of 3, wrapped");
});

test("n after a folder search refuses outside the folder pane", async () => {
    const { service, state } = setup();
    await service.start(3, "forward");
    await service.commit(3, "work");
    state.focused = false;
    await assert.rejects(service.step(3, "same"), /folder search/);
});

test("Escape before Enter changes nothing, and Escape while the folder opens puts the first folder back", async () => {
    const { service, calls, state } = setup();
    await service.start(3, "forward");
    await service.cancel(3);
    assert.deepEqual(calls, []);
    await service.start(3, "forward");
    let release = () => {};
    state.select_gate = new Promise<void>((resolve) => (release = resolve));
    const commit = service.commit(3, "sent");
    await new Promise((resolve) => setImmediate(resolve));
    await service.cancel(3);
    state.select_gate = undefined;
    release();
    await assert.rejects(commit, /cancelled/);
    assert.equal(state.shown, "inbox");
});

test("an empty line repeats a folder register and refuses after a thread search", async () => {
    const { service, register, state } = setup();
    await service.start(3, "forward");
    await assert.rejects(service.commit(3, ""), /No earlier search/);
    await register.write({ text: "sent", direction: "forward", kind: "folders" });
    await service.commit(3, "");
    assert.equal(state.shown, "sent");
});

// The thread search reads rows through `keys.viewRows`, which this fake lacks, so an Enter that reaches it fails and opens no folder.
test("with the folder pane unfocused, a forward search is the thread search", async () => {
    const { service, calls } = setup({ focused: false });
    await service.start(3, "forward");
    await assert.rejects(service.commit(3, "sent"));
    assert.deepEqual(calls.filter((call) => call.startsWith("open")), []);
});

test("a backward search is always a thread search, even in the folder pane", async () => {
    const { service, calls } = setup();
    await service.start(3, "backward");
    await assert.rejects(service.commit(3, "sent"));
    assert.deepEqual(calls.filter((call) => call.startsWith("open")), []);
});

test("an Escape while the search opens ends it, so a later keystroke finds no folder search", async () => {
    const { service, state } = setup();
    let release = () => {};
    state.query_gate = new Promise<void>((resolve) => (release = resolve));
    const started = service.start(3, "forward");
    await new Promise((resolve) => setImmediate(resolve));
    await service.cancel(3);
    state.query_gate = undefined;
    release();
    await started;
    await assert.rejects(service.type(3, "x"), /not open/);
});

test("a folder pane that takes no focus is a refusal, not a match", async () => {
    const { service, state, said } = setup();
    await service.start(3, "forward");
    state.focus_works = false;
    await assert.rejects(service.commit(3, "sent"), /did not take the focus/);
    assert.deepEqual(said, []);
});
