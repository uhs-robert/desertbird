import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KEYMAP, MESSAGE_KEYMAP, registry } from "../src/background/commands/index.ts";
import { effective_keymap } from "../src/background/config/keymap.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import { help_groups } from "../src/help/model.ts";

const all_entries = (keymap = DEFAULT_KEYMAP) => help_groups(registry, keymap).flatMap((group) => group.entries);

test("every command of the registry has one help entry, whatever its group", () => {
    assert.deepEqual(all_entries().map((entry) => entry.id).sort(), registry.list().map((command) => command.id).sort());
});

test("entries are grouped by the part of the id before the dot, in id order", () => {
    const groups = help_groups(registry, DEFAULT_KEYMAP);
    assert.deepEqual(groups.map((group) => group.name), [...groups.map((group) => group.name)].sort());
    for (const group of groups) for (const entry of group.entries) assert.equal(entry.id.split(".")[0], group.name);
});

test("an entry carries the label, the intent, the usage line and every key bound to the command", () => {
    const archive = all_entries().find((entry) => entry.id === "msg.archive");
    assert.equal(archive?.label, registry.get("msg.archive")?.label);
    assert.equal(archive?.intent, registry.get("msg.archive")?.intent);
    assert.deepEqual(archive?.keys, [{ keys: "x", args: "", where: "" }]);
    const sort = all_entries().find((entry) => entry.id === "sort.set");
    assert.match(sort?.usage ?? "", /^sort /);
    assert.ok((sort?.keys.length ?? 0) > 1);
    assert.ok(sort?.keys.every((key) => key.args.length > 0));
});

test("a key that sets args shows them", () => {
    const open = all_entries().find((entry) => entry.id === "cmdline.open");
    assert.ok(open?.keys.some((key) => key.keys === ":" && key.args === ""));
    assert.ok(open?.keys.some((key) => key.keys === "mt" && key.args === "text: tag"));
});

test("a command with no key lists none, and the page can still show its usage", () => {
    const tab_switch = all_entries().find((entry) => entry.id === "tab.switch");
    assert.deepEqual(tab_switch?.keys, []);
    assert.equal(tab_switch?.word, "tab");
});

test("the user's bindings change the listed keys: a rebound key moves and an unbound one goes", () => {
    const keymap = effective_keymap({ normal: { x: null, X: { id: "msg.archive" } } });
    const archive = all_entries(keymap).find((entry) => entry.id === "msg.archive");
    assert.deepEqual(archive?.keys.map((key) => key.keys), ["X"]);
});

test("g? shows the root keys and the help page keeps no key outside a message", async () => {
    assert.deepEqual(all_entries().find((entry) => entry.id === "help.whichkey")?.keys, [{ keys: "g?", args: "", where: "" }]);
    assert.deepEqual(DEFAULT_KEYMAP.normal?.["g?"], { id: "help.whichkey" });
    const shown: number[] = [];
    const api = { notifications: { create: async () => "n" }, keys: undefined, which_key: { show_root: async (window_id: number) => void shown.push(window_id) } };
    await create_router(registry, api as unknown as RouterApi).run({ command: "help.whichkey", args: {}, count: 1, windowId: 4, messageIds: [] });
    assert.deepEqual(shown, [4]);
});

test("help.open opens the page in the key's window", async () => {
    const calls: string[] = [];
    const api = {
        runtime: { getURL: (path: string) => `moz-extension://x/${path}` },
        tabs: {
            query: async (query: object) => (calls.push(`query ${JSON.stringify(query)}`), []),
            create: async (properties: object) => void calls.push(`create ${JSON.stringify(properties)}`),
            update: async () => void calls.push("update"),
        },
        notifications: { create: async () => "n" },
        keys: undefined,
    };
    await create_router(registry, api as unknown as RouterApi).run({ command: "help.open", args: {}, count: 1, windowId: 4, messageIds: [] });
    assert.deepEqual(calls, ['query {"url":"moz-extension://x/help/help.html"}', 'create {"url":"moz-extension://x/help/help.html","windowId":4}']);
});

test("help.open shows the tab that already holds the page", async () => {
    const calls: string[] = [];
    const api = {
        runtime: { getURL: (path: string) => `moz-extension://x/${path}` },
        tabs: { query: async () => [{ id: 9 }], create: async () => void calls.push("create"), update: async (id: number) => void calls.push(`update ${id}`) },
        notifications: { create: async () => "n" },
        keys: undefined,
    };
    await create_router(registry, api as unknown as RouterApi).run({ command: "help.open", args: {}, count: 1, windowId: 4, messageIds: [] });
    assert.deepEqual(calls, ["update 9"]);
});

test("the keys of a message document list under the reading commands, marked as in a message", () => {
    const scroll = help_groups(registry, DEFAULT_KEYMAP, MESSAGE_KEYMAP).flatMap((group) => group.entries).find((entry) => entry.id === "message.scroll_down");
    assert.ok(scroll !== undefined && scroll.keys.length > 0);
    assert.ok(scroll.keys.every((key) => key.where === "message"));
    assert.deepEqual(help_groups(registry, DEFAULT_KEYMAP).flatMap((group) => group.entries).find((entry) => entry.id === "message.scroll_down")?.keys, []);
});

test("a binding that runs several steps lists its key under each command it runs", () => {
    const keymap = { normal: { Q: [{ id: "msg.archive" }, { id: "motion.down" }] } };
    const entries = help_groups(registry, keymap).flatMap((group) => group.entries);
    assert.deepEqual(entries.find((entry) => entry.id === "msg.archive")?.keys, [{ keys: "Q", args: "", where: "" }]);
    assert.deepEqual(entries.find((entry) => entry.id === "motion.down")?.keys, [{ keys: "Q", args: "", where: "" }]);
});
