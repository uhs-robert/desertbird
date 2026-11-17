import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { create_config_store, SETTINGS_KEY } from "../src/background/config/store.ts";
import { NOTIFICATION_MAP_KEY, create_new_mail_notifier } from "../src/background/new_mail_notify.ts";
import type { NewMailApi } from "../src/background/new_mail_notify.ts";

type Header = { id: number; author?: string; subject?: string; read?: boolean; junk?: boolean };

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Storage that survives a restart: pass the same `data` to a second harness. Fires onChanged after each write. */
function harness(data: Record<string, unknown> = {}, options: { existing?: number[] } = {}) {
    const calls: string[] = [];
    const storage_listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
    const listeners = { mail: [] as ((folder: { type?: string }, list: { messages: Header[] }) => void)[], clicked: [] as ((id: string) => void)[], closed: [] as ((id: string) => void)[] };
    const known = new Set(options.existing ?? []);
    const api: NewMailApi = {
        messages: {
            get: async (id) => {
                if (!known.has(id)) throw new Error(`Message not found: ${id}.`);
                return { id };
            },
            onNewMailReceived: { addListener: (listener) => void listeners.mail.push(listener) },
        },
        messageDisplay: { open: async ({ messageId }) => void calls.push(`open ${messageId}`) },
        notifications: {
            create: async (id, options) => (calls.push(`create ${id ?? "-"} ${options.title} | ${options.message}`), id ?? "-"),
            clear: async (id) => (calls.push(`clear ${id}`), true),
            onClicked: { addListener: (listener) => void listeners.clicked.push(listener) },
            onClosed: { addListener: (listener) => void listeners.closed.push(listener) },
        },
        storage: {
            local: {
                get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])])),
                set: async (items) => {
                    Object.assign(data, structuredClone(items));
                    const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }]));
                    storage_listeners.forEach((listener) => listener(changes, "local"));
                },
            },
            onChanged: { addListener: (listener) => void storage_listeners.push(listener) },
        },
    };
    const config_store = create_config_store(api);
    const notifier = create_new_mail_notifier(api, async () => (await config_store.read()).settings.notify_new_mail);
    notifier.register();
    return {
        api,
        data,
        calls,
        listeners,
        config_store,
        deliver: async (messages: Header[], folder_type = "inbox") => {
            listeners.mail.forEach((listener) => listener({ type: folder_type }, { messages }));
            await settle();
        },
        click: async (id: string) => {
            listeners.clicked.forEach((listener) => listener(id));
            await settle();
        },
    };
}

const on = { [SETTINGS_KEY]: { notify_new_mail: true } };
const mail = (id: number, extra: Partial<Header> = {}): Header => ({ id, author: `Ann ${id} <a${id}@x.invalid>`, subject: `Subject ${id}`, read: false, ...extra });

test("the setting is off by default and nothing is shown", async () => {
    const { deliver, calls } = harness();
    await deliver([mail(1)]);
    assert.deepEqual(calls, []);
});

test("an unread inbox message shows sender and subject", async () => {
    const { deliver, calls } = harness({ ...on });
    await deliver([mail(1)]);
    assert.deepEqual(calls, ["create desertbird-new-mail-1 New mail | Ann 1 <a1@x.invalid>: Subject 1"]);
});

test("read, junk and non-inbox mail is skipped", async () => {
    const { deliver, calls } = harness({ ...on });
    await deliver([mail(1, { read: true }), mail(2, { junk: true })]);
    await deliver([mail(3)], "archives");
    assert.deepEqual(calls, []);
});

test("three messages give three notifications, four give one batch", async () => {
    const { deliver, calls, data } = harness({ ...on });
    await deliver([mail(1), mail(2), mail(3)]);
    assert.equal(calls.length, 3);
    calls.length = 0;
    await deliver([mail(4), mail(5), mail(6), mail(7)]);
    assert.deepEqual(calls, ["create desertbird-new-mail-batch-4 New mail | 4 new messages"]);
    assert.deepEqual((data[NOTIFICATION_MAP_KEY] as Record<string, number[]>)["desertbird-new-mail-batch-4"], [4, 5, 6, 7]);
});

test("the batch counts only wanted messages", async () => {
    const { deliver, calls } = harness({ ...on });
    await deliver([mail(1), mail(2), mail(3), mail(4, { read: true }), mail(5, { junk: true })]);
    assert.equal(calls.length, 3);
});

