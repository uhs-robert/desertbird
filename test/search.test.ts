import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_query, describe_match, nearest_match, opposite, step_match } from "../vendor/desertfox/find_match.ts";
import type { QuickFilter } from "../src/background/handlers/view.ts";
import { apply_filter } from "../src/background/handlers/view.ts";
import { create_search_register } from "../src/background/search/register.ts";
import { SEARCH_DEBOUNCE_MS, create_search_service } from "../src/background/search/service.ts";
import { APPLIED_FILTERS_STORAGE_KEY, SEARCH_REGISTER_STORAGE_KEY } from "../src/shared/protocol.ts";
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
    const state = { tab_folders: { [tab_id]: options.folder ?? "f1" } as Record<number, string>, tab: tab_id, selected: -1, filter: {} as QuickFilter, root: options.root ?? false };
    const visible = () => {
        const text = state.filter.text?.text.toLowerCase();
        return text === undefined ? MAILS : MAILS.filter((mail) => `${mail.subject} ${mail.author}`.toLowerCase().includes(text));
    };
    const api = {
        mailTabs: {
            query: async () => [{ id: state.tab, displayedFolder: { id: state.tab_folders[state.tab] ?? "other", accountId: "a1", path: "/Inbox", isRoot: state.root } }],
            get: async (id: number) => ({ displayedFolder: { id: state.tab_folders[id] ?? "other" } }),
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
    const { service, type, filters, state, tab_id } = setup();
    await service.start(3, "forward");
    state.tab_folders[tab_id] = "f2";
    const answer = await type("invoice");
    assert.deepEqual(answer, { note: "The folder changed, so the search ended.", is_error: true });
    assert.deepEqual(filters, []);
    await assert.rejects(service.type(3, "x"), /not open/);
    await assert.rejects(service.commit(3, "x"), /ended/);
});

test("Escape after a folder change restores nothing", async () => {
    const folder_case = setup();
    await folder_case.service.start(3, "forward");
    folder_case.state.tab_folders[folder_case.tab_id] = "f2";
    await folder_case.service.cancel(3);
    assert.deepEqual(folder_case.filters, []);
});

