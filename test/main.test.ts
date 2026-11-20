import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { DEFAULT_KEYMAP, KEEPS_SELECTION_IDS, UNREPEATABLE_IDS } from "../src/background/commands/index.ts";
import { keymap_of } from "../src/background/commands/tab_keymaps.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import { fake_native_messaging } from "./chrome_stubs.ts";

interface StorageChange {
    newValue?: unknown;
}

/** A stand-in for the `messenger` global the background entry reads: storage that fires `onChanged` on each write, and a recording `keys.install` and `pages.install`. */
function stub_messenger(stored: Record<string, unknown> = {}, read_delays_ms: number[] = [], session: Record<string, unknown> = {}) {
    const native_messages: { application: string; message: object }[] = [];
    const compose_scripts: unknown[] = [];
    const after_send_listeners: ((tab: { id?: number }, send_info: { error?: string }) => void)[] = [];
    const change_listeners: ((changes: Record<string, StorageChange>, area: string) => void)[] = [];
    const installs: unknown[] = [];
    const page_installs: unknown[] = [];
    const message_installs: unknown[] = [];
    const new_mail_listeners: unknown[] = [];
    const native = fake_native_messaging();
    let report_read: () => void = () => {};
    const first_read = new Promise<void>((resolve) => (report_read = resolve));
    const messenger = {
        storage: {
            local: {
                get: async (key: string | string[]) => {
                    const values = Object.fromEntries((Array.isArray(key) ? key : [key]).filter((name) => stored[name] !== undefined).map((name) => [name, stored[name]]));
                    report_read();
                    await new Promise((resolve) => setTimeout(resolve, read_delays_ms.shift() ?? 0));
                    return values;
                },
                set: async (items: Record<string, unknown>) => {
                    Object.assign(stored, items);
                    const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
                    setTimeout(() => change_listeners.forEach((listener) => listener(changes, "local")), 0);
                },
            },
            session: {
                get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
                set: async (items: Record<string, unknown>) => void Object.assign(session, items),
            },
            onChanged: { addListener: (listener: (changes: Record<string, StorageChange>, area: string) => void) => void change_listeners.push(listener) },
        },
        composeScripts: { register: async (script: unknown) => void compose_scripts.push(script) },
        compose: { onAfterSend: { addListener: (listener: (tab: { id?: number }, send_info: { error?: string }) => void) => void after_send_listeners.push(listener) } },
        keys: { install: async (args: { tree: unknown }) => void installs.push(args.tree), onInvocation: { addListener: () => {} } },
        pages: { install: async (args: { pageTree: unknown; messageTree: unknown }) => void (page_installs.push(args.pageTree), message_installs.push(args.messageTree)), onInvocation: { addListener: () => {} } },
        runtime: {
            onMessage: { addListener: () => {} },
            connectNative: (application: string) => native.connectNative(application),
            // A collect that never answers, as a host that waits on an open editor. A resolved pending answer would loop for the rest of the run.
            sendNativeMessage: (application: string, message: object) => (native_messages.push({ application, message }), new Promise(() => {})),
        },
        notifications: { create: async () => "n", clear: async () => true, onClicked: { addListener: (listener: unknown) => void new_mail_listeners.push(listener) }, onClosed: { addListener: (listener: unknown) => void new_mail_listeners.push(listener) } },
        messages: { onNewMailReceived: { addListener: (listener: unknown) => void new_mail_listeners.push(listener) } },
        tabs: { get: async () => ({}), onActivated: { addListener: () => {} }, onRemoved: { addListener: () => {} } },
        windows: { getAll: async () => [], onCreated: { addListener: () => {} }, onRemoved: { addListener: () => {} }, onFocusChanged: { addListener: () => {} } },
        alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
        mailTabs: { query: async () => [], onDisplayedFolderChanged: { addListener: () => {} } },
    };
    (globalThis as Record<string, unknown>)["messenger"] = messenger;
    const external_write = (items: Record<string, unknown>) => {
        Object.assign(stored, items);
        const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
        change_listeners.forEach((listener) => listener(changes, "local"));
    };
    return { stored, installs, page_installs, message_installs, external_write, first_read, new_mail_listeners, native, native_messages, compose_scripts, session, after_send_listeners, storage_listener_count: () => change_listeners.length };
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
    const source_hash = createHash("sha256").update(JSON.stringify({ keymap: DEFAULT_KEYMAP, message: keymap_of("message", {}), page: keymap_of("page", {}), own: keymap_of("own", {}), unrepeatable: [...UNREPEATABLE_IDS], keeps_selection: [...KEEPS_SELECTION_IDS], settings: {} })).digest("hex");
    const record = (marker: string) => ({ record_version: 10, source_hash, tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {}, marker } }, message_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } }, page_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } }, own_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } } });
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

