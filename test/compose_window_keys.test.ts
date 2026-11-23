import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { COMPOSE_COMMANDS, compile_tab_keymap, default_keymap_of, keymap_of, message_background_commands } from "../src/background/commands/tab_keymaps.ts";
import { create_body_requests } from "../src/background/body_requests.ts";
import type { BodyRequestApi } from "../src/background/body_requests.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import type { KeysInvocation } from "../src/shared/protocol.ts";

const COMPOSE_WINDOW = 31;
const compose_sender = { tab: { id: 7, windowId: COMPOSE_WINDOW } };

function bound_ids(kind: Parameters<typeof default_keymap_of>[0], user = {}): string[] {
    return Object.values(keymap_of(kind, user).normal ?? {}).flatMap((binding) => (Array.isArray(binding) ? binding : binding ? [binding] : []).map((invocation) => invocation.id));
}

test("the default compose keys are e, s, ?, the field jumps, q, g S and the zoom keys", () => {
    const keys = default_keymap_of("compose").normal ?? {};
    const binding = (key: string) => keys[key] as { id: string; args?: unknown } | null | undefined;
    assert.deepEqual([binding("e")?.id, binding("s")?.id, binding("?")?.id, binding("q")?.id, binding("gS")?.id], ["compose.edit_external", "compose.save", "help.open", "compose.close", "compose.send"]);
    for (const [key, field] of [["gt", "to"], ["gc", "cc"], ["gb", "bcc"], ["gs", "subject"], ["gm", "body"]] as const) assert.deepEqual([binding(key)?.id, binding(key)?.args], ["compose.focus", { field }], key);
    for (const key of ["zi", "zo", "z+", "z-", "zm", "zr", "z=", "zI", "zO"]) assert.match(binding(key)?.id ?? "", /^zoom\./, key);
    assert.deepEqual([...new Set(bound_ids("compose"))].sort(), ["compose.close", "compose.edit_external", "compose.focus", "compose.save", "compose.send", "help.open", "zoom.by", "zoom.set"]);
});

test("no default key of a compose window removes it, deletes or opens the command line, and its close and send are Thunderbird's own commands", () => {
    for (const id of bound_ids("compose")) assert.ok(COMPOSE_COMMANDS.has(id), id);
    for (const id of ["tab.close", "msg.delete", "msg.archive", "cmdline.open", "app.open_page", "msg.new", "options.open"]) assert.equal(bound_ids("compose").includes(id), false, id);
    for (const id of ["compose.close", "compose.send", "compose.focus"]) assert.equal(registry.get(id)?.runs_in, "chrome", id);
});

test("a user key for a command outside the compose set is dropped from the compose tree, one that is inside stays", () => {
    const user = { q: { id: "tab.close" }, x: { id: "msg.delete" }, k: { id: "cmdline.open", args: { text: "" } }, w: { id: "compose.save" } };
    const ids = bound_ids("compose", user);
    assert.equal(ids.includes("tab.close") || ids.includes("msg.delete") || ids.includes("cmdline.open"), false);
    assert.ok((keymap_of("compose", user).normal ?? {})["w"]);
    assert.equal(JSON.stringify(compile_tab_keymap("compose", user).compiled.modes.normal).includes("tab.close"), false);
});

test("the compose keys appear in no other tab kind, and compose.save is in no message set", () => {
    for (const kind of ["message", "window", "own", "page"] as const) {
        const keys = default_keymap_of(kind).normal ?? {};
        for (const key of ["e", "s", "?"]) assert.equal(keys[key], undefined, `${kind} ${key}`);
        assert.equal(bound_ids(kind).includes("compose.save"), false, kind);
    }
    assert.equal(message_background_commands().has("compose.save"), false);
});

function compose_requests(window_type: string) {
    const ran: KeysInvocation[] = [];
    const calls: string[] = [];
    const api: BodyRequestApi = {
        messageDisplay: { getDisplayedMessages: async () => (calls.push("displayed"), [{ id: 5 }]) },
        windows: { get: async () => ({ type: window_type }) },
        notifications: { create: async () => "n1" },
    };
    const handle = create_body_requests({ registry, api, allowed: message_background_commands(), compose_allowed: COMPOSE_COMMANDS, run: async (invocation) => void ran.push(invocation) });
    return { handle, ran, calls };
}

