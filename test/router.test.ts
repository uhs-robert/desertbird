import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/registry.ts";
import { create_registry } from "../vendor/desertfox/registry/define.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";

interface FakeOptions {
    selected?: { id: number; folder?: { accountId: string } }[];
    displayed?: { id: number; date?: Date; folder?: { accountId: string } }[];
    identities?: unknown[];
    experiment?: boolean;
    page_size?: number;
}

/** A recording fake of the API subset. `calls` holds one line per call, in order. */
export function fake_api(options: FakeOptions = {}): { api: RouterApi; calls: string[] } {
    const calls: string[] = [];
    // The selection comes back in pages of `page_size`, as Thunderbird pages a long message list.
    const page_size = options.page_size ?? Infinity;
    const selected = options.selected ?? [];
    const page_at = (start: number) => ({ id: start + page_size < selected.length ? `page-${start + page_size}` : null, messages: selected.slice(start, start + page_size) });
    const api: RouterApi = {
        tabs: { query: async (query) => (calls.push(`tabs.query ${query.windowId}`), [{ id: 7 }]) },
        mailTabs: {
            getSelectedMessages: async (tab_id) => (calls.push(`mailTabs.getSelectedMessages ${tab_id}`), page_at(0)),
        },
        // A bare array, as Thunderbird 153 and Betterbird return it.
        messageDisplay: { getDisplayedMessages: async (tab_id) => (calls.push(`messageDisplay.getDisplayedMessages ${tab_id}`), (options.displayed ?? options.selected ?? []).map((message) => ({ date: new Date(0), ...message }))) },
        messages: {
            archive: async (ids) => void calls.push(`messages.archive ${ids.join(",")}`),
            delete: async (ids) => void calls.push(`messages.delete ${ids.join(",")}`),
            continueList: async (list_id) => (calls.push(`messages.continueList ${list_id}`), page_at(Number(list_id.slice("page-".length)))),
        },
        compose: { beginReply: async (id, type) => (calls.push(`compose.beginReply ${id} ${type}`), undefined) },
        identities: { list: async (account_id) => (calls.push(`identities.list ${account_id}`), options.identities ?? [{ id: "i1" }]) },
        notifications: { create: async (_id, notification) => (calls.push(`notify ${notification.message}`), "n1") },
        keys: options.experiment === false ? undefined : { install: async () => {}, onInvocation: { addListener: () => {}, removeListener: () => {} } },
    };
    return { api, calls };
}

const invoke = (command: string, args: Record<string, string> = {}) => ({ command, args, count: 1, windowId: 3 });
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify"));

test("r with no identity refuses and never calls beginReply", async () => {
    const { api, calls } = fake_api({ selected: [{ id: 5, folder: { accountId: "a1" } }], identities: [] });
    await create_router(registry, api).run(invoke("msg.reply", { to: "sender" }));
    assert.ok(calls.includes("identities.list a1"));
    assert.equal(calls.some((call) => call.startsWith("compose.beginReply")), false);
    assert.equal(notifications(calls).length, 1);
});

test("r with an identity opens a reply to the sender", async () => {
    const { api, calls } = fake_api({ selected: [{ id: 5, folder: { accountId: "a1" } }] });
    await create_router(registry, api).run(invoke("msg.reply", { to: "sender" }));
    assert.ok(calls.includes("compose.beginReply 5 replyToSender"));
    assert.deepEqual(notifications(calls), []);
});

test("r on a collapsed thread root replies to the newest displayed message", async () => {
    // A collapsed root displays the whole thread. The array order is not the date order here, so the date decides.
    const at_minute = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
    const thread = [
        { id: 5, date: at_minute(1) },
        { id: 8, date: at_minute(4) },
        { id: 6, date: at_minute(2) },
        { id: 7, date: at_minute(3) },
    ].map((message) => ({ ...message, folder: { accountId: "a1" } }));
    const { api, calls } = fake_api({ selected: thread, displayed: thread });
    await create_router(registry, api).run(invoke("msg.reply", { to: "sender" }));
    assert.deepEqual(calls.filter((call) => call.startsWith("compose.")), ["compose.beginReply 8 replyToSender"]);
    assert.deepEqual(notifications(calls), []);
});

