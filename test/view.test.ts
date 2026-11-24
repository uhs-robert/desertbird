import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import { while_loading } from "../src/background/handlers/loading.ts";
import { forget_filter, keep_filters } from "../src/background/handlers/view.ts";
import { create_search_register } from "../src/background/search/register.ts";
import { SEARCH_DEBOUNCE_MS, create_search_service } from "../src/background/search/service.ts";
import type { FilterSetArgs } from "../src/shared/protocol.ts";
import { fake_storage } from "./fake_api.ts";
import { fake_timers } from "./hud_fakes.ts";
import type { MailTab } from "../src/background/handlers/view.ts";
import { APPLIED_FILTERS_STORAGE_KEY } from "../src/shared/protocol.ts";
import type { RouterApi } from "../src/background/router.ts";
import { tab_kind } from "../src/chrome/view.ts";
import { read_rows, scroll_row } from "../src/chrome/view_verbs.ts";

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

test("F f and , , open the filter and sort pickers, F s toggles starred, F a is the attachment filter, F r resets it, and C-x C-c close the tab", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    assert.deepEqual(normal["Ff"], { id: "cmdline.open", args: { text: "filter " }, label: "By text" });
    assert.deepEqual(normal["ss"], { id: "cmdline.open", args: { text: "sort " }, label: "Sort by" });
    assert.deepEqual(normal["Fs"], { id: "filter.set", args: { state: "toggle_starred" }, label: "Starred" });
    assert.deepEqual(normal["Fa"], { id: "filter.set", args: { state: "attachment" }, label: "Attachments" });
    assert.deepEqual(normal["Fr"], { id: "filter.set", args: { state: "all" }, label: "Reset" });
    assert.equal(normal["FA"], undefined);
    for (const key of ["<C-x>", "<C-c>"]) assert.deepEqual(normal[key], { id: "tab.close_mail", label: "Close tab" }, key);
    assert.equal(normal["<C-h>"], undefined);
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
        sd: ["date", "descending"],
        sj: ["subject", "ascending"],
        sf: ["author", "ascending"],
        sz: ["size", "ascending"],
        st: ["tags", "ascending"],
        sa: ["attachments", "ascending"],
        su: ["unread", "ascending"],
        so: ["current", "toggle"],
        sr: ["received", "descending"],
        sp: ["priority", "ascending"],
    };
    for (const [keys, [by, order]] of Object.entries(planned)) assert.deepEqual({ ...(normal[keys] as object), label: undefined }, { id: "sort.set", args: { by, order }, label: undefined }, keys);
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

test("tab_kind: the mail tab is 0 and every other tab 1", () => {
    const kind_of = (name: string | null) => tab_kind({ currentTabInfo: name === null ? null : { mode: { name } } });
    assert.equal(kind_of(null), 0);
    assert.equal(kind_of("mail3PaneTab"), 0);
    for (const name of ["calendar", "addressBookTab", "preferencesTab", "contentTab", "mailMessageTab", "tasks", "chat", "calendarEvent"]) assert.equal(kind_of(name), 1, name);
});

test("the close chords of the mail tab are in the mail keymap and not in the message keymap", async () => {
    const { default_keymap_of } = await import("../src/background/commands/tab_keymaps.ts");
    for (const key of ["<C-x>", "<C-c>", "Ff", "ss", ";;"]) {
        assert.ok(DEFAULT_KEYMAP.normal?.[key], key);
        assert.equal(default_keymap_of("message").normal?.[key], undefined, key);
    }
});

test("F s flips only the star and keeps the other filters", async () => {
    const { run, calls } = view_fake({ id: 78, messagePaneVisible: true, folderPaneVisible: false, displayedFolder: INBOX });
    await run("filter.set", { state: "unread" });
    await run("filter.set", { state: "toggle_starred" });
    await run("filter.set", { state: "toggle_starred" });
    assert.deepEqual(calls.filter((call) => call.startsWith("mailTabs.setQuickFilter")), ['mailTabs.setQuickFilter 78 {"unread":true}', 'mailTabs.setQuickFilter 78 {"unread":true,"flagged":true}', 'mailTabs.setQuickFilter 78 {"unread":true}']);
});