test("the listeners register once, and a restart on the same storage registers its own once", async () => {
    const first = harness({ ...on });
    assert.deepEqual([first.listeners.mail.length, first.listeners.clicked.length, first.listeners.closed.length], [1, 1, 1]);
    const second = harness(first.data);
    assert.deepEqual([second.listeners.mail.length, second.listeners.clicked.length, second.listeners.closed.length], [1, 1, 1]);
});

test("a click opens the message and takes the notification down", async () => {
    const { deliver, click, calls } = harness({ ...on }, { existing: [1] });
    await deliver([mail(1)]);
    calls.length = 0;
    await click("desertbird-new-mail-1");
    assert.deepEqual(calls, ["open 1", "clear desertbird-new-mail-1"]);
});

test("a click opens the first message of a batch", async () => {
    const { deliver, click, calls } = harness({ ...on }, { existing: [4, 5, 6, 7] });
    await deliver([mail(4), mail(5), mail(6), mail(7)]);
    calls.length = 0;
    await click("desertbird-new-mail-batch-4");
    assert.equal(calls[0], "open 4");
});

test("a click after a background restart reads the map from storage", async () => {
    const before = harness({ ...on }, { existing: [1] });
    await before.deliver([mail(1)]);
    const after = harness(before.data, { existing: [1] });
    await after.click("desertbird-new-mail-1");
    assert.deepEqual(after.calls, ["open 1", "clear desertbird-new-mail-1"]);
});

test("a click on a deleted message says so and opens nothing", async () => {
    const { deliver, click, calls } = harness({ ...on }, { existing: [] });
    await deliver([mail(1)]);
    calls.length = 0;
    await click("desertbird-new-mail-1");
    assert.deepEqual(calls, ["create - DesertBird | That message no longer exists."]);
});

test("a click on an id the map does not know does nothing", async () => {
    const { click, calls } = harness({ ...on });
    await click("someone-else");
    assert.deepEqual(calls, []);
});

test("closing a notification drops its map entry", async () => {
    const { deliver, listeners, data } = harness({ ...on });
    await deliver([mail(1), mail(2)]);
    listeners.closed.forEach((listener) => listener("desertbird-new-mail-1"));
    await settle();
    assert.deepEqual(Object.keys(data[NOTIFICATION_MAP_KEY] as object), ["desertbird-new-mail-2"]);
});

test("two events at once keep both map entries", async () => {
    const { listeners, data } = harness({ ...on });
    listeners.mail.forEach((listener) => {
        listener({ type: "inbox" }, { messages: [mail(1)] });
        listener({ type: "inbox" }, { messages: [mail(2)] });
    });
    await settle();
    assert.deepEqual(Object.keys(data[NOTIFICATION_MAP_KEY] as object).sort(), ["desertbird-new-mail-1", "desertbird-new-mail-2"]);
});

test("turning the setting off clears the open notifications and the map", async () => {
    const { deliver, api, calls, data } = harness({ ...on });
    await deliver([mail(1), mail(2)]);
    calls.length = 0;
    await api.storage.local.set({ [SETTINGS_KEY]: { notify_new_mail: false } });
    await settle();
    assert.deepEqual(calls.sort(), ["clear desertbird-new-mail-1", "clear desertbird-new-mail-2"]);
    assert.deepEqual(data[NOTIFICATION_MAP_KEY], {});
});

test("a settings change that leaves it on clears nothing", async () => {
    const { deliver, api, calls } = harness({ ...on });
    await deliver([mail(1)]);
    calls.length = 0;
    await api.storage.local.set({ [SETTINGS_KEY]: { notify_new_mail: true, toast_ms: 5 } });
    await settle();
    assert.deepEqual(calls, []);
});

test("notify.toggle flips the setting both ways and says which", async () => {
    const { api, data, calls, deliver } = harness();
    const command = registry.get("notify.toggle")!;
    const run = () => command.run!({ api, window_id: 1, message_ids: [], count: 1 } as never, {} as never);
    await run();
    assert.equal((data[SETTINGS_KEY] as { notify_new_mail: boolean }).notify_new_mail, true);
    assert.deepEqual(calls, ["create - DesertBird | New-mail notifications are on."]);
    await settle();
    await deliver([mail(1)]);
    assert.equal(calls.length, 2);
    await run();
    assert.equal((data[SETTINGS_KEY] as { notify_new_mail: boolean }).notify_new_mail, false);
});

test("notify.toggle keeps the other settings", async () => {
    const { api, data } = harness({ [SETTINGS_KEY]: { toast_ms: 7 } });
    await registry.get("notify.toggle")!.run!({ api, window_id: 1, message_ids: [], count: 1 } as never, {} as never);
    assert.deepEqual(data[SETTINGS_KEY], { toast_ms: 7, notify_new_mail: true });
});
