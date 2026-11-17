import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_query, describe_match, nearest_match, opposite, step_match } from "../vendor/desertfox/find_match.ts";
import type { QuickFilter } from "../src/background/handlers/view.ts";
import { apply_filter } from "../src/background/handlers/view.ts";
import { create_search_register } from "../src/background/search/register.ts";
import { SEARCH_DEBOUNCE_MS, create_search_service } from "../src/background/search/service.ts";
import { SEARCH_REGISTER_STORAGE_KEY } from "../src/shared/protocol.ts";
import { fake_storage } from "./fake_api.ts";
import { fake_timers } from "./hud_fakes.ts";

// --- the vendored matcher

test("a plain lower case query is case folded and a capital makes it exact", () => {
    assert.equal(compile_query("")?.search, undefined);
    assert.equal(compile_query("foo")?.search.kind, "folded");
    assert.equal(compile_query("Foo")?.search.kind, "literal");
});

test("a regex runs as a regex, and an invalid or costly one falls back to its own characters", () => {
    assert.equal(compile_query("a.c")?.search.kind, "regex");
    const invalid = compile_query("a(");
    assert.deepEqual([invalid?.search.kind, invalid?.fallback], ["folded", "invalid"]);
    const costly = compile_query("(a+)+b");
    assert.deepEqual([costly?.search.kind, costly?.fallback], ["folded", "costly"]);
});

test("stepping wraps at both ends and the other direction reverses it", () => {
    assert.deepEqual(step_match(2, 3, "forward"), { index: 0, wrapped: true });
    assert.deepEqual(step_match(0, 3, "backward"), { index: 2, wrapped: true });
    assert.deepEqual(nearest_match([5, 9], 6, "forward"), { index: 1, wrapped: false });
    assert.equal(opposite("forward"), "backward");
    assert.equal(describe_match("x", 4, 1, undefined, true), "2 of 4, wrapped");
    assert.equal(describe_match("x", 0, 0, undefined), "Not found: x");
});

// --- a thread list the service can filter

interface Mail {
    id: number;
    subject: string;
    author: string;
}

const MAILS: Mail[] = [
    { id: 1, subject: "Invoice May", author: "Ann" },
    { id: 2, subject: "Lunch", author: "Bob" },
    { id: 3, subject: "Invoice June", author: "Cy" },
    { id: 4, subject: "Notes", author: "Invoice Bot" },
];

let next_tab = 100;

/** One window with one mail tab. `filters` records every filter set, in order. The visible rows follow the last text filter, the way Thunderbird narrows them. */
function setup(options: { folder?: string; root?: boolean } = {}) {
    const tab_id = next_tab++;
    const timers = fake_timers();
    const storage = fake_storage();
    const filters: QuickFilter[] = [];
    const said: string[] = [];
    const state = { folder: options.folder ?? "f1", tab: tab_id, selected: -1, filter: {} as QuickFilter, root: options.root ?? false };
    const visible = () => {
        const text = state.filter.text?.text.toLowerCase();
        return text === undefined ? MAILS : MAILS.filter((mail) => `${mail.subject} ${mail.author}`.toLowerCase().includes(text));
    };
    const api = {
        mailTabs: {
            query: async () => [{ id: state.tab, displayedFolder: { id: state.folder, accountId: "a1", path: "/Inbox", isRoot: state.root } }],
            update: async () => undefined,
            setQuickFilter: async (id: number, filter: QuickFilter) => {
                filters.push(filter);
                if (id === tab_id) state.filter = filter;
            },
            setSelectedMessages: async (_id: number, ids: number[]) => void (state.selected = visible().findIndex((mail) => mail.id === ids[0])),
        },
        keys: {
            viewRows: async ({ first, last }: { first: number; last: number }) => ({
                current: state.selected,
                rows: visible().flatMap((mail, index) => (index >= first && index <= last ? [{ index, id: mail.id, depth: 0, collapsed: false, unread: false, flags: 0 }] : [])),
            }),
        },
        folderpane: undefined,
    };
    const register = create_search_register(storage.api.local);
    const service = create_search_service({ api: api as never, register, timers, say: async (_window, text, is_error) => void said.push(`${is_error ? "error" : "ok"} ${text}`) });
    // Types one keystroke and lets the debounce pass, as the page does.
    const type = async (text: string, window_id = 3) => {
        const pending = service.type(window_id, text);
        await new Promise((resolve) => setImmediate(resolve));
        timers.advance(SEARCH_DEBOUNCE_MS);
        return pending;
    };
    return { service, type, filters, said, state, tab_id, timers, storage, register, api, visible };
}