/** A fake whose messages.get answers from `messages`, with the selection `ids`. */
// The remembered filter is keyed by tab id and lives for the process, so each fake gets a tab of its own.
let next_tab_id = 100;
function by_message_fake(messages: Record<number, Record<string, unknown>>, ids: number[], earlier?: unknown, own: string[] = [], gate?: Promise<void>) {
    const calls: string[] = [];
    const tab_id = next_tab_id++;
    const mailTabs = {
        query: async () => [{ id: tab_id, displayedFolder: INBOX }],
        update: async () => undefined,
        setQuickFilter: async (_id: number, filter: unknown) => void calls.push(JSON.stringify(filter)),
    };
    const notices: string[] = [];
    const api = { mailTabs, identities: { list: async () => own.map((email) => ({ email })) }, messages: { get: async (id: number) => (await gate, { id, ...messages[id] }), tags: { list: async () => [] } }, notifications: { create: async (_id: string, notification: { message: string }) => (notices.push(notification.message), "n1") }, keys: undefined } as unknown as RouterApi;
    const router = create_router(registry, api);
    const router_run = (command: string, args: Record<string, string>) => router.run({ command, args, count: 1, windowId: 3, messageIds: [] });
    const run = (field: string) => router.run({ command: "filter.by", args: { field }, count: 1, windowId: 3, messageIds: ids });
    return { run, calls, notices, router_run, earlier: async () => earlier === undefined || (await router.run({ command: "filter.set", args: { state: earlier as string }, count: 1, windowId: 3, messageIds: [] })) };
}

const SAMPLE = { author: "Ann Lee <ann@example.org>", subject: "Re: Fwd: Budget plan", recipients: ["Bob <bob@example.org>", "cy@example.org"], tags: ["$label1"] };

test("filter.by validates the field", () => {
    for (const field of ["from", "subject", "recipient", "tag"]) assert.equal(ok("filter.by", { field }), true, field);
    for (const field of ["list", "date"]) assert.equal(ok("filter.by", { field }), true, field);
    assert.equal(ok("filter.by", { field: "thread" }), false);
    assert.equal(ok("filter.by", {}), false);
});

test("filter.by filters on the bare sender address, the subject without prefixes, the first recipient and the tags", async () => {
    const expected = {
        from: '{"text":{"text":"ann@example.org","author":true}}',
        subject: '{"text":{"text":"Budget plan","subject":true}}',
        recipient: '{"text":{"text":"bob@example.org","recipients":true}}',
        tag: '{"tags":{"mode":"any","tags":{"$label1":true}}}',
    };
    for (const [field, filter] of Object.entries(expected)) {
        const { run, calls } = by_message_fake({ 1: SAMPLE }, [1]);
        await run(field);
        assert.deepEqual(calls, [filter], field);
    }
});

test("filter.by adds to the remembered filter, swaps only the text, and drops the hidden-bar marker", async () => {
    const { run, calls, earlier } = by_message_fake({ 1: SAMPLE }, [1], "unread");
    await earlier();
    await run("from");
    await run("subject");
    assert.deepEqual(calls.slice(1), ['{"unread":true,"text":{"text":"ann@example.org","author":true}}', '{"unread":true,"text":{"text":"Budget plan","subject":true}}']);
});

test("filter.by refuses a text field for several messages, ORs their tags, and refuses what the message lacks", async () => {
    const several = by_message_fake({ 1: SAMPLE, 2: { ...SAMPLE, tags: ["$label2"] } }, [1, 2]);
    await several.run("from");
    assert.deepEqual(several.notices, ["Select one message."]);
    await several.run("tag");
    assert.deepEqual(several.calls, ['{"tags":{"mode":"any","tags":{"$label1":true,"$label2":true}}}']);
    const bare = by_message_fake({ 1: { author: "a@b.c", subject: "Re:", recipients: [], tags: [] } }, [1]);
    for (const field of ["subject", "recipient", "tag"]) await bare.run(field);
    assert.deepEqual(bare.notices, ["The selected message has no subject.", "The selected message has no recipient.", "The selected message has no tag."]);
    assert.deepEqual(bare.calls, []);
    const none = by_message_fake({}, []);
    await none.run("from");
    assert.deepEqual(none.notices, ["No message is selected."]);
});

