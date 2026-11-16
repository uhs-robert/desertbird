import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
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

function with_tabs(tabs: FakeTab[]) {
    const calls: string[] = [];
    const tabs_api = {
        query: async (query: object) => (calls.push(`tabs.query ${JSON.stringify(query)}`), tabs),
        update: async (id: number, properties: object) => void calls.push(`tabs.update ${id} ${JSON.stringify(properties)}`),
        remove: async (id: number) => void calls.push(`tabs.remove ${id}`),
    };
    // The tab commands read only `tabs` and the router only `notifications`, so the rest of the messenger is absent.
    const api = { tabs: tabs_api, notifications: { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") }, keys: undefined };
    return { api: api as unknown as RouterApi, calls };
}

const invoke = (command: string, args: Record<string, string> = {}) => ({ command, args, count: 1, windowId: 3, messageIds: [] });
const run = (api: RouterApi, command: string, args?: Record<string, string>) => create_router(registry, api).run(invoke(command, args));
const writes = (calls: string[]) => calls.filter((call) => call.startsWith("tabs.update") || call.startsWith("tabs.remove"));
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

test("tab.close refuses on the main mail tab, alone or with others, and never calls tabs.remove", async () => {
    for (const titles of [["Mail"], ["Mail", "Docs"]]) {
        const { api, calls } = with_tabs(bar(0, titles));
        await run(api, "tab.close");
        assert.deepEqual(writes(calls), [], titles.join());
        assert.deepEqual(notifications(calls), ["notify The main mail tab cannot be closed."], titles.join());
    }
});

test("a window the Experiment could not name falls back to the current window", async () => {
    const { api, calls } = with_tabs(bar(0, ["Mail", "Docs"]));
    await create_router(registry, api).run({ ...invoke("tab.next"), windowId: -1 });
    assert.ok(calls.includes('tabs.query {"currentWindow":true}'));
});