test("start refuses when no message list is shown", async () => {
    const { service } = setup({ root: true });
    await assert.rejects(service.start(3, "forward"), /No message list/);
});

test("typing narrows the list and counts the rows", async () => {
    const { service, type, filters } = setup();
    await service.start(3, "forward");
    assert.deepEqual(await type("invoice"), { note: "1 of 3", is_error: false });
    assert.deepEqual(filters.at(-1)?.text, { text: "invoice", subject: true, author: true });
    assert.deepEqual(await type("zzz"), { note: "Not found: zzz", is_error: true });
});

test("a keystroke typed during the wait replaces the one before: the first answers stale and only the last filters", async () => {
    const { service, filters, timers } = setup();
    await service.start(3, "forward");
    const first = service.type(3, "inv");
    await new Promise((resolve) => setImmediate(resolve));
    timers.advance(SEARCH_DEBOUNCE_MS - 10);
    const second = service.type(3, "invo");
    await new Promise((resolve) => setImmediate(resolve));
    timers.advance(SEARCH_DEBOUNCE_MS);
    assert.deepEqual(await first, { stale: true });
    assert.equal((await second as { note: string }).note, "1 of 3");
    assert.deepEqual(filters.map((filter) => filter.text?.text), ["invo"]);
});

test("a search with the backward direction counts from the last row", async () => {
    const { service, type } = setup();
    await service.start(3, "backward");
    assert.deepEqual(await type("invoice"), { note: "3 of 3", is_error: false });
});

test("the earlier filter survives under the typed text and Escape puts it back exactly", async () => {
    const { service, type, filters, api, tab_id } = setup();
    const unread: QuickFilter = { unread: true };
    await apply_filter(api.mailTabs, tab_id, unread);
    await service.start(3, "forward");
    await type("invoice");
    assert.deepEqual(filters.at(-1), { unread: true, text: { text: "invoice", subject: true, author: true } });
    await service.cancel(3);
    assert.deepEqual(filters.at(-1), unread);
});

test("with no earlier filter known, Escape restores a hidden empty bar", async () => {
    const { service, type, filters } = setup();
    await service.start(3, "forward");
    await type("invoice");
    await service.cancel(3);
    assert.deepEqual(filters.at(-1), { show: false });
});

test("clearing the text puts the earlier filter back before Escape", async () => {
    const { service, type, filters } = setup();
    await service.start(3, "forward");
    await type("invoice");
    await type("");
    assert.deepEqual(filters.at(-1), { show: false });
});

test("a cancel while a filter is still running waits for it, so the restore is the last change", async () => {
    const { service, filters, timers, api, state } = setup();
    await service.start(3, "forward");
    const slow = api.mailTabs.setQuickFilter;
    let release: () => void = () => {};
    api.mailTabs.setQuickFilter = async (id, filter) => {
        await new Promise<void>((resolve) => (release = resolve));
        await slow(id, filter);
    };
    const typed = service.type(3, "invoice");
    await new Promise((resolve) => setImmediate(resolve));
    timers.advance(SEARCH_DEBOUNCE_MS);
    await new Promise((resolve) => setImmediate(resolve));
    const cancelled = service.cancel(3);
    api.mailTabs.setQuickFilter = slow;
    release();
    await typed;
    await cancelled;
    assert.deepEqual(filters.map((filter) => filter.text?.text ?? "none"), ["invoice", "none"]);
    assert.equal(state.filter.text, undefined);
});

test("a folder that changes mid-search ends the search and touches no filter", async () => {
    const { service, type, filters, state } = setup();
    await service.start(3, "forward");
    state.folder = "f2";
    const answer = await type("invoice");
    assert.deepEqual(answer, { note: "The folder changed, so the search ended.", is_error: true });
    assert.deepEqual(filters, []);
    await assert.rejects(service.type(3, "x"), /not open/);
    await assert.rejects(service.commit(3, "x"), /ended/);
});

test("Escape in another folder or tab restores nothing", async () => {
    const folder_case = setup();
    await folder_case.service.start(3, "forward");
    folder_case.state.folder = "f2";
    await folder_case.service.cancel(3);
    assert.deepEqual(folder_case.filters, []);
    const tab_case = setup();
    await tab_case.service.start(3, "forward");
    tab_case.state.tab = 1;
    await tab_case.service.cancel(3);
    assert.deepEqual(tab_case.filters, []);
});

