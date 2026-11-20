import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { record_activation } from "../src/background/handlers/tabs.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";

interface FakeTab {
    id: number;
    index: number;
    active: boolean;
    title: string;
    window_id?: number;
}

/** A tab bar: the first tab is the main mail tab. `active` is the index of the active tab. */
const bar = (active: number, titles: string[]): FakeTab[] => titles.map((title, index) => ({ id: 10 + index, index, active: index === active, title, window_id: 3 }));

function with_tabs(tabs: FakeTab[], window_type = "normal", session: Record<string, unknown> | null = {}) {
    const calls: string[] = [];
    // Each update moves the active mark, as the real API does, so a repeated step reads the state the step before left.
    const move_active = (id: number) => tabs.forEach((tab) => void (tab.active = tab.id === id));
    const tabs_api = {
        query: async (query: object) => (calls.push(`tabs.query ${JSON.stringify(query)}`), tabs),
        update: async (id: number, properties: object) => (calls.push(`tabs.update ${id} ${JSON.stringify(properties)}`), move_active(id)),
        remove: async (id: number) => void calls.push(`tabs.remove ${id}`),
        move: async (id: number, properties: object) => void calls.push(`tabs.move ${id} ${JSON.stringify(properties)}`),
    };
    const storage = { session: session === null ? undefined : { get: async (key: string) => (key in session ? { [key]: session[key] } : {}), set: async (items: Record<string, unknown>) => void Object.assign(session, items) } };
    // The tab commands read only `tabs` and the router only `notifications`, so the rest of the messenger is absent.
    const windows = {
        get: async (id: number) => (calls.push(`windows.get ${id}`), { type: window_type }),
        remove: async (id: number) => void calls.push(`windows.remove ${id}`),
    };
    const app = { paneFocus: async (args: object) => void calls.push(`paneFocus ${JSON.stringify(args)}`) };
    const api = { tabs: tabs_api, windows, app, storage, notifications: { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") } };
    return { api: api as unknown as RouterApi, calls };
}

const invoke = (command: string, args: Record<string, string> = {}, count = 1) => ({ command, args, count, windowId: 3, messageIds: [] });
const run = (api: RouterApi, command: string, args?: Record<string, string>, count?: number) => create_router(registry, api).run(invoke(command, args, count));
const writes = (calls: string[]) => calls.filter((call) => call.startsWith("tabs.update") || call.startsWith("tabs.move") || call.startsWith("tabs.remove") || call.startsWith("windows.remove"));
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify"));

test("tab.next selects the next tab of the key's window and wraps from the last to the first", async () => {
    const middle = with_tabs(bar(1, ["Mail", "Docs", "Message"]));
    await run(middle.api, "tab.next");
    assert.deepEqual(writes(middle.calls), ['tabs.update 12 {"active":true}']);
    assert.ok(middle.calls.includes('tabs.query {"windowId":3}'));
    const last = with_tabs(bar(2, ["Mail", "Docs", "Message"]));
    await run(last.api, "tab.next");
    assert.deepEqual(writes(last.calls), ['tabs.update 10 {"active":true}']);
});

test("tab.prev selects the previous tab and wraps from the first to the last", async () => {
    const middle = with_tabs(bar(1, ["Mail", "Docs", "Message"]));
    await run(middle.api, "tab.prev");
    assert.deepEqual(writes(middle.calls), ['tabs.update 10 {"active":true}']);
    const first = with_tabs(bar(0, ["Mail", "Docs", "Message"]));
    await run(first.api, "tab.prev");
    assert.deepEqual(writes(first.calls), ['tabs.update 12 {"active":true}']);
});

test("tab.next with one tab refuses with a notification and changes nothing", async () => {
    const only = with_tabs(bar(0, ["Mail"]));
    await run(only.api, "tab.next");
    assert.deepEqual(writes(only.calls), []);
    assert.equal(notifications(only.calls).length, 1);
});

test("tab.switch picks by number counted from 1 and by part of a title", async () => {
    const by_number = with_tabs(bar(0, ["Mail", "Docs", "Message"]));
    await run(by_number.api, "tab.switch", { tab: "3" });
    assert.deepEqual(writes(by_number.calls), ['tabs.update 12 {"active":true}']);
    const by_title = with_tabs(bar(0, ["Mail", "Docs", "Message"]));
    await run(by_title.api, "tab.switch", { tab: "doc" });
    assert.deepEqual(writes(by_title.calls), ['tabs.update 11 {"active":true}']);
});

test("tab.switch prefers a whole title over a title that contains it", async () => {
    const box = with_tabs(bar(0, ["Mail", "Re: Budget", "Budget"]));
    await run(box.api, "tab.switch", { tab: "budget" });
    assert.deepEqual(writes(box.calls), ['tabs.update 12 {"active":true}']);
});

test("tab.switch refuses a number past the last tab and a title nothing matches", async () => {
    for (const tab of ["4", "0", "nothing"]) {
        const { api, calls } = with_tabs(bar(0, ["Mail", "Docs", "Message"]));
        await run(api, "tab.switch", { tab });
        assert.deepEqual(writes(calls), [], tab);
        assert.equal(notifications(calls).length, 1, tab);
    }
});

test("tab.close removes the active tab when it is not the first", async () => {
    const { api, calls } = with_tabs(bar(2, ["Mail", "Docs", "Message"]));
    await run(api, "tab.close");
    assert.deepEqual(writes(calls), ["tabs.remove 12"]);
    assert.deepEqual(notifications(calls), []);
});

test("tab.close on the main mail tab moves the focus to the thread list and never calls tabs.remove", async () => {
    for (const titles of [["Mail"], ["Mail", "Docs"]]) {
        const { api, calls } = with_tabs(bar(0, titles));
        await run(api, "tab.close");
        assert.deepEqual(writes(calls), [], titles.join());
        assert.ok(calls.includes('paneFocus {"windowId":3,"pane":"threads"}'), titles.join());
        assert.deepEqual(notifications(calls), [], titles.join());
    }
});

test("tab.close in a compose window removes nothing as a window", async () => {
    const { api, calls } = with_tabs(bar(0, ["Compose"]), "messageCompose");
    await run(api, "tab.close");
    assert.deepEqual(writes(calls), []);
});

test("tab.close in a message window removes the window and not the tab", async () => {
    const { api, calls } = with_tabs(bar(0, ["Message"]), "messageDisplay");
    await run(api, "tab.close");
    assert.deepEqual(writes(calls), ["windows.remove 3"]);
    assert.deepEqual(notifications(calls), []);
});

test("a window the Experiment could not name falls back to the current window", async () => {
    const { api, calls } = with_tabs(bar(0, ["Mail", "Docs"]));
    await create_router(registry, api).run({ ...invoke("tab.next"), windowId: -1 });
    assert.ok(calls.includes('tabs.query {"currentWindow":true}'));
});

test("a count makes one update to the tab that many steps away, wrapping", async () => {
    const titles = ["Mail", "Docs", "Message", "More"];
    const cases: [string, number, number, number][] = [
        ["tab.next", 0, 3, 13],
        ["tab.next", 2, 3, 11],
        ["tab.prev", 1, 3, 12],
        ["tab.next", 1, 9, 12],
        ["tab.prev", 1, 9, 10],
        ["tab.next", 1, 1, 12],
        ["tab.prev", 1, 1, 10],
    ];
    for (const [command, active, count, expected_id] of cases) {
        const { api, calls } = with_tabs(bar(active, titles));
        await run(api, command, {}, count);
        assert.deepEqual(writes(calls), [`tabs.update ${expected_id} {"active":true}`], `${command} from ${active} by ${count}`);
    }
});

test("a count does not repeat tab.close", async () => {
    const { api, calls } = with_tabs(bar(1, ["Mail", "Mail two", "Docs"]));
    await run(api, "tab.close", {}, 3);
    assert.deepEqual(writes(calls), ["tabs.remove 11"]);
});

test("tab.close closes a second mail tab, the one tab a key can be pressed in", async () => {
    const { api, calls } = with_tabs(bar(1, ["Mail", "Folder"]));
    await run(api, "tab.close");
    assert.deepEqual(writes(calls), ["tabs.remove 11"]);
});

test("tab.close with no tab id says so and removes nothing", async () => {
    const tabs = bar(1, ["Mail", "Folder"]);
    delete (tabs[1] as Partial<FakeTab>).id;
    const { api, calls } = with_tabs(tabs);
    await run(api, "tab.close");
    assert.deepEqual(writes(calls), []);
    assert.deepEqual(notifications(calls), ["notify The tab has no id, so it cannot be closed."]);
});

test("tab.goto 1 and -1 pick the first and the last tab, and a place past either end refuses", async () => {
    for (const [index, expected] of [["-1", "12"], ["1", "10"], ["-3", "10"]] as const) {
        const { api, calls } = with_tabs(bar(1, ["Mail", "Docs", "Message"]));
        await run(api, "tab.goto", { index });
        assert.deepEqual(writes(calls), [`tabs.update ${expected} {"active":true}`], index);
    }
    for (const index of ["4", "-4", "0"]) {
        const { api, calls } = with_tabs(bar(1, ["Mail", "Docs", "Message"]));
        await run(api, "tab.goto", { index });
        assert.deepEqual(writes(calls), [], index);
        assert.equal(notifications(calls).length, 1, index);
    }
});

test("tab.alternate goes to the tab the last activation left", async () => {
    const session: Record<string, unknown> = {};
    await record_activation(session_of(session), { windowId: 3, previousTabId: 10 });
    const tabs = bar(2, ["Mail", "Docs", "Message"]);
    const { api, calls } = with_tabs(tabs, "normal", session);
    await run(api, "tab.alternate");
    assert.deepEqual(writes(calls), ['tabs.update 10 {"active":true}']);
    assert.equal(notifications(calls).length, 0);
});

test("tab.alternate reads the record of its own window only", async () => {
    const session: Record<string, unknown> = {};
    await record_activation(session_of(session), { windowId: 4, previousTabId: 10 });
    const { api, calls } = with_tabs(bar(2, ["Mail", "Docs", "Message"]), "normal", session);
    await run(api, "tab.alternate");
    assert.deepEqual(writes(calls), []);
    assert.equal(notifications(calls).length, 1);
});

test("tab.alternate refuses when the last used tab is closed, when nothing was recorded and in a window of one tab", async () => {
    const closed = with_tabs(bar(2, ["Mail", "Docs", "Message"]), "normal", { desertbird_last_tab_3: 99 });
    await run(closed.api, "tab.alternate");
    const empty = with_tabs(bar(2, ["Mail", "Docs", "Message"]));
    await run(empty.api, "tab.alternate");
    const message_window = with_tabs(bar(0, ["Message"]), "messageDisplay", { desertbird_last_tab_3: 10 });
    await run(message_window.api, "tab.alternate");
    const no_session = with_tabs(bar(2, ["Mail", "Docs", "Message"]), "normal", null);
    await run(no_session.api, "tab.alternate");
    for (const { calls } of [closed, empty, message_window, no_session]) {
        assert.deepEqual(writes(calls), []);
        assert.equal(notifications(calls).length, 1);
    }
});

test("record_activation stores nothing without a previous tab or without session storage", async () => {
    const session: Record<string, unknown> = {};
    await record_activation(session_of(session), { windowId: 3 });
    await record_activation(undefined, { windowId: 3, previousTabId: 10 });
    assert.deepEqual(session, {});
});

test("tab.move by offset moves the tab along the bar and stops before the mail tab and at the end", async () => {
    const cases: [number, string, string][] = [[2, "-1", "1"], [2, "-5", "1"], [1, "1", "2"], [1, "5", "3"], [3, "2", "3"]];
    for (const [active, offset, index] of cases) {
        const { api, calls } = with_tabs(bar(active, ["Mail", "A", "B", "C"]));
        await run(api, "tab.move", { offset });
        const expected = Number(index) === active ? [] : [`tabs.move ${10 + active} {"index":${index}}`];
        assert.deepEqual(writes(calls), expected, `${active} by ${offset}`);
    }
});

test("tab.move by place counts from 1, from the end when negative, and a place wins over the offset", async () => {
    for (const [tab, index] of [["3", 2], ["-1", 3], ["1", 1]] as const) {
        const { api, calls } = with_tabs(bar(1, ["Mail", "A", "B", "C"]));
        await run(api, "tab.move", { tab, offset: "1" });
        assert.deepEqual(writes(calls), index === 1 ? [] : [`tabs.move 11 {"index":${index}}`], tab);
    }
});

test("tab.move onto a tab by title takes its place", async () => {
    const { api, calls } = with_tabs(bar(1, ["Mail", "Docs", "Budget"]));
    await run(api, "tab.move", { tab: "budget" });
    assert.deepEqual(writes(calls), ['tabs.move 11 {"index":2}']);
});

test("tab.move never moves the first tab and refuses a window of one tab, tab 0 and an unknown title", async () => {
    const attempts: [FakeTab[], Record<string, string>][] = [[bar(0, ["Mail", "A"]), { offset: "1" }], [bar(0, ["Message"]), { offset: "1" }], [bar(1, ["Mail", "A"]), { tab: "0" }], [bar(1, ["Mail", "A"]), { tab: "nothing" }]];
    for (const [tabs, args] of attempts) {
        const { api, calls } = with_tabs(tabs);
        await run(api, "tab.move", args);
        assert.deepEqual(writes(calls), [], JSON.stringify(args));
        assert.equal(notifications(calls).length, 1, JSON.stringify(args));
    }
});

const session_of = (record: Record<string, unknown>) => ({ get: async (key: string) => (key in record ? { [key]: record[key] } : {}), set: async (items: Record<string, unknown>) => void Object.assign(record, items) });
