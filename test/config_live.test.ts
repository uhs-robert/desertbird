import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_KEYMAP_KEY, SETTINGS_KEY } from "../src/background/config/store.ts";

type Listener = (changes: Record<string, unknown>, area: string) => void;

/** The `messenger` global the background entry reads, with storage that fires `onChanged` on an outside write and a recording `keys.install`. */
function stub_messenger() {
    const stored: Record<string, unknown> = {};
    const listeners: Listener[] = [];
    const installs: { root: { children: Record<string, unknown> } }[] = [];
    (globalThis as Record<string, unknown>)["messenger"] = {
        storage: {
            local: {
                get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((key) => key in stored).map((key) => [key, structuredClone(stored[key])])),
                set: async (items: Record<string, unknown>) => {
                    Object.assign(stored, structuredClone(items));
                    setTimeout(() => listeners.forEach((listener) => listener(Object.fromEntries(Object.keys(items).map((key) => [key, {}])), "local")), 0);
                },
            },
            onChanged: { addListener: (listener: Listener) => void listeners.push(listener) },
        },
        keys: { install: async (args: { tree: { root: { children: Record<string, unknown> } } }) => void installs.push(args.tree), onInvocation: { addListener: () => {} } },
        notifications: { create: async () => "n" },
    };
    const outside_write = (items: Record<string, unknown>) => {
        Object.assign(stored, items);
        listeners.forEach((listener) => listener(Object.fromEntries(Object.keys(items).map((key) => [key, {}])), "local"));
    };
    return { installs, outside_write };
}

let instance = 0;
// Each case loads its own copy of the entry module, because it starts on import.
const start_background = () => import(`../src/background/main.ts?config_live=${instance++}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test("a user binding written to storage reaches keys.install with no restart, and removing it reverts", async () => {
    const { installs, outside_write } = stub_messenger();
    await start_background();
    await settle();
    assert.equal(installs.length, 1);
    assert.equal(installs[0]!.root.children["Z"], undefined);

    outside_write({ [USER_KEYMAP_KEY]: { normal: { Z: { id: "msg.archive" }, x: null } } });
    await settle();
    const edited = installs.at(-1)!;
    assert.ok(edited.root.children["Z"]);
    assert.equal(edited.root.children["x"], undefined);

    outside_write({ [USER_KEYMAP_KEY]: {} });
    await settle();
    assert.deepEqual(installs.at(-1), installs[0]);
});

test("a settings change reinstalls nothing: the matcher reads no setting", async () => {
    const { installs, outside_write } = stub_messenger();
    await start_background();
    await settle();
    const before = installs.length;
    outside_write({ [SETTINGS_KEY]: { toast_ms: 9 } });
    await settle();
    assert.equal(installs.length, before);
});
