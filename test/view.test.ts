import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import { while_loading } from "../src/background/handlers/loading.ts";
import type { MailTab } from "../src/background/handlers/view.ts";
import type { RouterApi } from "../src/background/router.ts";
import { read_rows, scroll_row, tab_kind } from "../src/chrome/view.ts";

const INBOX = { id: "f-inbox", accountId: "a1", path: "/Inbox" };
const ok = (id: string, args: Record<string, unknown>) => check_args(registry.get(id)!, args).ok;
const invoke = (command: string, args: Record<string, string>) => ({ command, args, count: 1, windowId: 3, messageIds: [] });

/** The router fake plus a mail tab fake that records every call. */
function view_fake(tab: MailTab | null = { id: 9, messagePaneVisible: true, folderPaneVisible: false, displayedFolder: INBOX }) {
    const calls: string[] = [];
    const mailTabs = {
        query: async (query: unknown) => (calls.push(`mailTabs.query ${JSON.stringify(query)}`), tab === null ? [] : [tab]),
        update: async (id: number, update: unknown) => void calls.push(`mailTabs.update ${id} ${JSON.stringify(update)}`),
        setQuickFilter: async (id: number, filter: unknown) => void calls.push(`mailTabs.setQuickFilter ${id} ${JSON.stringify(filter)}`),
    };
    // The view handlers touch only mailTabs. A call to any other member of the API fails the test.
    const api = { mailTabs, notifications: { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") }, keys: undefined } as unknown as RouterApi;
    return { run: (command: string, args: Record<string, string>) => create_router(registry, api).run(invoke(command, args)), calls };
}

test("filter.set validates the state and the tag", () => {
    for (const state of ["unread", "all", "starred", "attachment"]) assert.equal(ok("filter.set", { state }), true, state);
    assert.equal(ok("filter.set", { state: "tag", tag: "$label1" }), true);
    assert.equal(ok("filter.set", { state: "tag" }), false);
    assert.equal(ok("filter.set", { state: "tag", tag: "  " }), false);
    assert.equal(ok("filter.set", { state: "unread", tag: "$label1" }), false);
    assert.equal(ok("filter.set", { state: "bogus" }), false);
    assert.equal(ok("filter.set", {}), false);
});

test("sort.set takes enum args for by and order", () => {
    assert.equal(ok("sort.set", { by: "date", order: "descending" }), true);
    assert.equal(ok("sort.set", { by: "colour", order: "descending" }), false);
    assert.equal(ok("sort.set", { by: "date", order: "up" }), false);
    assert.equal(ok("sort.set", { by: "date" }), false);
    for (const by of ["received", "priority"]) assert.equal(ok("sort.set", { by, order: "ascending" }), true, by);
    assert.equal(ok("sort.set", { by: "current", order: "toggle" }), true);
    assert.equal(ok("sort.set", { by: "size", order: "toggle" }), true);
});

test("search.threads needs text and pane.toggle needs a known pane", () => {
    assert.equal(ok("search.threads", { query: "invoice" }), true);
    assert.equal(ok("search.threads", { query: "  " }), false);
    assert.equal(ok("search.threads", {}), false);
    assert.equal(ok("pane.toggle", { pane: "message" }), true);
    assert.equal(ok("pane.toggle", { pane: "folder" }), true);
    assert.equal(ok("pane.toggle", { pane: "header" }), false);
});

test("each fixed filter state sets its quick filter on the tab of the window, and all clears with {}", async () => {
    const expected = { unread: { unread: true }, starred: { flagged: true }, attachment: { attachment: true }, all: {} };
    for (const [state, filter] of Object.entries(expected)) {
        const { run, calls } = view_fake();
        await run("filter.set", { state });
        assert.deepEqual(calls.filter((call) => !call.startsWith("mailTabs.query")), [`mailTabs.setQuickFilter 9 ${JSON.stringify(filter)}`], state);
        assert.ok(calls.includes('mailTabs.query {"windowId":3,"active":true}'));
    }
});

test("the tag filter matches any message with the tag, and search.threads sends the text", async () => {
    const tagged = view_fake();
    await tagged.run("filter.set", { state: "tag", tag: "$label1" });
    assert.ok(tagged.calls.includes('mailTabs.setQuickFilter 9 {"tags":{"mode":"any","tags":{"$label1":true}}}'));
    const searched = view_fake();
    await searched.run("search.threads", { query: "invoice" });
    assert.ok(searched.calls.includes('mailTabs.setQuickFilter 9 {"text":{"text":"invoice","subject":true,"author":true}}'));
});

test("sort.set updates the sort of the tab", async () => {
    const { run, calls } = view_fake();
    await run("sort.set", { by: "date", order: "descending" });
    assert.ok(calls.includes('mailTabs.update 9 {"sortType":"date","sortOrder":"descending"}'));
});

test("pane.toggle reads the pane state first and then sets the opposite", async () => {
    const shown = view_fake({ id: 9, messagePaneVisible: true, folderPaneVisible: false, displayedFolder: INBOX });
    await shown.run("pane.toggle", { pane: "message" });
    await shown.run("pane.toggle", { pane: "folder" });
    const kinds = shown.calls.filter((call) => call.startsWith("mailTabs")).map((call) => call.split(" ")[0]);
    assert.deepEqual(kinds, ["mailTabs.query", "mailTabs.update", "mailTabs.query", "mailTabs.update"]);
    assert.ok(shown.calls.includes('mailTabs.update 9 {"messagePaneVisible":false}'));
    assert.ok(shown.calls.includes('mailTabs.update 9 {"folderPaneVisible":true}'));
    const hidden = view_fake({ id: 9, messagePaneVisible: false, displayedFolder: INBOX });
    await hidden.run("pane.toggle", { pane: "message" });
    assert.ok(hidden.calls.includes('mailTabs.update 9 {"messagePaneVisible":true}'));
});

test("a window with no mail tab refuses and changes nothing", async () => {
    const { run, calls } = view_fake(null);
    await run("pane.toggle", { pane: "message" });
    assert.equal(calls.some((call) => call.startsWith("mailTabs.update")), false);
    assert.equal(calls.filter((call) => call.startsWith("notify")).length, 1);
});

test("toggle_starred sets the starred filter and clears it when it already shows", async () => {
    // A tab id of its own, because the handler remembers the filter by tab id across tests.
    const { run, calls } = view_fake({ id: 77, messagePaneVisible: true, folderPaneVisible: false, displayedFolder: INBOX });
    await run("filter.set", { state: "toggle_starred" });
    await run("filter.set", { state: "toggle_starred" });
    assert.deepEqual(calls.filter((call) => call.startsWith("mailTabs.setQuickFilter")), ['mailTabs.setQuickFilter 77 {"flagged":true}', "mailTabs.setQuickFilter 77 {}"]);
});

test("F f and , , open the filter and sort pickers, F s toggles starred, F A is the attachment filter, and C-x C-c C-h close the tab", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    assert.deepEqual(normal["Ff"], { id: "cmdline.open", args: { text: "filter " } });
    assert.deepEqual(normal[",,"], { id: "cmdline.open", args: { text: "sort " } });
    assert.deepEqual(normal["Fs"], { id: "filter.set", args: { state: "toggle_starred" } });
    assert.deepEqual(normal["FA"], { id: "filter.set", args: { state: "attachment" } });
    for (const key of ["<C-x>", "<C-c>", "<C-h>"]) assert.deepEqual(normal[key], { id: "tab.close_mail" }, key);
});

test("the view commands are bridge safe and only the fixed states, panes and sorts have keys", () => {
    for (const id of ["filter.set", "search.threads", "sort.set", "pane.toggle"]) assert.equal(registry.get(id)?.bridge, true, id);
    const bound = Object.values(DEFAULT_KEYMAP.normal ?? {}).flatMap((binding) => (binding && !Array.isArray(binding) ? [binding] : []));
    assert.equal(bound.some((binding) => binding.id === "search.threads"), false);
    assert.equal(bound.some((binding) => binding.id === "filter.set" && binding.args?.["state"] === "tag"), false);
    assert.deepEqual(compile_default_keymap().warnings ?? [], []);
});

test("the sort keys name a column and the default order of that column", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    const planned: Record<string, [string, string]> = {
        ",d": ["date", "descending"],
        ",s": ["subject", "ascending"],
        ",f": ["author", "ascending"],
        ",z": ["size", "ascending"],
        ",t": ["tags", "ascending"],
        ",a": ["attachments", "ascending"],
        ",u": ["unread", "ascending"],
        ",o": ["current", "toggle"],
        ",r": ["received", "descending"],
        ",p": ["priority", "ascending"],
    };
    for (const [keys, [by, order]] of Object.entries(planned)) assert.deepEqual(normal[keys], { id: "sort.set", args: { by, order } }, keys);
    assert.deepEqual(compile_default_keymap().warnings ?? [], []);
});