test("Enter keeps the filter, selects the first row, stores the register and says where it stands", async () => {
    const { service, type, said, state, storage } = setup();
    await service.start(3, "forward");
    await type("invoice");
    await service.commit(3, "invoice");
    assert.equal(state.selected, 0);
    assert.deepEqual(said, ["ok 1 of 3"]);
    assert.deepEqual(storage.data[SEARCH_REGISTER_STORAGE_KEY], { text: "invoice", direction: "forward" });
    assert.equal(state.filter.text?.text, "invoice");
    // The search is over: a later Escape has nothing to restore.
    await service.cancel(3);
    assert.equal(state.filter.text?.text, "invoice");
});

test("Enter on a backward search selects the last row", async () => {
    const { service, state, said } = setup();
    await service.start(3, "backward");
    await service.commit(3, "invoice");
    assert.equal(state.selected, 2);
    assert.deepEqual(said, ["ok 3 of 3"]);
});

test("Enter with no match refuses, keeps the search open, and Escape still restores", async () => {
    const { service, filters, storage } = setup();
    await service.start(3, "forward");
    await assert.rejects(service.commit(3, "zzz"), /Not found: zzz/);
    assert.equal(storage.data[SEARCH_REGISTER_STORAGE_KEY], undefined);
    await service.commit(3, "lunch");
    assert.equal(filters.at(-1)?.text?.text, "lunch");
});

test("an empty line on Enter repeats the register, and with no register it refuses", async () => {
    const { service, register, state } = setup();
    await service.start(3, "forward");
    await assert.rejects(service.commit(3, ""), /No earlier search/);
    await register.write({ text: "lunch", direction: "backward" });
    await service.commit(3, "");
    assert.equal(state.filter.text?.text, "lunch");
});

test("n and N step the narrowed rows and wrap, N against the register's direction", async () => {
    const { service, said, state } = setup();
    await service.start(3, "forward");
    await service.commit(3, "invoice");
    said.length = 0;
    await service.step(3, "same");
    assert.equal(state.selected, 1);
    await service.step(3, "same");
    await service.step(3, "same");
    assert.equal(state.selected, 0);
    assert.deepEqual(said, ["ok 2 of 3", "ok 3 of 3", "ok 1 of 3, wrapped"]);
    await service.step(3, "opposite");
    assert.equal(state.selected, 2);
    assert.equal(said.at(-1), "ok 3 of 3, wrapped");
});

test("n after Escape narrows the list to the register again", async () => {
    const { service, state, api, tab_id } = setup();
    await service.start(3, "forward");
    await service.commit(3, "invoice");
    await apply_filter(api.mailTabs, tab_id, { show: false });
    assert.equal(state.filter.text, undefined);
    await service.step(3, "same");
    assert.equal(state.filter.text?.text, "invoice");
    // The selection stayed on the first row, so n moves to the second.
    assert.equal(state.selected, 1);
});

test("n with no register refuses", async () => {
    const { service } = setup();
    await assert.rejects(service.step(3, "same"), /No search to repeat/);
});

test("the register is shared by every window and survives a new service", async () => {
    const first = setup();
    await first.service.start(3, "backward");
    await first.service.commit(3, "invoice");
    // A second service over the same storage is the page after a restart.
    const second = setup();
    await second.storage.api.local.set({ [SEARCH_REGISTER_STORAGE_KEY]: first.storage.data[SEARCH_REGISTER_STORAGE_KEY] });
    await second.service.step(9, "same");
    assert.equal(second.state.filter.text?.text, "invoice");
    assert.equal(second.state.selected, 2);
});

test("a register of the wrong shape counts as none", async () => {
    const { storage, register } = setup();
    for (const bad of [null, "x", { text: "", direction: "forward" }, { text: "a", direction: "up" }, { text: 3, direction: "forward" }]) {
        await storage.api.local.set({ [SEARCH_REGISTER_STORAGE_KEY]: bad });
        assert.equal(await register.read(), undefined);
    }
});

test("a window with no Experiment cannot search", async () => {
    const { service, api } = setup();
    (api as { keys?: unknown }).keys = undefined;
    await assert.rejects(service.start(3, "forward"), /Experiment/);
});