test("a tab switch mid-search still restores the tab the search narrowed", async () => {
    const { service, type, filters, state } = setup();
    await service.start(3, "forward");
    await type("inv");
    state.tab = 1;
    await service.cancel(3);
    assert.deepEqual(filters.at(-1), { show: false });
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
    assert.equal((state.filter as QuickFilter).text?.text, "invoice");
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

// --- the command line side

import { create_cmdline_service } from "../src/background/cmdline/service.ts";
import { registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import { fake_api } from "./fake_api.ts";

function line_setup(options: { commit_error?: string; commit_gate?: Promise<void> } = {}) {
    const log: string[] = [];
    const histories: string[] = [];
    const service = create_cmdline_service({
        registry,
        sources: { folders: async () => [], tags: async () => [], tabs: async () => [] },
        overlay: { mount: async () => {}, unmount: async (args) => void log.push(`unmount ${args.windowId}`), setModeLabel: async () => {}, onClosed: { addListener: () => {}, removeListener: () => {} } },
        history: { record: async () => {} },
        search_history: { record: async (line) => void histories.push(line) },
        search: {
            type: async (_window, text) => (log.push(`type ${text}`), { note: "1 of 2", is_error: false }),
            commit: async (_window, text) => {
                log.push(`commit ${text}`);
                await options.commit_gate;
                if (options.commit_error) throw new Error(options.commit_error);
            },
            cancel: async (window_id) => void log.push(`cancel ${window_id}`),
        },
        run: async () => {},
    });
    return { service, log, histories };
}

const ask = (service: ReturnType<typeof line_setup>["service"], message: unknown) => service.handle(message) as Promise<unknown>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("hello of a search line carries the direction, and a command line has none", async () => {
    const { service } = line_setup();
    service.begin(3, { message_ids: [], text: "", search: "backward" });
    assert.deepEqual(await ask(service, { type: "cmdline.hello", windowId: 3 }), { open: true, text: "", search: "backward" });
    service.begin(4, { message_ids: [], text: "tag " });
    assert.deepEqual(await ask(service, { type: "cmdline.hello", windowId: 4 }), { open: true, text: "tag " });
});

test("search keystrokes reach the search service, and only for a search line", async () => {
    const { service } = line_setup();
    service.begin(3, { message_ids: [], text: "" });
    await assert.rejects(ask(service, { type: "cmdline.search_type", windowId: 3, text: "x" }), /not open/);
    service.begin(3, { message_ids: [], text: "", search: "forward" });
    assert.deepEqual(await ask(service, { type: "cmdline.search_type", windowId: 3, text: "x" }), { note: "1 of 2", is_error: false });
});

test("Enter commits first, then closes the overlay and records the line in the search history", async () => {
    const { service, log, histories } = line_setup();
    service.begin(3, { message_ids: [], text: "", search: "forward" });
    assert.deepEqual(await ask(service, { type: "cmdline.search_commit", windowId: 3, text: "foo" }), { ok: true });
    await settle();
    assert.deepEqual(log, ["commit foo", "cancel 3", "unmount 3"]);
    assert.deepEqual(histories, ["foo"]);
    // A second Enter finds no session.
    assert.deepEqual(await ask(service, { type: "cmdline.search_commit", windowId: 3, text: "foo" }), { ok: false, message: "The search line is not open." });
});

test("a search that cannot finish keeps the line open with the reason and records nothing", async () => {
    const { service, log, histories } = line_setup({ commit_error: "Not found: zzz" });
    service.begin(3, { message_ids: [], text: "", search: "forward" });
    assert.deepEqual(await ask(service, { type: "cmdline.search_commit", windowId: 3, text: "zzz" }), { ok: false, message: "Not found: zzz" });
    await settle();
    assert.deepEqual(log, ["commit zzz"]);
    assert.deepEqual(histories, []);
    // The line is still open: Escape cancels the search and unmounts.
    await ask(service, { type: "cmdline.close", windowId: 3 });
    assert.deepEqual(log, ["commit zzz", "cancel 3", "unmount 3"]);
});

test("Escape cancels the search before the overlay goes, and a command line asks for a cancel that finds no search", async () => {
    const { service, log } = line_setup();
    service.begin(3, { message_ids: [], text: "", search: "forward" });
    await ask(service, { type: "cmdline.close", windowId: 3 });
    service.begin(4, { message_ids: [], text: "" });
    await ask(service, { type: "cmdline.close", windowId: 4 });
    assert.deepEqual(log, ["cancel 3", "unmount 3", "cancel 4", "unmount 4"]);
});

test("an overlay that left on its own (a tab change) cancels the search through end", async () => {
    const { service, log } = line_setup();
    service.begin(3, { message_ids: [], text: "", search: "forward" });
    service.end(3);
    await settle();
    assert.deepEqual(log, ["cancel 3"]);
});

test("the search keys open the line as a search line and a failed mount drops the session", async () => {
    const { api, calls } = fake_api();
    const router = create_router(registry, api);
    await router.run({ command: "search.open", args: { direction: "backward" }, count: 1, windowId: 3, messageIds: [5] });
    assert.deepEqual(calls.filter((call) => /^(search|cmdline|overlay)/.test(call)), ["search.start 3 backward", 'cmdline.begin 3 {"message_ids":[5],"text":"","search":"backward"}', "overlay.mount 3 cmdline"]);
    api.overlay!.mount = async () => {
        throw new Error("no window");
    };
    await router.run({ command: "search.open", args: { direction: "forward" }, count: 1, windowId: 3, messageIds: [] });
    assert.ok(calls.includes("cmdline.end 3"));
    await router.run({ command: "search.next", args: {}, count: 1, windowId: 3, messageIds: [] });
    await router.run({ command: "search.prev", args: {}, count: 1, windowId: 3, messageIds: [] });
    assert.ok(calls.includes("search.step 3 same") && calls.includes("search.step 3 opposite"));
});

test("? is backward search and g? is help, / and n and N are bound in the mail tab and ? is free in no other place", async () => {
    const { DEFAULT_KEYMAP, MESSAGE_KEYMAP } = await import("../src/background/commands/index.ts");
    const normal = DEFAULT_KEYMAP.normal as Record<string, { id: string; args?: Record<string, unknown> }>;
    assert.deepEqual(normal["?"], { id: "search.open", args: { direction: "backward" } });
    assert.deepEqual(normal["/"], { id: "search.open", args: { direction: "forward" } });
    assert.equal(normal["g?"]?.id, "help.open");
    assert.deepEqual([normal["n"]?.id, normal["N"]?.id], ["search.next", "search.prev"]);
    // The message pane keeps its own find on / n N.
    const message = MESSAGE_KEYMAP.normal as Record<string, { id: string }>;
    assert.deepEqual([message["/"]?.id, message["n"]?.id, message["?"]], ["cmdline.open", "message.find_next", undefined]);
});

// --- lifecycle races

test("Escape while an Enter is still counting cancels the search and the late commit does not keep its text", async () => {
    const { service, filters, api, state } = setup();
    await service.start(3, "forward");
    const rows = api.keys.viewRows;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    api.keys.viewRows = async (range) => (await held, rows(range));
    const committed = service.commit(3, "invoice");
    await new Promise((resolve) => setImmediate(resolve));
    const cancelled = service.cancel(3);
    release();
    await assert.rejects(committed, /cancelled/);
    await cancelled;
    assert.deepEqual(filters.at(-1), { show: false });
    assert.equal(state.filter.text, undefined);
    assert.equal(state.selected, -1);
});

test("Enter that fails to store the register or select leaves the search open for another Enter", async () => {
    const { service, storage, state } = setup();
    await service.start(3, "forward");
    const write = storage.api.local.set;
    storage.api.local.set = async () => {
        throw new Error("disk full");
    };
    await assert.rejects(service.commit(3, "invoice"), /disk full/);
    storage.api.local.set = write;
    await service.commit(3, "invoice");
    assert.equal(state.selected, 0);
});

test("keystrokes that settle after Enter cannot overwrite the committed filter", async () => {
    const { service, filters, timers, state } = setup();
    await service.start(3, "forward");
    const first = service.type(3, "inv");
    const second = service.type(3, "invoice");
    await new Promise((resolve) => setImmediate(resolve));
    await service.commit(3, "invoice");
    timers.advance(SEARCH_DEBOUNCE_MS);
    assert.deepEqual([await first, await second], [{ stale: true }, { stale: true }]);
    assert.deepEqual(filters.map((filter) => filter.text?.text), ["invoice"]);
    assert.equal(state.filter.text?.text, "invoice");
});

test("a keystroke already filtering when Enter comes lands before the commit and never after it", async () => {
    const { service, filters, timers, api } = setup();
    await service.start(3, "forward");
    const slow = api.mailTabs.setQuickFilter;
    let release: () => void = () => {};
    api.mailTabs.setQuickFilter = async (id, filter) => {
        if (filter.text?.text === "inv") await new Promise<void>((resolve) => (release = resolve));
        await slow(id, filter);
    };
    const typed = service.type(3, "inv");
    await new Promise((resolve) => setImmediate(resolve));
    timers.advance(SEARCH_DEBOUNCE_MS);
    await new Promise((resolve) => setImmediate(resolve));
    const committed = service.commit(3, "invoice");
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await typed;
    await committed;
    assert.equal(filters.at(-1)?.text?.text, "invoice");
});

test("the remembered filters come back from session storage after a restart of the page", async () => {
    const { keep_filters, remembered_filter, filters_ready, apply_filter, forget_filter } = await import("../src/background/handlers/view.ts");
    const stored: Record<string, unknown> = { [APPLIED_FILTERS_STORAGE_KEY]: { 777: { unread: true } } };
    const writes: unknown[] = [];
    keep_filters({ get: async () => stored, set: async (items) => void writes.push(items) });
    await filters_ready();
    assert.deepEqual(remembered_filter(777), { unread: true });
    await apply_filter({ setQuickFilter: async () => {} }, 778, { flagged: true });
    // Other tests leave filters of their own tabs in the same map, so only these two tabs are compared.
    const written = (writes.at(-1) as Record<string, Record<string, unknown>>)[APPLIED_FILTERS_STORAGE_KEY]!;
    assert.deepEqual([written["777"], written["778"]], [{ unread: true }, { flagged: true }]);
    forget_filter(777);
    forget_filter(778);
    keep_filters(undefined);
});

test("Escape while an Enter is still committing cancels the search, and the late failure keeps no session", async () => {
    let release: () => void = () => {};
    const { service, log } = line_setup({ commit_error: "Not found: zzz", commit_gate: new Promise<void>((resolve) => (release = resolve)) });
    service.begin(3, { message_ids: [], text: "", search: "forward" });
    const pending = ask(service, { type: "cmdline.search_commit", windowId: 3, text: "zzz" });
    await settle();
    await ask(service, { type: "cmdline.close", windowId: 3 });
    release();
    assert.deepEqual(await pending, { ok: false, message: "Not found: zzz" });
    assert.deepEqual(log, ["commit zzz", "cancel 3", "unmount 3"]);
    assert.deepEqual(await ask(service, { type: "cmdline.hello", windowId: 3 }), { open: false });
});
