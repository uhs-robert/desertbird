import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { DEFAULT_KEYMAP, MESSAGE_KEYMAP, UNREPEATABLE_IDS } from "../src/background/commands/index.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";

interface StorageChange {
    newValue?: unknown;
}

/** A stand-in for the `messenger` global the background entry reads: storage that fires `onChanged` on each write, and a recording `keys.install`. */
function stub_messenger(stored: Record<string, unknown> = {}, read_delays_ms: number[] = []) {
    const change_listeners: ((changes: Record<string, StorageChange>, area: string) => void)[] = [];
    const installs: unknown[] = [];
    let report_read: () => void = () => {};
    const first_read = new Promise<void>((resolve) => (report_read = resolve));
    const messenger = {
        storage: {
            local: {
                get: async (key: string) => {
                    const value = stored[key];
                    report_read();
                    await new Promise((resolve) => setTimeout(resolve, read_delays_ms.shift() ?? 0));
                    return value === undefined ? {} : { [key]: value };
                },
                set: async (items: Record<string, unknown>) => {
                    Object.assign(stored, items);
                    const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
                    setTimeout(() => change_listeners.forEach((listener) => listener(changes, "local")), 0);
                },
            },
            onChanged: { addListener: (listener: (changes: Record<string, StorageChange>, area: string) => void) => void change_listeners.push(listener) },
        },
        keys: { install: async (args: { tree: unknown }) => void installs.push(args.tree), onInvocation: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} } },
        notifications: { create: async () => "n" },
        alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
        mailTabs: { query: async () => [], onDisplayedFolderChanged: { addListener: () => {} } },
    };
    (globalThis as Record<string, unknown>)["messenger"] = messenger;
    const external_write = (items: Record<string, unknown>) => {
        Object.assign(stored, items);
        const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
        change_listeners.forEach((listener) => listener(changes, "local"));
    };
    return { stored, installs, external_write, first_read };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
let instance = 0;
// Each case loads its own copy of the entry module, because it starts on import.
const start_background = () => import(`../src/background/main.ts?instance=${instance++}`);

test("the first start stores the keymap and installs it once, though its own write fires onChanged", async () => {
    const { stored, installs } = stub_messenger();
    await start_background();
    await settle();
    assert.equal(installs.length, 1);
    assert.ok(stored["desertbird_compiled_keymap"]);
});

test("a stored keymap compiled from other default bindings is rebuilt", async () => {
    // Every check but the source hash passes, so only the hash can trigger the rebuild.
    const stale_tree = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored, installs } = stub_messenger({ desertbird_compiled_keymap: { record_version: 3, source_hash: "an older default keymap", tree: stale_tree, message_tree: stale_tree } });
    await start_background();
    await settle();
    assert.equal(installs.length, 1);
    assert.notDeepEqual(installs[0], stale_tree);
    assert.notEqual((stored["desertbird_compiled_keymap"] as { source_hash: string }).source_hash, "an older default keymap");
});

test("a storage change during a pending read wins: the tree read before the change is neither kept nor installed last", async () => {
    const source_hash = createHash("sha256").update(JSON.stringify({ keymap: DEFAULT_KEYMAP, message: MESSAGE_KEYMAP, unrepeatable: [...UNREPEATABLE_IDS], settings: {} })).digest("hex");
    const record = (marker: string) => ({ record_version: 4, source_hash, tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {}, marker } }, message_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } } });
    const { installs, external_write, first_read } = stub_messenger({ desertbird_compiled_keymap: record("old") }, [40, 0]);
    await start_background();
    await first_read;
    // The start is still reading "old" when "new" lands, and the read of "new" answers first.
    external_write({ desertbird_compiled_keymap: record("new") });
    await settle();
    assert.deepEqual(installs.at(-1), record("new").tree);
});

test("the first start stores the message keymap in the same record, and an install of the mail tab tree never carries it", async () => {
    const { stored, installs } = stub_messenger();
    await start_background();
    await settle();
    const record = stored["desertbird_compiled_keymap"] as { message_tree: { root: unknown } };
    assert.match(JSON.stringify(record.message_tree.root), /message\.scroll_down/);
    assert.doesNotMatch(JSON.stringify(installs), /message\.scroll_down/);
});

test("a stored record of version 2, with no message tree, is rebuilt with one", async () => {
    // A record an earlier add-on version wrote. Its tree is valid for the mail tab, so only the version and the missing `message_tree` can trigger the rebuild.
    const old_tree = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored, installs } = stub_messenger({ desertbird_compiled_keymap: { record_version: 2, source_hash: "an older default keymap", tree: old_tree } });
    await start_background();
    await settle();
    const record = stored["desertbird_compiled_keymap"] as { record_version: number; message_tree?: { root: unknown } };
    assert.equal(record.record_version, 4);
    assert.match(JSON.stringify(record.message_tree?.root), /message\.scroll_down/);
    assert.equal(installs.length, 1);
});