test("a compose window runs only the compose commands, with no messages, and never a close", async () => {
    const { handle, ran, calls } = compose_requests("messageCompose");
    for (const command of ["compose.save", "compose.edit_external", "help.open", "tab.close", "msg.delete", "msg.reply", "cmdline.open", "pane.focus"]) await handle({ type: "body.invoke", command, args: command === "cmdline.open" ? { text: "" } : {}, count: 1 }, compose_sender);
    assert.deepEqual(ran.map((invocation) => invocation.command), ["compose.save", "compose.edit_external", "help.open"]);
    assert.deepEqual(ran.map((invocation) => [invocation.windowId, invocation.messageIds]), [[COMPOSE_WINDOW, []], [COMPOSE_WINDOW, []], [COMPOSE_WINDOW, []]]);
    assert.deepEqual(calls, []);
});

test("a message window cannot run the compose commands", async () => {
    const { handle, ran } = compose_requests("messageDisplay");
    await handle({ type: "body.invoke", command: "compose.save", args: {}, count: 1 }, compose_sender);
    assert.deepEqual(ran, []);
});

test("compose.save saves the draft of the window's tab and touches no window or tab", async () => {
    const calls: string[] = [];
    const api = {
        windows: { get: async (id: number, options: unknown) => (calls.push(`windows.get ${id} ${JSON.stringify(options)}`), { type: "messageCompose", tabs: [{ id: 77 }] }), remove: async () => void calls.push("windows.remove") },
        tabs: { remove: async () => void calls.push("tabs.remove") },
        compose: { saveMessage: async (tab_id: number, options: unknown) => void calls.push(`saveMessage ${tab_id} ${JSON.stringify(options)}`) },
        notifications: { create: async () => "n" },
    } as unknown as RouterApi;
    await create_router(registry, api).run({ command: "compose.save", args: {}, count: 1, windowId: COMPOSE_WINDOW, messageIds: [] });
    assert.deepEqual(calls, [`windows.get ${COMPOSE_WINDOW} {"populate":true}`, 'saveMessage 77 {"mode":"draft"}']);
});

test("compose.save refuses a window with no tab and saves nothing", async () => {
    const calls: string[] = [];
    const api = { windows: { get: async () => ({ type: "messageCompose", tabs: [] }) }, compose: { saveMessage: async () => void calls.push("save") }, notifications: { create: async (_id: unknown, options: { message: string }) => (calls.push(options.message), "n") } } as unknown as RouterApi;
    await create_router(registry, api).run({ command: "compose.save", args: {}, count: 1, windowId: COMPOSE_WINDOW, messageIds: [] });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /no message to save/);
});

test("compose.save from the main window refuses and saves nothing, as :edit does", async () => {
    const calls: string[] = [];
    const api = { windows: { get: async () => ({ type: "normal", tabs: [{ id: 3 }] }) }, compose: { saveMessage: async () => void calls.push("save") }, notifications: { create: async (_id: unknown, options: { message: string }) => (calls.push(options.message), "n") } } as unknown as RouterApi;
    await create_router(registry, api).run({ command: "compose.save", args: {}, count: 1, windowId: 1, messageIds: [] });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /only in a compose window/);
});

test("a sender whose window cannot be read runs nothing, in neither set", async () => {
    const ran: KeysInvocation[] = [];
    const api: BodyRequestApi = { messageDisplay: { getDisplayedMessages: async () => [] }, windows: { get: async () => Promise.reject(new Error("gone")) }, notifications: { create: async () => "n1" } };
    const handle = create_body_requests({ registry, api, allowed: message_background_commands(), compose_allowed: COMPOSE_COMMANDS, run: async (invocation) => void ran.push(invocation) });
    for (const command of ["tab.close", "compose.save"]) await handle({ type: "body.invoke", command, args: {}, count: 1 }, compose_sender);
    assert.deepEqual(ran, []);
});

test("compose.edit_external is no message key any more", () => {
    assert.equal(message_background_commands().has("compose.edit_external"), false);
});
