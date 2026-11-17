import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, MESSAGE_KEYMAP, UNREPEATABLE_IDS, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";

const ok = (id: string, args: Record<string, unknown>) => check_args(registry.get(id)!, args).ok;

function app_fake(command_enabled = true, pane_focused = true) {
    const calls: string[] = [];
    const keys = {
        appCommand: async ({ name }: { name: string }) => (calls.push(`appCommand ${name}`), command_enabled),
        appOpenPage: async ({ page }: { page: string }) => void calls.push(`appOpenPage ${page}`),
        paneFocus: async ({ pane }: { pane: string }) => (calls.push(`paneFocus ${pane}`), pane_focused),
    };
    const notifications = { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") };
    const api = { keys, notifications } as unknown as RouterApi;
    const run = (command: string, args: Record<string, unknown> = {}) => create_router(registry, api).run({ command, args: args as never, count: 1, windowId: 3, messageIds: [] });
    return { run, calls };
}

test("app.open_page and pane.focus take only the names the table lists", () => {
    for (const page of ["addons", "themes", "config"]) assert.equal(ok("app.open_page", { page }), true, page);
    assert.equal(ok("app.open_page", { page: "https://example.org" }), false);
    assert.equal(ok("app.open_page", {}), false);
    for (const pane of ["folders", "threads", "message"]) assert.equal(ok("pane.focus", { pane }), true, pane);
    assert.equal(ok("pane.focus", { pane: "compose" }), false);
});

test("the app keys bind their commands and add no warning, and undo has no default key", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    assert.equal(normal["u"], undefined);
    assert.deepEqual(normal["gC"], { id: "thread.open_conversation" });
    for (const [keys, page] of [["gx", "addons"], ["gT", "themes"], ["gc", "config"]] as const) assert.deepEqual(normal[keys], { id: "app.open_page", args: { page } }, keys);
    for (const [keys, pane] of [["gf", "folders"], ["ge", "threads"], ["gm", "message"], ["H", "folders"], ["<A-h>", "threads"], ["L", "threads"], ["<A-l>", "message"]] as const) assert.deepEqual(normal[keys], { id: "pane.focus", args: { pane } }, keys);
    for (const id of ["pane.left", "pane.right"]) assert.ok(!Object.values(normal).some((binding) => binding !== null && typeof binding === "object" && "id" in binding && binding.id === id), id);
    assert.deepEqual(compile_default_keymap().warnings ?? [], []);
});

test("msg.undo changes mail, so the bridge refuses it and . never repeats it", () => {
    assert.equal(registry.get("msg.undo")?.bridge, false);
    assert.ok(UNREPEATABLE_IDS.has("msg.undo"));
    assert.ok(!UNREPEATABLE_IDS.has("pane.focus"));
});

test("each command calls only the chrome verb its needs lists", async () => {
    const fake = app_fake();
    await fake.run("msg.undo");
    await fake.run("thread.open_conversation");
    await fake.run("app.open_page", { page: "themes" });
    await fake.run("pane.focus", { pane: "message" });
    assert.deepEqual(fake.calls, ["appCommand cmd_undo", "appCommand cmd_openConversation", "appOpenPage themes", "paneFocus message"]);
    assert.deepEqual(registry.get("msg.undo")?.needs, ["keys.appCommand"]);
});

test("a command Thunderbird has disabled is refused with a message", async () => {
    const fake = app_fake(false);
    await fake.run("msg.undo");
    assert.deepEqual(fake.calls, ["appCommand cmd_undo", "notify Nothing to undo."]);
});

test("the pane chords bind in the message document too, so focus can leave the message by them", () => {
    const message = MESSAGE_KEYMAP.normal ?? {};
    for (const [keys, pane] of [["H", "folders"], ["<A-h>", "threads"], ["L", "threads"], ["<A-l>", "message"]] as const) assert.deepEqual(message[keys], { id: "pane.focus", args: { pane } }, keys);
});

test("the pane commands only move the focus, so the bridge may run them", () => {
    for (const id of ["pane.focus", "pane.left", "pane.right"]) assert.equal(registry.get(id)?.bridge, true, id);
    for (const id of ["motion.down", "motion.up", "motion.top", "motion.bottom"]) assert.equal(registry.get(id)?.bridge, true, id);
});

test("pane.left and pane.right ask for the pane beside the focused one and stay quiet at the end", async () => {
    const fake = app_fake(true, false);
    await fake.run("pane.left");
    await fake.run("pane.right");
    assert.deepEqual(fake.calls, ["paneFocus left", "paneFocus right"]);
});

test("pane.focus on a hidden pane or an empty message pane is refused with a message", async () => {
    const fake = app_fake(true, false);
    await fake.run("pane.focus", { pane: "folders" });
    assert.deepEqual(fake.calls, ["paneFocus folders", "notify That pane is hidden or shows no message."]);
});
