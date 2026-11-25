import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { DEFAULT_KEYMAP, KEEPS_SELECTION_IDS, UNREPEATABLE_IDS } from "../src/background/commands/index.ts";
import { compile_typing_keymap, keymap_of } from "../src/background/commands/tab_keymaps.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import { fake_native_messaging } from "./chrome_stubs.ts";

interface StorageChange {
    newValue?: unknown;
}

const real_digest = crypto.subtle.digest.bind(crypto.subtle);

/** A stand-in for the `messenger` global the background entry reads: storage that fires `onChanged` on each write, and a recording `keys.install` and `pages.install`. */
function stub_messenger(stored: Record<string, unknown> = {}, read_delays_ms: number[] = [], session: Record<string, unknown> = {}, options: { menukeys_fails?: boolean; no_menukeys?: boolean } = {}) {
    const native_messages: { application: string; message: object }[] = [];
    const compose_scripts: unknown[] = [];
    const after_send_listeners: ((tab: { id?: number }, send_info: { error?: string }) => void)[] = [];
    const change_listeners: ((changes: Record<string, StorageChange>, area: string) => void)[] = [];
    const installs: unknown[] = [];
    const page_installs: unknown[] = [];
    const message_installs: unknown[] = [];
    const window_installs: unknown[] = [];
    const typing_installs: unknown[] = [];
    // Each Experiment install in the order it was made, with the menu key table.
    const install_log: string[] = [];
    const menu_installs: Record<string, string>[] = [];
    const new_mail_listeners: unknown[] = [];
    const message_listeners: ((message: unknown, sender: unknown) => unknown)[] = [];
    const native = fake_native_messaging();
    // Calls in flight plus pending echo timers. A test that asserts "only once" waits for zero, so a second install an echo causes has landed.
    let busy = 0;
    const counted = async <T>(work: () => Promise<T>) => {
        busy++;
        try {
            return await work();
        } finally {
            busy--;
        }
    };
    let reads_done = 0;
    let report_read: () => void = () => {};
    // The start hashes through the async digest, a gap with no stub call in flight, so the digest counts as busy too.
    crypto.subtle.digest = ((...args: Parameters<typeof real_digest>) => counted(() => real_digest(...args))) as typeof crypto.subtle.digest;
    const first_read = new Promise<void>((resolve) => (report_read = resolve));
    const messenger = {
        storage: {
            local: {
                get: (key: string | string[]) => counted(async () => {
                    const values = Object.fromEntries((Array.isArray(key) ? key : [key]).filter((name) => stored[name] !== undefined).map((name) => [name, stored[name]]));
                    report_read();
                    await new Promise((resolve) => setTimeout(resolve, read_delays_ms.shift() ?? 0));
                    reads_done++;
                    return values;
                }),
                set: (items: Record<string, unknown>) => counted(async () => {
                    Object.assign(stored, items);
                    const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
                    busy++;
                    setTimeout(() => {
                        try {
                            change_listeners.forEach((listener) => listener(changes, "local"));
                        } finally {
                            busy--;
                        }
                    }, 0);
                }),
            },
            session: {
                get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
                set: async (items: Record<string, unknown>) => void Object.assign(session, items),
            },
            onChanged: { addListener: (listener: (changes: Record<string, StorageChange>, area: string) => void) => void change_listeners.push(listener) },
        },
        composeScripts: { register: async (script: unknown) => void compose_scripts.push(script) },
        compose: { onAfterSend: { addListener: (listener: (tab: { id?: number }, send_info: { error?: string }) => void) => void after_send_listeners.push(listener) } },
        menukeys: options.no_menukeys ? undefined : { install: (args: { keys: { key: string; direction: string }[] }) => counted(async () => {
                install_log.push("menukeys");
                if (options.menukeys_fails) throw new Error("schema rejected the keys");
                menu_installs.push(Object.fromEntries(args.keys.map((each) => [each.key, each.direction])));
            }) },
        keys: { install: (args: { tree: unknown }) => counted(async () => void (install_log.push("keys"), installs.push(args.tree))), onInvocation: { addListener: () => {} } },
        pages: { install: (args: { pageTree: unknown; messageTree: unknown; windowTree: unknown; typingTree: unknown }) => counted(async () => void (install_log.push("pages"), page_installs.push(args.pageTree), message_installs.push(args.messageTree), window_installs.push(args.windowTree), typing_installs.push(args.typingTree))), onInvocation: { addListener: () => {} } },
        runtime: {
            onMessage: { addListener: (listener: (message: unknown, sender: unknown) => unknown) => void message_listeners.push(listener) },
            getURL: (path: string) => `moz-extension://test/${path}`,
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
    const when_installed = (count: number) => wait_for(`${count} keys.install and pages.install call(s); saw ${installs.length} and ${page_installs.length}`, () => installs.length >= count && page_installs.length >= count);
    // Limit: it sees only the counted stub calls (get, set, installs, digest) and the echo timers. Scheduler, hud, bridge and editor timers, session storage, windows.getAll and native messaging are not counted, so a negative assertion outside the install path rests on the setImmediate recheck alone.
    const when_idle = async () => {
        // The recheck after a macrotask sees a call that the last finished one queued.
        for (;;) {
            await wait_for(`the stub to go idle; ${busy} call(s) or echo timer(s) still pending`, () => busy === 0);
            await new Promise((resolve) => setImmediate(resolve));
            if (busy === 0) return;
        }
    };
    return { message_listeners, when_installed, when_idle, reads_done: () => reads_done, stored, installs, install_log, menu_installs, page_installs, message_installs, window_installs, typing_installs, external_write, first_read, new_mail_listeners, native, native_messages, compose_scripts, session, after_send_listeners, storage_listener_count: () => change_listeners.length };
}

const WAIT_DEADLINE_MS = 5_000;
async function wait_for(what: string, condition: () => boolean) {
    const deadline = Date.now() + WAIT_DEADLINE_MS;
    while (!condition()) {
        if (Date.now() > deadline) assert.fail(`timed out after ${WAIT_DEADLINE_MS} ms waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
let instance = 0;
// Each case loads its own copy of the entry module, because it starts on import.
const start_background = () => import(`../src/background/main.ts?instance=${instance++}`);

test("the first start stores the keymap and installs it once, though its own write fires onChanged", async () => {
    const { stored, installs, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.equal(installs.length, 1);
    assert.ok(stored["desertbird_compiled_keymap"]);
});

test("a stored keymap compiled from other default bindings is rebuilt", async () => {
    // Every check but the source hash passes, so only the hash can trigger the rebuild.
    const stale_tree = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored, installs, when_installed, when_idle } = stub_messenger({ desertbird_compiled_keymap: { record_version: 3, source_hash: "an older default keymap", tree: stale_tree, message_tree: stale_tree } });
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.equal(installs.length, 1);
    assert.notDeepEqual(installs[0], stale_tree);
    assert.notEqual((stored["desertbird_compiled_keymap"] as { source_hash: string }).source_hash, "an older default keymap");
});

test("a storage change during a pending read wins: the tree read before the change is neither kept nor installed last", async () => {
    const source_hash = createHash("sha256").update(JSON.stringify({ keymap: DEFAULT_KEYMAP, message: keymap_of("message", {}), window: keymap_of("window", {}), page: keymap_of("page", {}), own: keymap_of("own", {}), compose: keymap_of("compose", {}), typing: compile_typing_keymap({}).compiled.modes.normal, unrepeatable: [...UNREPEATABLE_IDS], keeps_selection: [...KEEPS_SELECTION_IDS], settings: {} })).digest("hex");
    const record = (marker: string) => ({ record_version: 16, source_hash, tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {}, marker } }, message_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } }, window_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } }, page_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } }, own_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } }, compose_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } }, typing_tree: { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } } });
    const { installs, external_write, first_read, when_installed, when_idle, reads_done } = stub_messenger({ desertbird_compiled_keymap: record("old") }, [40, 0]);
    await start_background();
    await first_read;
    // The start is still reading "old" when "new" lands, and the read of "new" answers first.
    external_write({ desertbird_compiled_keymap: record("new") });
    await wait_for(`both reads to finish; saw ${reads_done()}`, () => reads_done() >= 2);
    await wait_for("the new tree to be the last install", () => JSON.stringify(installs.at(-1)) === JSON.stringify(record("new").tree));
    await when_idle();
    assert.deepEqual(installs.at(-1), record("new").tree);
});

test("the first start stores the message keymap in the same record, and an install of the mail tab tree never carries it", async () => {
    const { stored, installs, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    const record = stored["desertbird_compiled_keymap"] as { message_tree: { root: unknown } };
    assert.match(JSON.stringify(record.message_tree.root), /message\.scroll_down/);
    assert.doesNotMatch(JSON.stringify(installs), /message\.scroll_down/);
});

test("the page tree is stored in the record and installed in the pages Experiment, and the mail install never carries it", async () => {
    const { stored, installs, page_installs, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    const record = stored["desertbird_compiled_keymap"] as { page_tree: { root: unknown } };
    assert.match(JSON.stringify(record.page_tree.root), /page\.scroll_down/);
    assert.deepEqual(page_installs, [record.page_tree]);
    assert.doesNotMatch(JSON.stringify(installs), /page\.scroll_down/);
});

test("the typing tree is stored in the record and installed in the pages Experiment alone", async () => {
    const { stored, installs, typing_installs, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    const record = stored["desertbird_compiled_keymap"] as { typing_tree: { root: unknown } };
    assert.deepEqual(typing_installs, [record.typing_tree]);
    assert.match(JSON.stringify(record.typing_tree.root), /mode\.escape/);
    assert.doesNotMatch(JSON.stringify(installs), /mode\.escape/);
});

test("the menu keys install first, so their listener is the first on each window root", async () => {
    const { install_log, menu_installs, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.deepEqual(install_log, ["menukeys", "keys", "pages"]);
    assert.deepEqual(menu_installs, [{ j: "down", k: "up", h: "left", l: "right" }]);
});

test("a user key for a menu command changes the installed menu keys", async () => {
    const { menu_installs, when_installed, when_idle } = stub_messenger({ desertbird_user_keymap: { normal: { x: { id: "msg.archive" } }, menu: { n: { id: "menu.down" }, "<C-n>": { id: "menu.down" } } } });
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.deepEqual(menu_installs.at(-1), { j: "down", k: "up", h: "left", l: "right", n: "down" });
});

test("a user key in the menu section changes the menu keys and nothing else", async () => {
    const { installs, stored, when_installed, when_idle } = stub_messenger({ desertbird_user_keymap: { menu: { n: { id: "menu.down" } } } });
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.doesNotMatch(JSON.stringify(installs), /menu\./);
    assert.doesNotMatch(JSON.stringify(stored["desertbird_compiled_keymap"]), /menu\./);
});

test("a menukeys install that rejects leaves the other runtimes installed", async () => {
    const { install_log, when_installed, when_idle } = stub_messenger({}, [], {}, { menukeys_fails: true });
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.deepEqual(install_log, ["menukeys", "keys", "pages"]);
});

test("with no menukeys Experiment the other runtimes still install", async () => {
    const { install_log, when_installed, when_idle } = stub_messenger({}, [], {}, { no_menukeys: true });
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.deepEqual(install_log, ["keys", "pages"]);
});

test("the pages Experiment gets the message tree without the find key", async () => {
    const { message_installs, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.equal(message_installs.length, 1);
    const root = (message_installs[0] as { root: { children: Record<string, unknown> } }).root;
    assert.match(JSON.stringify(root), /message\.scroll_down/);
    assert.equal(root.children["/"], undefined);
});

test("a record of version 14, with no window tree, is rebuilt with one, and the pages Experiment gets it with hint picks sent to the background and no tab keys", async () => {
    const empty = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored, window_installs, when_installed, when_idle } = stub_messenger({ desertbird_compiled_keymap: { record_version: 14, source_hash: "an older default keymap", tree: empty, message_tree: empty, page_tree: empty, own_tree: empty, typing_tree: empty } });
    await start_background();
    await when_installed(1);
    await when_idle();
    const record = stored["desertbird_compiled_keymap"] as { record_version: number; window_tree?: { root: unknown } };
    assert.equal(record.record_version, 16);
    assert.match(JSON.stringify(record.window_tree?.root), /msg\.flag/);
    assert.match(JSON.stringify(record.window_tree?.root), /cmdline\.open/);
    assert.doesNotMatch(JSON.stringify(record.window_tree?.root), /tab\.next|pane\.focus/);
    assert.equal(window_installs.length, 1);
    const installed = JSON.stringify((window_installs[0] as { root: unknown }).root);
    assert.match(installed, /hint\.window/);
    assert.doesNotMatch(installed, /hint\.pick/);
});

test("a stored record of version 4, with no page tree, is rebuilt with one", async () => {
    const empty = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored, when_installed, when_idle } = stub_messenger({ desertbird_compiled_keymap: { record_version: 4, source_hash: "an older default keymap", tree: empty, message_tree: empty } });
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.match(JSON.stringify((stored["desertbird_compiled_keymap"] as { page_tree?: { root: unknown } }).page_tree?.root), /page\.scroll_down/);
});

test("a stored record of version 2, with no message tree, is rebuilt with one", async () => {
    // A record an earlier add-on version wrote. Its tree is valid for the mail tab, so only the version and the missing `message_tree` can trigger the rebuild.
    const old_tree = { version: COMPILED_KEYMAP_VERSION, root: { kind: "branch", children: {} } };
    const { stored, installs, when_installed, when_idle } = stub_messenger({ desertbird_compiled_keymap: { record_version: 2, source_hash: "an older default keymap", tree: old_tree } });
    await start_background();
    await when_installed(1);
    await when_idle();
    const record = stored["desertbird_compiled_keymap"] as { record_version: number; message_tree?: { root: unknown } };
    assert.equal(record.record_version, 16);
    assert.match(JSON.stringify(record.message_tree?.root), /message\.scroll_down/);
    assert.equal(installs.length, 1);
});

test("the new-mail listeners register once at start", async () => {
    const { new_mail_listeners, storage_listener_count, when_installed, when_idle } = stub_messenger();
    const storage_before = storage_listener_count();
    await start_background();
    // onNewMailReceived, onClicked and onClosed once each, and a second onClicked for the follow-up notices. The storage.onChanged of the setting is one of several storage listeners, so only its presence is counted.
    assert.equal(new_mail_listeners.length, 4);
    assert.ok(storage_listener_count() - storage_before >= 3);
    await when_installed(1);
    await when_idle();
});

test("the bridge never connects while its setting is at the default, and connects once the setting turns on", async () => {
    const { native, external_write, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.deepEqual(native.names, []);
    external_write({ desertbird_settings: { bridge: true } });
    await wait_for("the bridge to connect", () => native.names.length === 1);
    assert.deepEqual(native.names, ["desertbird_bridge"]);
    external_write({ desertbird_settings: { bridge: false } });
    await wait_for("the bridge to disconnect", () => native.ports[0]?.disconnected === true);
    assert.equal(native.ports[0]!.disconnected, true);
    await when_idle();
});

test("the start registers the compose script, and with external_editor at its default a stored editor job is dropped and never reaches the host", async () => {
    const job = { job: "j1", tab_id: 70, window_id: 7, original: "Hello\n" };
    const { native_messages, compose_scripts, session, when_installed, when_idle } = stub_messenger({}, [], { desertbird_editor_jobs: { 70: job } });
    await start_background();
    await wait_for("the stored editor job to be dropped", () => compose_scripts.length === 1 && Object.keys((session["desertbird_editor_jobs"] as object) ?? {}).length === 0);
    await when_installed(1);
    await when_idle();
    assert.deepEqual(compose_scripts, [{ js: [{ file: "content/compose_keys.js" }] }]);
    assert.deepEqual(session["desertbird_editor_jobs"], {});
    assert.deepEqual(native_messages, []);
});

test("with external_editor on, a stored job of a live tab collects again from desertbird_host", async () => {
    const job = { job: "j1", tab_id: 70, window_id: 7, original: "Hello\n" };
    const { native_messages, when_installed, when_idle } = stub_messenger({ desertbird_settings: { external_editor: true } }, [], { desertbird_editor_jobs: { 70: job } });
    await start_background();
    await wait_for("the editor collect message", () => native_messages.length >= 1);
    assert.deepEqual(native_messages[0], { application: "desertbird_host", message: { cmd: "editor_collect", job: "j1" } });
    await when_installed(1);
    await when_idle();
});

test("a failed send leaves the editor job alone, and a send that went out orphans it", async () => {
    const job = { job: "j1", tab_id: 70, window_id: 7, original: "Hello\n" };
    const { after_send_listeners, session, native_messages, when_installed, when_idle } = stub_messenger({ desertbird_settings: { external_editor: true } }, [], { desertbird_editor_jobs: { 70: job } });
    await start_background();
    await wait_for("the editor collect message", () => native_messages.length >= 1);
    await when_installed(1);
    await when_idle();
    const stored_job = () => (session["desertbird_editor_jobs"] as Record<string, { orphaned?: true }>)[70];
    after_send_listeners.forEach((listener) => listener({ id: 70 }, { error: "SMTP refused" }));
    await when_idle();
    assert.equal(stored_job()?.orphaned, undefined);
    after_send_listeners.forEach((listener) => listener({ id: 70 }, {}));
    await wait_for("the job to be orphaned", () => stored_job()?.orphaned === true);
    assert.equal(stored_job()?.orphaned, true);
    await when_idle();
});

test("the command line and hud messages answer the overlay pages only, never a content script or another page", async () => {
    const { message_listeners, when_installed, when_idle } = stub_messenger();
    await start_background();
    await when_installed(1);
    await when_idle();
    assert.equal(message_listeners.length, 1);
    const ask = (message: unknown, sender: unknown) => message_listeners[0]!(message, sender);
    const hello = { type: "cmdline.hello", windowId: 3 };
    const state = { type: "hud.state", windowId: 3 };
    assert.deepEqual(await ask(hello, { url: "moz-extension://test/overlay/cmdline.html?window=3" }), { open: false });
    assert.notEqual(ask(state, { url: "moz-extension://test/overlay/hud.html?window=3" }), undefined);
    assert.deepEqual(await ask(hello, { url: "moz-extension://test/overlay/cmdline.html?window=3", tab: { id: 1, windowId: 3 } }), { open: false }, "the overlay page of a message window has a tab");
    const refused = [
        [hello, { tab: { id: 1, windowId: 3 }, url: "moz-extension://test/content/message.html" }],
        [hello, { url: "moz-extension://other/overlay/cmdline.html" }],
        [hello, {}],
        [hello, { url: "moz-extension://test/overlay/hud.html?window=3" }],
        [state, { url: "moz-extension://test/overlay/cmdline.html?window=3" }],
        [state, { tab: { id: 1, windowId: 3 }, url: "mailbox:///tmp/Inbox?number=5" }],
    ] as const;
    for (const [message, sender] of refused) assert.equal(ask(message, sender), undefined, JSON.stringify([message, sender]));
});
