import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, UNREPEATABLE_IDS, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { default_keymap_of } from "../src/background/commands/tab_keymaps.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";

const ok = (id: string, args: Record<string, unknown>) => check_args(registry.get(id)!, args).ok;

function app_fake(command_enabled = true, pane_focused = true) {
    const calls: string[] = [];
    const app = {
        appCommand: async ({ name }: { name: string }) => (calls.push(`appCommand ${name}`), command_enabled),
        appOpenPage: async ({ page }: { page: string }) => void calls.push(`appOpenPage ${page}`),
        paneFocus: async ({ pane }: { pane: string }) => (calls.push(`paneFocus ${pane}`), pane_focused),
    };
    const notifications = { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") };
    const api = { app, notifications } as unknown as RouterApi;
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

test("the app keys bind their commands and add no warning, and u undoes", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    assert.deepEqual(normal["u"], { id: "msg.undo" });
    assert.deepEqual(normal["gC"], { id: "thread.open_conversation", label: "Open conversation" });
    for (const [keys, page, label] of [["gpa", "addons", "Add-ons"], ["gpt", "themes", "Themes"], ["gpc", "config", "Config"]] as const) assert.deepEqual(normal[keys], { id: "app.open_page", args: { page }, label }, keys);
    for (const keys of ["gx", "gT", "gc"]) assert.equal(normal[keys], undefined, keys);
    for (const [keys, pane, label] of [["gf", "folders", "Folder pane"], ["ge", "threads", "Thread list"], ["gm", "message", "Message pane"]] as const) assert.deepEqual(normal[keys], { id: "pane.focus", args: { pane }, label }, keys);
    assert.ok(registry.get("folder.collapse"), "the command stays in the registry");
    assert.equal(Object.values(normal).some((binding) => (binding as { id?: string })?.id === "folder.collapse"), false, "folder.collapse has no default key");
    for (const [keys, id] of [["wh", "pane.left"], ["wl", "pane.right"], ["H", "pane.left"], ["<A-h>", "pane.left"], ["L", "pane.right"], ["<A-l>", "pane.right"]] as const) assert.deepEqual(normal[keys], { id, label: id === "pane.left" ? "Pane left" : "Pane right" }, keys);
    assert.deepEqual(compile_default_keymap().warnings ?? [], []);
});

test("msg.undo changes mail, so the bridge refuses it and . never repeats it", () => {
    assert.equal(registry.get("msg.undo")?.bridge, false);
    assert.ok(UNREPEATABLE_IDS.has("msg.undo"));
    assert.ok(!UNREPEATABLE_IDS.has("pane.focus"));
});

test("each command calls only the chrome verb its needs lists", async () => {
    const fake = app_fake();
    await fake.run("thread.open_conversation");
    await fake.run("app.open_page", { page: "themes" });
    await fake.run("pane.focus", { pane: "message" });
    assert.deepEqual(fake.calls, ["appCommand cmd_openConversation", "appOpenPage themes", "paneFocus message"]);
});

test("msg.undo needs no chrome verb: it reads DesertBird's own log, not Thunderbird's undo", () => {
    assert.deepEqual(registry.get("msg.undo")?.needs, ["message"]);
});

test("a command Thunderbird has disabled is refused with a message", async () => {
    const fake = app_fake(false);
    await fake.run("thread.open_conversation");
    assert.deepEqual(fake.calls, ["appCommand cmd_openConversation", "notify Thunderbird cannot open a conversation for this selection."]);
});

test("the pane chords bind in the message document too, so focus can leave the message by them", () => {
    const message = default_keymap_of("message").normal ?? {};
    for (const [keys, id] of [["H", "pane.left"], ["<A-h>", "pane.left"], ["L", "pane.right"], ["<A-l>", "pane.right"]] as const) assert.equal((message[keys] as { id?: string })?.id, id, keys);
});

test("the pane commands only move the focus, so the bridge may run them", () => {
    for (const id of ["pane.focus", "pane.left", "pane.right"]) assert.equal(registry.get(id)?.bridge, true, id);
    for (const id of ["motion.down", "motion.up", "motion.top", "motion.bottom"]) assert.equal(registry.get(id)?.bridge, true, id);
});

test("pane.left and pane.right stop at the edge: the chrome verb answers false past an end and the focus stays", () => {
    const source = readFileSync(new URL("../src/chrome/app_verbs.ts", import.meta.url), "utf8");
    assert.match(source, /PANES\[pane === "left" \? focused - 1 : pane === "right" \? focused \+ 1 : /, "no wrap: an index past an end finds no pane");
    assert.doesNotMatch(source, /% PANES\.length/);
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

test("folder.collapse collapses in the folder pane and focuses the folder pane from any other", async () => {
    const calls: string[] = [];
    let in_folder_pane = true;
    const api = {
        app: { paneFocus: async ({ pane }: { pane: string }) => (calls.push(`paneFocus ${pane}`), true) },
        folderpane: { fold: async ({ extent }: { extent: string }) => (calls.push(`fold ${extent}`), in_folder_pane) },
    } as unknown as RouterApi;
    const run = () => create_router(registry, api).run({ command: "folder.collapse", args: {} as never, count: 1, windowId: 3, messageIds: [] });
    await run();
    in_folder_pane = false;
    await run();
    assert.deepEqual(calls, ["fold parent", "fold parent", "paneFocus folders"]);
});

test("folder.collapse still focuses the folder pane when the folder script fails to load or is absent", async () => {
    for (const folderpane of [{ fold: async () => Promise.reject(new Error("the folder script did not load")) }, undefined]) {
        const calls: string[] = [];
        const api = { app: { paneFocus: async ({ pane }: { pane: string }) => (calls.push(`paneFocus ${pane}`), true) }, folderpane } as unknown as RouterApi;
        await create_router(registry, api).run({ command: "folder.collapse", args: {} as never, count: 1, windowId: 3, messageIds: [] });
        assert.deepEqual(calls, ["paneFocus folders"]);
    }
});