test("order toggle reads the current order at the key press and current keeps the column", async () => {
    for (const [now, next] of [["ascending", "descending"], ["descending", "ascending"]] as const) {
        const { run, calls } = view_fake({ id: 9, displayedFolder: INBOX, sortType: "subject", sortOrder: now });
        await run("sort.set", { by: "current", order: "toggle" });
        assert.ok(calls.includes(`mailTabs.update 9 {"sortType":"subject","sortOrder":"${next}"}`), now);
    }
    const named = view_fake({ id: 9, displayedFolder: INBOX, sortType: "subject", sortOrder: "ascending" });
    await named.run("sort.set", { by: "date", order: "toggle" });
    assert.ok(named.calls.includes('mailTabs.update 9 {"sortType":"date","sortOrder":"descending"}'));
    const unknown = view_fake({ id: 9, displayedFolder: INBOX });
    await unknown.run("sort.set", { by: "current", order: "toggle" });
    assert.equal(unknown.calls.some((call) => call.startsWith("mailTabs.update")), false);
    assert.equal(unknown.calls.filter((call) => call.startsWith("notify")).length, 1);
});

const NO_LIST_TABS: [string, MailTab][] = [
    ["several folders selected", { id: 9, displayedFolder: null }],
    ["Account Central", { id: 9, displayedFolder: { id: "f-root", accountId: "a1", path: "/", isRoot: true } }],
];