test("r with several displayed messages and no identity refuses and never calls beginReply", async () => {
    const two = [5, 6].map((id) => ({ id, folder: { accountId: "a1" } }));
    const { api, calls } = fake_api({ selected: two, displayed: two, identities: [] });
    await create_router(registry, api).run(invoke("msg.reply", { to: "sender" }));
    assert.ok(calls.includes("identities.list a1"));
    assert.equal(calls.some((call) => call.startsWith("compose.beginReply")), false);
    assert.equal(notifications(calls).length, 1);
});

test("r with no displayed message refuses", async () => {
    const { api, calls } = fake_api({ selected: [], displayed: [] });
    await create_router(registry, api).run(invoke("msg.reply", { to: "sender" }));
    assert.equal(notifications(calls).length, 1);
});

test("a missing Experiment refuses a command that needs it, before any selection read", async () => {
    const local = create_registry();
    local.define("test.needs_keys", { runs_in: "background", label: "Probe", intent: "Probe the Experiment check.", needs: ["keys.install"], run: async () => {} });
    const { api, calls } = fake_api({ selected: [{ id: 5 }], experiment: false });
    await create_router(local, api).run(invoke("test.needs_keys"));
    assert.deepEqual(calls.map((call) => call.split(" ")[0]), ["notify"]);
    assert.match(notifications(calls)[0] ?? "", /Experiment/);
});

test("a missing Experiment does not block a command that needs no view verb", async () => {
    for (const [command, call] of [["msg.reply", "compose.beginReply 5 replyToSender"], ["msg.archive", "messages.archive 5"], ["msg.delete", "messages.delete 5"]] as const) {
        const { api, calls } = fake_api({ selected: [{ id: 5, folder: { accountId: "a1" } }], experiment: false });
        await create_router(registry, api).run(invoke(command, command === "msg.reply" ? { to: "sender" } : {}));
        assert.ok(calls.includes(call), command);
    }
});

test("x and d d pass every selected id", async () => {
    for (const [command, call] of [["msg.archive", "messages.archive 4,5,6"], ["msg.delete", "messages.delete 4,5,6"]] as const) {
        const { api, calls } = fake_api({ selected: [{ id: 4 }, { id: 5 }, { id: 6 }] });
        await create_router(registry, api).run(invoke(command));
        assert.ok(calls.includes(call), command);
        assert.deepEqual(notifications(calls), []);
    }
});

test("x and d d act on every page of a long selection", async () => {
    for (const [command, call] of [["msg.archive", "messages.archive 1,2,3,4,5"], ["msg.delete", "messages.delete 1,2,3,4,5"]] as const) {
        const { api, calls } = fake_api({ selected: [1, 2, 3, 4, 5].map((id) => ({ id })), page_size: 2 });
        await create_router(registry, api).run(invoke(command));
        assert.deepEqual(calls.filter((entry) => entry.startsWith("messages.continueList")), ["messages.continueList page-2", "messages.continueList page-4"], command);
        assert.ok(calls.includes(call), command);
    }
});

test("a bad arg, an unknown command and a chrome command each end in a notification", async () => {
    for (const bad of [invoke("msg.reply", { to: "everyone" }), invoke("no.such"), invoke("motion.down")]) {
        const { api, calls } = fake_api({ selected: [{ id: 5 }] });
        await create_router(registry, api).run(bad);
        assert.equal(notifications(calls).length, 1, bad.command);
        assert.equal(calls.some((call) => call.startsWith("messages.") || call.startsWith("compose.")), false);
    }
});

test("an API failure becomes a notification, not a throw", async () => {
    const { api, calls } = fake_api({ selected: [{ id: 5 }] });
    api.messages.archive = () => Promise.reject(new Error("disk full"));
    await create_router(registry, api).run(invoke("msg.archive"));
    assert.match(notifications(calls)[0] ?? "", /disk full/);
});
