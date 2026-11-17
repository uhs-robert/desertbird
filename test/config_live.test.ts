import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_KEYMAP_KEY, SETTINGS_KEY } from "../src/background/config/store.ts";

type Listener = (changes: Record<string, unknown>, area: string) => void;

/** The `messenger` global the background entry reads, with storage that fires `onChanged` on an outside write and a recording `keys.install`. */
function stub_messenger(hold_first_get = false) {
    let release_first_get: () => void = () => {};
    let first_get_started: () => void = () => {};
    const first_get = new Promise<void>((resolve) => (first_get_started = resolve));
    let gate: Promise<void> | undefined = hold_first_get ? new Promise<void>((resolve) => (release_first_get = resolve)) : undefined;
    const stored: Record<string, unknown> = {};
    const listeners: Listener[] = [];
    const installs: { root: { children: Record<string, unknown> } }[] = [];
    (globalThis as Record<string, unknown>)["messenger"] = {
        storage: {
            local: {
                get: async (keys: string | string[]) => {
                    const snapshot = Object.fromEntries([keys].flat().filter((key) => key in stored).map((key) => [key, structuredClone(stored[key])]));
                    if (gate !== undefined) {
                        const held = gate;
                        gate = undefined;
                        first_get_started();
                        await held;
                    }
                    return snapshot;
                },
                set: async (items: Record<string, unknown>) => {
                    Object.assign(stored, structuredClone(items));
                    setTimeout(() => listeners.forEach((listener) => listener(Object.fromEntries(Object.keys(items).map((key) => [key, {}])), "local")), 0);
                },
            },
            onChanged: { addListener: (listener: Listener) => void listeners.push(listener) },
        },
        keys: { install: async (args: { tree: { root: { children: Record<string, unknown> } } }) => void installs.push(args.tree), onInvocation: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} } },
        notifications: { create: async () => "n", clear: async () => true, onClicked: { addListener: () => {} }, onClosed: { addListener: () => {} } },
        messages: { onNewMailReceived: { addListener: () => {} } },
        tabs: { onActivated: { addListener: () => {} } },
        windows: { getAll: async () => [], onCreated: { addListener: () => {} }, onRemoved: { addListener: () => {} }, onFocusChanged: { addListener: () => {} } },
        alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
        mailTabs: { query: async () => [], onDisplayedFolderChanged: { addListener: () => {} } },
    };
    const outside_write = (items: Record<string, unknown>) => {
        Object.assign(stored, items);
        listeners.forEach((listener) => listener(Object.fromEntries(Object.keys(items).map((key) => [key, {}])), "local"));
    };
    return { installs, outside_write, first_get, release_first_get: () => release_first_get() };
}

let instance = 0;
// Each case loads its own copy of the entry module, because it starts on import.
const start_background = () => import(`../src/background/main.ts?config_live=${instance++}`);
/** Polls until the condition holds. A condition that never holds fails the test by its timeout. */
async function until(condition: () => boolean): Promise<void> {
    for (let waited = 0; !condition(); waited++) {
        assert.ok(waited < 5000, "the condition did not hold in 5 s");
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}

test("a user binding written to storage reaches keys.install with no restart, and removing it reverts", async () => {
    const { installs, outside_write } = stub_messenger();
    await start_background();
    await until(() => installs.length === 1);
    assert.equal(installs[0]!.root.children["Z"], undefined);

    outside_write({ [USER_KEYMAP_KEY]: { normal: { Z: { id: "msg.archive" }, x: null } } });
    await until(() => installs.length === 2);
    assert.ok(installs[1]!.root.children["Z"]);
    assert.equal(installs[1]!.root.children["x"], undefined);

    outside_write({ [USER_KEYMAP_KEY]: {} });
    await until(() => installs.length === 3);
    assert.deepEqual(installs[2], installs[0]);
});

test("a user keymap written while the first install is still reading wins", async () => {
    const { installs, outside_write, first_get, release_first_get } = stub_messenger(true);
    await start_background();
    await first_get;
    outside_write({ [USER_KEYMAP_KEY]: { normal: { Z: { id: "msg.archive" } } } });
    release_first_get();
    await until(() => installs.at(-1)?.root.children["Z"] !== undefined);
});

test("a settings change reinstalls nothing: the matcher reads no setting", async () => {
    const { installs, outside_write } = stub_messenger();
    await start_background();
    await until(() => installs.length === 1);
    outside_write({ [SETTINGS_KEY]: { toast_ms: 9 } });
    // The installs run in order, so the install the later keymap write causes is the next one only if the settings write caused none.
    outside_write({ [USER_KEYMAP_KEY]: { normal: { Z: { id: "msg.archive" } } } });
    await until(() => installs.length >= 2);
    assert.equal(installs.length, 2);
    assert.ok(installs[1]!.root.children["Z"]);
});