test("filter, search and sort refuse when no message list is shown", async () => {
    for (const [name, tab] of NO_LIST_TABS) {
        for (const [command, args] of [["filter.set", { state: "unread" }], ["search.threads", { query: "x" }], ["sort.set", { by: "date", order: "ascending" }]] as const) {
            const { run, calls } = view_fake(tab);
            await run(command, { ...args });
            assert.equal(calls.some((call) => call.startsWith("mailTabs.update") || call.startsWith("mailTabs.setQuickFilter")), false, `${command} on ${name}`);
            assert.deepEqual(calls.filter((call) => call.startsWith("notify")), ["notify No message list is shown."], `${command} on ${name}`);
        }
    }
});

test("sort by size or read state refuses in a view grouped by its sort column and passes elsewhere", async () => {
    const grouped = { id: 9, displayedFolder: INBOX, viewType: "groupedBySortType" };
    for (const by of ["size", "unread"]) {
        const { run, calls } = view_fake(grouped);
        await run("sort.set", { by, order: "ascending" });
        assert.equal(calls.some((call) => call.startsWith("mailTabs.update")), false, by);
        assert.equal(calls.filter((call) => call.startsWith("notify")).length, 1, by);
    }
    const date = view_fake(grouped);
    await date.run("sort.set", { by: "date", order: "ascending" });
    assert.ok(date.calls.includes('mailTabs.update 9 {"sortType":"date","sortOrder":"ascending"}'));
    const flat = view_fake({ id: 9, displayedFolder: INBOX, viewType: "ungrouped" });
    await flat.run("sort.set", { by: "size", order: "ascending" });
    assert.ok(flat.calls.includes('mailTabs.update 9 {"sortType":"size","sortOrder":"ascending"}'));
});

test("every view handler queries the window of the invocation", async () => {
    for (const [command, args] of [["filter.set", { state: "unread" }], ["search.threads", { query: "x" }], ["sort.set", { by: "date", order: "ascending" }], ["pane.toggle", { pane: "message" }]] as const) {
        const { run, calls } = view_fake();
        await run(command, { ...args });
        assert.ok(calls.includes('mailTabs.query {"windowId":3,"active":true}'), command);
    }
});

test("the first-display error becomes a still-loading refusal and other errors pass through", async () => {
    await assert.rejects(while_loading(async () => Promise.reject(new Error("An unexpected error occurred."))), { message: /still loading/ });
    await assert.rejects(while_loading(async () => Promise.reject(new Error("other"))), { message: "other" });
});

test("a view key during a first display notifies that the folder is loading", async () => {
    const calls: string[] = [];
    const api = { mailTabs: { query: async () => Promise.reject(new Error("An unexpected error occurred")) }, notifications: { create: async (_id: string, notification: { message: string }) => (calls.push(notification.message), "n1") }, keys: undefined } as unknown as RouterApi;
    await create_router(registry, api).run(invoke("pane.toggle", { pane: "message" }));
    assert.match(calls[0] ?? "", /still loading/);
});