test("filter.by strips list tags and reply markers of any case from the subject", async () => {
    const cases: Record<string, string> = { "[dev] Re: foo": "foo", "RE: FWD: foo": "foo", "Aw: foo": "foo", "Sv: Antw: foo": "foo", "Re[2]: foo": "foo", "[a] [b] Wg: foo": "foo", "Re : foo bar": "foo bar" };
    for (const [subject, expected] of Object.entries(cases)) {
        const { run, calls } = by_message_fake({ 1: { subject } }, [1]);
        await run("subject");
        assert.deepEqual(calls, [JSON.stringify({ text: { text: expected, subject: true } })], subject);
    }
});

test("filter.by recipient skips the user's own addresses, looks at Cc, and falls back to the first recipient", async () => {
    const picks = [
        [{ recipients: ["Me <ME@example.org>", "Bob <bob@example.org>"] }, "bob@example.org"],
        [{ recipients: ["me@example.org"], ccList: ["Cy <cy@example.org>"] }, "cy@example.org"],
        [{ recipients: ["me@example.org"] }, "me@example.org"],
    ] as const;
    for (const [message, expected] of picks) {
        const { run, calls } = by_message_fake({ 1: message }, [1], undefined, ["me@example.org"]);
        await run("recipient");
        assert.deepEqual(calls, [JSON.stringify({ text: { text: expected, recipients: true } })], expected);
    }
});

test("filter.by keeps tags when a text field comes and keeps the text when the tag comes", async () => {
    const { run, calls } = by_message_fake({ 1: SAMPLE }, [1]);
    await run("tag");
    await run("from");
    await run("tag");
    assert.deepEqual(calls, [
        '{"tags":{"mode":"any","tags":{"$label1":true}}}',
        '{"tags":{"mode":"any","tags":{"$label1":true}},"text":{"text":"ann@example.org","author":true}}',
        '{"tags":{"mode":"any","tags":{"$label1":true}},"text":{"text":"ann@example.org","author":true}}',
    ]);
});

test("filter.by reads the remembered filter after the message arrives, so a filter set meanwhile stays", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { run, calls, router_run } = by_message_fake({ 1: SAMPLE }, [1], undefined, [], gate);
    const pending = run("from");
    await router_run("filter.set", { state: "toggle_starred" });
    open();
    await pending;
    assert.equal(calls.at(-1), '{"flagged":true,"text":{"text":"ann@example.org","author":true}}');
});

test("filter.by waits for the stored filters to load before it reads the remembered one", async () => {
    let release: (stored: Record<string, unknown>) => void = () => undefined;
    const storage = { get: () => new Promise<Record<string, unknown>>((resolve) => (release = resolve)), set: async () => undefined };
    keep_filters(storage);
    const fake = by_message_fake({ 1: SAMPLE }, [1]);
    const tab_id = next_tab_id - 1;
    const pending = fake.run("from");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(fake.calls, []);
    release({ [APPLIED_FILTERS_STORAGE_KEY]: { [tab_id]: { unread: true } } });
    await pending;
    assert.deepEqual(fake.calls, ['{"unread":true,"text":{"text":"ann@example.org","author":true}}']);
    keep_filters(undefined);
});

// --- the list and date filters of the `filter` Experiment, and their re-apply after each `setQuickFilter`

const DEV_DAY = new Date("2026-03-08T12:00:00Z");
const LIST_MAIL: Record<number, { date: Date; headers: Record<string, string[]> }> = {
    1: { date: DEV_DAY, headers: { "List-Id": ["Dev list <dev.example.org>"] } },
    2: { date: new Date("2026-03-09T08:00:00Z"), headers: { "list-id": ["<ops.example.org>"] } },
    3: { date: new Date("2026-03-10T08:00:00Z"), headers: { subject: ["no list"] } },
};
const DEV_LIST = { tabId: 0, listId: "<dev.example.org>" };