test("the page tree is stored in the record and installed in the pages Experiment, and the mail install never carries it", async () => {
    const { stored, installs, page_installs } = stub_messenger();
    await start_background();
    await settle();
    const record = stored["desertbird_compiled_keymap"] as { page_tree: { root: unknown } };
    assert.match(JSON.stringify(record.page_tree.root), /page\.scroll_down/);
    assert.deepEqual(page_installs, [record.page_tree]);
    assert.doesNotMatch(JSON.stringify(installs), /page\.scroll_down/);
});

test("the pages Experiment gets the message tree without the find key", async () => {
    const { message_installs } = stub_messenger();
    await start_background();
    await settle();
    assert.equal(message_installs.length, 1);
    const root = (message_installs[0] as { root: { children: Record<string, unknown> } }).root;
    assert.match(JSON.stringify(root), /message\.scroll_down/);
    assert.equal(root.children["/"], undefined);
});

test("a stored record of version 4, with no page tree, is rebuilt with one", async () => {
    const empty = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored } = stub_messenger({ desertbird_compiled_keymap: { record_version: 4, source_hash: "an older default keymap", tree: empty, message_tree: empty } });
    await start_background();
    await settle();
    assert.match(JSON.stringify((stored["desertbird_compiled_keymap"] as { page_tree?: { root: unknown } }).page_tree?.root), /page\.scroll_down/);
});

test("a stored record of version 2, with no message tree, is rebuilt with one", async () => {
    // A record an earlier add-on version wrote. Its tree is valid for the mail tab, so only the version and the missing `message_tree` can trigger the rebuild.
    const old_tree = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored, installs } = stub_messenger({ desertbird_compiled_keymap: { record_version: 2, source_hash: "an older default keymap", tree: old_tree } });
    await start_background();
    await settle();
    const record = stored["desertbird_compiled_keymap"] as { record_version: number; message_tree?: { root: unknown } };
    assert.equal(record.record_version, 10);
    assert.match(JSON.stringify(record.message_tree?.root), /message\.scroll_down/);
    assert.equal(installs.length, 1);
});

test("the new-mail listeners register once at start", async () => {
    const { new_mail_listeners, storage_listener_count } = stub_messenger();
    const storage_before = storage_listener_count();
    await start_background();
    // onNewMailReceived, onClicked and onClosed once each, and a second onClicked for the follow-up notices. The storage.onChanged of the setting is one of several storage listeners, so only its presence is counted.
    assert.equal(new_mail_listeners.length, 4);
    assert.ok(storage_listener_count() - storage_before >= 3);
});

test("the bridge never connects while its setting is at the default, and connects once the setting turns on", async () => {
    const { native, external_write } = stub_messenger();
    await start_background();
    await settle();
    assert.deepEqual(native.names, []);
    external_write({ desertbird_settings: { bridge: true } });
    await settle();
    assert.deepEqual(native.names, ["desertbird_bridge"]);
    external_write({ desertbird_settings: { bridge: false } });
    await settle();
    assert.equal(native.ports[0]!.disconnected, true);
});

test("the start registers the compose script, and with external_editor at its default a stored editor job is dropped and never reaches the host", async () => {
    const job = { job: "j1", tab_id: 70, window_id: 7, original: "Hello\n" };
    const { native_messages, compose_scripts, session } = stub_messenger({}, [], { desertbird_editor_jobs: { 70: job } });
    await start_background();
    await settle();
    assert.deepEqual(compose_scripts, [{ js: [{ file: "content/compose_keys.js" }] }]);
    assert.deepEqual(session["desertbird_editor_jobs"], {});
    assert.deepEqual(native_messages, []);
});

test("with external_editor on, a stored job of a live tab collects again from desertbird_host", async () => {
    const job = { job: "j1", tab_id: 70, window_id: 7, original: "Hello\n" };
    const { native_messages } = stub_messenger({ desertbird_settings: { external_editor: true } }, [], { desertbird_editor_jobs: { 70: job } });
    await start_background();
    await settle();
    assert.deepEqual(native_messages[0], { application: "desertbird_host", message: { cmd: "editor_collect", job: "j1" } });
});

test("a failed send leaves the editor job alone, and a send that went out orphans it", async () => {
    const job = { job: "j1", tab_id: 70, window_id: 7, original: "Hello\n" };
    const { after_send_listeners, session } = stub_messenger({ desertbird_settings: { external_editor: true } }, [], { desertbird_editor_jobs: { 70: job } });
    await start_background();
    await settle();
    const stored_job = () => (session["desertbird_editor_jobs"] as Record<string, { orphaned?: true }>)[70];
    after_send_listeners.forEach((listener) => listener({ id: 70 }, { error: "SMTP refused" }));
    await settle();
    assert.equal(stored_job()?.orphaned, undefined);
    after_send_listeners.forEach((listener) => listener({ id: 70 }, {}));
    await settle();
    assert.equal(stored_job()?.orphaned, true);
});