// A thread list fake for the chrome verbs: a row spec is its depth, "+" a closed thread.
function pane_fake(spec: (number | "+")[], current = 0) {
    const calls: string[] = [];
    const tree = {
        selectedIndex: current,
        currentIndex: current,
        getRowAtIndex: () => null,
        scrollBy: () => {},
        expandRowAtIndex: (index: number) => void calls.push(`expand ${index}`),
        collapseRowAtIndex: (index: number) => void calls.push(`collapse ${index}`),
    };
    const gDBView = {
        rowCount: spec.length,
        getSelectedMsgHdrs: () => [],
        getMsgHdrAt: (index: number) => ({ isRead: index % 2 === 0, flags: index === 1 ? 0x10000000 : 0 }),
        getLevel: (index: number) => (spec[index] === "+" ? 0 : (spec[index] as number)),
        isContainer: (index: number) => spec[index] === "+",
        isContainerOpen: () => false,
    };
    const commandController = { doCommand: (command: string) => void calls.push(command) };
    return { pane: { gDBView, threadTree: tree, commandController }, calls };
}

test("read_rows names index, id, depth, collapsed, unread and flags, cut to the list", () => {
    const { pane } = pane_fake([0, 1, "+"], 1);
    const result = read_rows(pane, 1, 9, (header) => ((header as { isRead: boolean }).isRead ? 7 : 8));
    assert.equal(result.current, 1);
    assert.deepEqual(result.rows, [
        { index: 1, id: 8, depth: 1, collapsed: false, unread: true, flags: 0x10000000 },
        { index: 2, id: 7, depth: 0, collapsed: true, unread: false, flags: 0 },
    ]);
    assert.deepEqual(read_rows(pane, 5, 9, () => 1).rows, []);
});

test("read_rows stops at 500 rows and reports no rows when no view is loaded", () => {
    const big = pane_fake(Array.from({ length: 900 }, () => 0)).pane;
    assert.equal(read_rows(big, 0, 899, () => 1).rows.length, 500);
    assert.equal(read_rows(big, 600, 2000, () => 1).rows.length, 300);
    const { pane } = pane_fake([0]);
    assert.deepEqual(read_rows({ ...pane, gDBView: null }, 0, 3, () => 1).rows, []);
});

test("scroll_row brings the row into existence, aligns it to the chosen edge and clears the sticky header", () => {
    for (const [position, block, shift] of [["top", "start", -30], ["center", "center", -15], ["bottom", "end", -0]] as const) {
        const calls: string[] = [];
        const tree = {
            table: { header: { clientHeight: 30 } },
            scrollToIndex: (index: number) => void calls.push(`scrollToIndex ${index}`),
            getRowAtIndex: () => ({ scrollIntoView: (options: { block: string }) => void calls.push(`align ${options.block}`) }),
            scrollBy: (options: { top: number }) => void calls.push(`scrollBy ${options.top}`),
        };
        scroll_row(tree as never, 40, position);
        assert.deepEqual(calls, ["scrollToIndex 40", `align ${block}`, `scrollBy ${shift}`], position);
    }
});

test("tab_kind: the mail tab is 0, the tabs with a readable document 1, every other tab 2", () => {
    const kind_of = (name: string | null) => tab_kind({ currentTabInfo: name === null ? null : { mode: { name } } });
    assert.equal(kind_of(null), 0);
    assert.equal(kind_of("mail3PaneTab"), 0);
    for (const name of ["calendar", "addressBookTab", "preferencesTab"]) assert.equal(kind_of(name), 1, name);
    for (const name of ["contentTab", "mailMessageTab", "tasks", "chat", "calendarEvent"]) assert.equal(kind_of(name), 2, name);
});

test("the close chords of the mail tab are in the mail keymap and not in the message keymap", async () => {
    const { MESSAGE_KEYMAP } = await import("../src/background/commands/index.ts");
    for (const key of ["<C-x>", "<C-c>", "<C-h>", "Ff", ",,"]) {
        assert.ok(DEFAULT_KEYMAP.normal?.[key], key);
        assert.equal(MESSAGE_KEYMAP.normal?.[key], undefined, key);
    }
});

test("F s flips only the star and keeps the other filters", async () => {
    const { run, calls } = view_fake({ id: 78, messagePaneVisible: true, folderPaneVisible: false, displayedFolder: INBOX });
    await run("filter.set", { state: "unread" });
    await run("filter.set", { state: "toggle_starred" });
    await run("filter.set", { state: "toggle_starred" });
    assert.deepEqual(calls.filter((call) => call.startsWith("mailTabs.setQuickFilter")), ['mailTabs.setQuickFilter 78 {"unread":true}', 'mailTabs.setQuickFilter 78 {"unread":true,"flagged":true}', 'mailTabs.setQuickFilter 78 {"unread":true}']);
});