/** One mail tab whose `setQuickFilter` and `filter.set` calls land in one list, in order, so a test reads what the tab shows after each step. The live search of `/` runs on the same fake. */
function terms_fake(options: { ids?: number[]; cursor_row?: number; filter?: "missing" | "failing"; search_runs_on?: boolean } = {}) {
    const tab_id = next_tab_id++;
    const steps: string[] = [];
    const notices: string[] = [];
    const filter_set = async (args: FilterSetArgs) => {
        if (options.filter === "failing") throw new Error("filter.set: the tab shows no message list");
        steps.push(`filter.set ${JSON.stringify({ ...args, tabId: args.tabId - tab_id })}`);
        return options.search_runs_on !== true;
    };
    const api = {
        mailTabs: {
            query: async () => [{ id: tab_id, displayedFolder: INBOX }],
            get: async () => ({ displayedFolder: INBOX }),
            update: async () => undefined,
            setQuickFilter: async (_id: number, filter: unknown) => void steps.push(`setQuickFilter ${JSON.stringify(filter)}`),
            setSelectedMessages: async () => undefined,
        },
        messages: {
            get: async (id: number) => ({ id, date: LIST_MAIL[id]!.date }),
            getFull: async (id: number) => ({ headers: LIST_MAIL[id]!.headers }),
            tags: { list: async () => [] },
        },
        app: { viewRows: async ({ first }: { first: number }) => ({ current: options.cursor_row ?? 0, rows: first === options.cursor_row ? [{ index: first, id: 2, depth: 0, collapsed: false, unread: false, flags: 0 }] : [{ index: first, id: 9, depth: 0, collapsed: false, unread: false, flags: 0 }] }) },
        filter: options.filter === "missing" ? undefined : { set: filter_set },
        folderpane: undefined,
        notifications: { create: async (_id: string, notification: { message: string }) => (notices.push(notification.message), "n1") },
        keys: undefined,
    };
    const router = create_router(registry, api as unknown as RouterApi);
    const run = (command: string, args: Record<string, string>) => router.run({ command, args, count: 1, windowId: 3, messageIds: options.ids ?? [1] });
    const timers = fake_timers();
    const search = create_search_service({ api: api as never, register: create_search_register(fake_storage().api.local), timers, say: async () => undefined });
    const type = async (text: string) => {
        const pending = search.type(3, text);
        await new Promise((resolve) => setImmediate(resolve));
        timers.advance(SEARCH_DEBOUNCE_MS);
        return pending;
    };
    return { run, steps, notices, search, type, api };
}

test("F m l filters on the List-Id in angle brackets and F m d on the message date in microseconds, after a setQuickFilter that keeps the other filters", async () => {
    const list = terms_fake();
    await list.run("filter.by", { field: "list" });
    assert.deepEqual(list.steps, ["setQuickFilter {}", `filter.set ${JSON.stringify(DEV_LIST)}`]);
    const date = terms_fake();
    await date.run("filter.set", { state: "unread" });
    await date.run("filter.by", { field: "date" });
    assert.deepEqual(date.steps.slice(1), ['setQuickFilter {"unread":true}', `filter.set ${JSON.stringify({ tabId: 0, dateUs: DEV_DAY.getTime() * 1000 })}`]);
});

test("F m l and F m d stack, and a later F m l swaps only the list", async () => {
    const { run, steps } = terms_fake();
    await run("filter.by", { field: "list" });
    await run("filter.by", { field: "date" });
    assert.equal(steps.at(-1), `filter.set ${JSON.stringify({ tabId: 0, listId: "<dev.example.org>", dateUs: DEV_DAY.getTime() * 1000 })}`);
});

test("F m l refuses a message with no List-Id and changes nothing", async () => {
    const { run, steps, notices } = terms_fake({ ids: [3] });
    await run("filter.by", { field: "list" });
    assert.deepEqual(notices, ["The selected message is not from a mailing list."]);
    assert.deepEqual(steps, []);
});

test("with several messages selected, F m l takes the cursor message, or the first selected when the cursor is outside the selection", async () => {
    const at_cursor = terms_fake({ ids: [1, 2], cursor_row: 4 });
    await at_cursor.run("filter.by", { field: "list" });
    assert.equal(at_cursor.steps.at(-1), `filter.set ${JSON.stringify({ tabId: 0, listId: "<ops.example.org>" })}`);
    const outside = terms_fake({ ids: [1, 3], cursor_row: 4 });
    await outside.run("filter.by", { field: "list" });
    assert.equal(outside.steps.at(-1), `filter.set ${JSON.stringify(DEV_LIST)}`);
});

test("re-apply after F u: the unread filter replaces the earlier quick filter and the list filter goes back on", async () => {
    const { run, steps } = terms_fake();
    await run("filter.by", { field: "list" });
    await run("filter.set", { state: "unread" });
    assert.deepEqual(steps.slice(2), ['setQuickFilter {"unread":true}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test("re-apply after F s: the star toggles on and off and the list filter goes back on each time", async () => {
    const { run, steps } = terms_fake();
    await run("filter.by", { field: "list" });
    await run("filter.set", { state: "toggle_starred" });
    await run("filter.set", { state: "toggle_starred" });
    assert.deepEqual(steps.slice(2), ['setQuickFilter {"flagged":true}', `filter.set ${JSON.stringify(DEV_LIST)}`, "setQuickFilter {}", `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test("F r clears the list and date filters, and a later F u brings neither back", async () => {
    const { run, steps } = terms_fake();
    await run("filter.by", { field: "list" });
    await run("filter.by", { field: "date" });
    await run("filter.set", { state: "all" });
    await run("filter.set", { state: "unread" });
    assert.deepEqual(steps.slice(4), ["setQuickFilter {}", 'setQuickFilter {"unread":true}']);
});

test("F m f after F m l keeps the list filter beside the sender text", async () => {
    const fake = terms_fake();
    fake.api.messages.get = async (id: number) => ({ id, date: DEV_DAY, author: "Ann <ann@example.org>" }) as never;
    await fake.run("filter.by", { field: "list" });
    await fake.run("filter.by", { field: "from" });
    assert.deepEqual(fake.steps.slice(2), ['setQuickFilter {"text":{"text":"ann@example.org","author":true}}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test("re-apply after /: each keystroke, the commit and Escape put the list filter back after their setQuickFilter", async () => {
    const { run, steps, search, type } = terms_fake();
    await run("filter.by", { field: "list" });
    await search.start(3, "forward");
    await type("inv");
    await search.cancel(3);
    const text = '{"text":{"text":"inv","subject":true,"author":true}}';
    assert.deepEqual(steps.slice(2), [`setQuickFilter ${text}`, `filter.set ${JSON.stringify(DEV_LIST)}`, "setQuickFilter {}", `filter.set ${JSON.stringify(DEV_LIST)}`]);
    await search.start(3, "forward");
    await search.commit(3, "inv").catch(() => undefined);
    assert.deepEqual(steps.slice(6, 8), [`setQuickFilter ${text}`, `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test("a re-apply the Experiment refuses leaves the quick filter alone in memory, so the next F u sends no list filter", async () => {
    const { run, steps, notices } = terms_fake({ filter: "failing" });
    await run("filter.by", { field: "list" });
    assert.equal(notices.length, 1);
    await run("filter.set", { state: "unread" });
    assert.deepEqual(steps, ["setQuickFilter {}", 'setQuickFilter {"unread":true}']);
});

test("F m l refuses when the filter Experiment did not load, and changes nothing", async () => {
    const { run, notices, steps } = terms_fake({ filter: "missing" });
    await run("filter.by", { field: "list" });
    assert.deepEqual(notices, ["The list and date filters need the DesertBird Experiment, which is not loaded."]);
    // The refusal comes before setQuickFilter, so the tab keeps its filter.
    assert.deepEqual(steps, []);
});

/** A gate a fake call waits on, and the call that opens it. */
function gate(): { passed: Promise<void>; open: () => void } {
    let open: () => void = () => undefined;
    const passed = new Promise<void>((resolve) => (open = resolve));
    return { passed, open };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("overlapping applies: F r pressed while F m l waits on filter.set runs after it, so the tab and the memory both end cleared", async () => {
    const fake = terms_fake();
    const terms = gate();
    const set = fake.api.filter!.set;
    fake.api.filter!.set = async (args) => (await terms.passed, set(args));
    const list = fake.run("filter.by", { field: "list" });
    while (!fake.steps.includes("setQuickFilter {}")) await settle();
    const reset = fake.run("filter.set", { state: "all" });
    await settle();
    terms.open();
    await Promise.all([list, reset]);
    assert.deepEqual(fake.steps, ["setQuickFilter {}", `filter.set ${JSON.stringify(DEV_LIST)}`, "setQuickFilter {}"]);
    // The memory holds no list filter, so F u sends none.
    await fake.run("filter.set", { state: "unread" });
    assert.deepEqual(fake.steps.slice(3), ['setQuickFilter {"unread":true}']);
});

test("F u while F m l still reads the message, with the read done before F u's setQuickFilter returns: the list filter applies after it and keeps the unread filter", async () => {
    const fake = terms_fake();
    const read_gate = gate();
    const unread_gate = gate();
    const read = fake.api.messages.getFull;
    fake.api.messages.getFull = async (id: number) => (await read_gate.passed, read(id));
    const quick = fake.api.mailTabs.setQuickFilter;
    fake.api.mailTabs.setQuickFilter = async (id: number, filter: unknown) => (JSON.stringify(filter) === '{"unread":true}' && (await unread_gate.passed), quick(id, filter));
    const list = fake.run("filter.by", { field: "list" });
    const unread = fake.run("filter.set", { state: "unread" });
    await settle();
    read_gate.open();
    await settle();
    unread_gate.open();
    await Promise.all([list, unread]);
    // F m l builds its filter in the chain, after F u has written the memory, so the unread filter stays.
    assert.deepEqual(fake.steps, ['setQuickFilter {"unread":true}', 'setQuickFilter {"unread":true}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
    await fake.run("filter.set", { state: "toggle_starred" });
    assert.deepEqual(fake.steps.slice(3), ['setQuickFilter {"unread":true,"flagged":true}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test("F u pressed while F m l waits in filter.set builds on the list filter instead of clearing it", async () => {
    const fake = terms_fake();
    const terms = gate();
    const set = fake.api.filter!.set;
    fake.api.filter!.set = async (args) => (await terms.passed, set(args));
    const list = fake.run("filter.by", { field: "list" });
    while (!fake.steps.includes("setQuickFilter {}")) await settle();
    const unread = fake.run("filter.set", { state: "unread" });
    await settle();
    terms.open();
    await Promise.all([list, unread]);
    assert.deepEqual(fake.steps, ["setQuickFilter {}", `filter.set ${JSON.stringify(DEV_LIST)}`, 'setQuickFilter {"unread":true}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test(":search waits for the stored filters to load and keeps their list filter", async () => {
    const fake = terms_fake();
    const tab_id = next_tab_id - 1;
    keep_filters({ get: async () => (await settle(), { [APPLIED_FILTERS_STORAGE_KEY]: { [tab_id]: { by_message: { list_id: "<dev.example.org>" } } } }), set: async () => undefined });
    await fake.run("search.threads", { query: "invoice" });
    keep_filters(undefined);
    assert.deepEqual(fake.steps, ['setQuickFilter {"text":{"text":"invoice","subject":true,"author":true}}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test("a / commit that finds no rows while the list search still runs refuses with a retry note, not a no-match, and keeps the search open", async () => {
    const { run, search, notices, api } = terms_fake({ search_runs_on: true });
    await run("filter.by", { field: "list" });
    // The rows of the list search have not come in yet.
    api.app.viewRows = async () => ({ current: -1, rows: [] }) as never;
    await search.start(3, "forward");
    await assert.rejects(search.commit(3, "nothing"), /still filtering/);
    assert.deepEqual(notices, []);
    await search.cancel(3);
});

test(":search keeps the list filter under its text", async () => {
    const { run, steps } = terms_fake();
    await run("filter.by", { field: "list" });
    await run("search.threads", { query: "invoice" });
    assert.deepEqual(steps.slice(2), ['setQuickFilter {"text":{"text":"invoice","subject":true,"author":true}}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
});

test("the list filter survives a restart of the background page through session storage, and F u re-applies it", async () => {
    const fake = terms_fake();
    const tab_id = next_tab_id - 1;
    const stored: Record<string, unknown> = {};
    keep_filters({ get: async () => ({}), set: async (items) => void Object.assign(stored, items) });
    await fake.run("filter.by", { field: "list" });
    assert.deepEqual((stored[APPLIED_FILTERS_STORAGE_KEY] as Record<string, unknown>)[tab_id], { by_message: { list_id: "<dev.example.org>" } });
    // A new page starts with an empty map and reads the stored one.
    keep_filters(undefined);
    forget_filter(tab_id);
    // F u comes before the stored filters have loaded and must wait for them.
    keep_filters({ get: async () => (await settle(), stored), set: async () => undefined });
    await fake.run("filter.set", { state: "unread" });
    keep_filters(undefined);
    assert.deepEqual(fake.steps.slice(2), ['setQuickFilter {"unread":true}', `filter.set ${JSON.stringify(DEV_LIST)}`]);
});
