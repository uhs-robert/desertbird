import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, UNREPEATABLE_IDS, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { default_keymap_of } from "../src/background/commands/tab_keymaps.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";

const ok = (id: string, args: Record<string, unknown>) => check_args(registry.get(id)!, args).ok;

function app_fake(command_enabled = true, pane_focused = true, page_offered = true) {
    const calls: string[] = [];
    const app = {
        appCommand: async ({ name }: { name: string }) => (calls.push(`appCommand ${name}`), command_enabled),
        appOpenPage: async ({ windowId, page }: { windowId: number; page: string }) => (calls.push(`appOpenPage ${page}${windowId === 3 ? "" : ` in ${windowId}`}`), page_offered),
        paneFocus: async ({ pane }: { pane: string }) => (calls.push(`paneFocus ${pane}`), pane_focused),
    };
    const notifications = { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") };
    // Window 3 is a main window, window 8 a message window.
    const windows = { get: async (window_id: number) => ({ type: window_id === 8 ? "messageDisplay" : "normal" }), getAll: async () => [{ id: 3 }], update: async (window_id: number) => void calls.push(`focus ${window_id}`) };
    const api = { app, notifications, windows } as unknown as RouterApi;
    const run = (command: string, args: Record<string, unknown> = {}, window_id = 3) => create_router(registry, api).run({ command, args: args as never, count: 1, windowId: window_id, messageIds: [] });
    return { run, calls };
}

test("app.open_page and pane.focus take only the names the table lists", () => {
    for (const page of ["addons", "themes", "config", "mail", "addressbook", "calendar", "tasks", "chat", "settings", "accountsettings", "activity", "downloads", "support"]) assert.equal(ok("app.open_page", { page }), true, page);
    assert.equal(ok("app.open_page", { page: "https://example.org" }), false);
    assert.equal(ok("app.open_page", {}), false);
    for (const pane of ["folders", "threads", "message"]) assert.equal(ok("pane.focus", { pane }), true, pane);
    assert.equal(ok("pane.focus", { pane: "compose" }), false);
});

test("the app keys bind their commands and add no warning, and u undoes", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    assert.deepEqual(normal["u"], { id: "msg.undo" });
    assert.deepEqual(normal["gC"], { id: "thread.open_conversation", label: "Open conversation" });
    for (const [keys, page, label] of [["gpa", "addons", "Add-ons"], ["gpt", "themes", "Themes"], ["gpc", "config", "Config"], ["gpm", "mail", "Mail"], ["gpb", "addressbook", "Address book"], ["gpl", "calendar", "Calendar"], ["gpk", "tasks", "Tasks"], ["gph", "chat", "Chat"], ["gps", "settings", "Settings"], ["gpn", "accountsettings", "Account settings"], ["gpd", "downloads", "Saved files"], ["gpy", "activity", "Activity manager"], ["gpi", "support", "Troubleshooting"]] as const) assert.deepEqual(normal[keys], { id: "app.open_page", args: { page }, label }, keys);
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

test("app.open_page refuses with a message when the chrome says the page is not offered, as chat is while turned off", async () => {
    const fake = app_fake(true, true, false);
    await fake.run("app.open_page", { page: "chat" });
    assert.deepEqual(fake.calls, ["appOpenPage chat", "notify Chat is turned off."]);
});

test("app.open_page from a message window opens the page in the main window and brings it to the front", async () => {
    const fake = app_fake();
    await fake.run("app.open_page", { page: "config" }, 8);
    assert.deepEqual(fake.calls, ["focus 3", "appOpenPage config"]);
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

test("step.message runs the command for each direction and unread flag, and checks its args", async () => {
    assert.equal(ok("step.message", { direction: "next" }), true);
    assert.equal(ok("step.message", { direction: "previous", unread: true }), true);
    assert.equal(ok("step.message", { direction: "sideways" }), false);
    const fake = app_fake();
    for (const [direction, unread] of [["next", false], ["previous", false], ["next", true], ["previous", true]] as const) await fake.run("step.message", { direction, unread }, 8);
    assert.deepEqual(fake.calls, ["appCommand cmd_nextMsg", "appCommand cmd_previousMsg", "appCommand cmd_nextUnreadMsg", "appCommand cmd_previousUnreadMsg"]);
});

test("step.message refuses with a toast when the Experiment answers false, at either end or in a window with no list", async () => {
    for (const [direction, unread, text] of [["next", false, "No later message here."], ["previous", false, "No earlier message here."], ["next", true, "No later unread message here."], ["previous", true, "No earlier unread message here."]] as const) {
        const fake = app_fake(false);
        await fake.run("step.message", { direction, unread }, 8);
        assert.deepEqual(fake.calls.slice(1), [`notify ${text}`], `${direction} ${unread}`);
    }
});

test("step.message refuses in the mail tab, where it would step the list through the main window's controller", async () => {
    const fake = app_fake();
    await fake.run("step.message", { direction: "next" }, 3);
    assert.deepEqual(fake.calls, ["notify Stepping the message is only available in a message window."]);
});

test("the window keys J, K, ] u and [ u step the message, and only a message window has them", () => {
    const window_normal = default_keymap_of("window").normal ?? {};
    assert.deepEqual(window_normal["J"], { id: "step.message", args: { direction: "next", unread: false }, label: "Next message" });
    assert.deepEqual(window_normal["]u"], { id: "step.message", args: { direction: "next", unread: true }, label: "Unread" });
    assert.equal(window_normal["]U"], undefined);
    for (const kind of ["message", "own", "page"] as const) assert.equal((default_keymap_of(kind).normal?.["J"] as { id: string }).id, "tab.next", kind);
    assert.equal((DEFAULT_KEYMAP.normal?.["]u"] as { id: string }).id, "step.unread");
    assert.equal((DEFAULT_KEYMAP.normal?.["J"] as { id: string }).id, "tab.next");
});

test("app.get_mail fetches for the current account, or for every account with --all, and checks its args", async () => {
    assert.equal(registry.get("app.get_mail")?.name, "fetch");
    assert.equal(ok("app.get_mail", {}), true);
    assert.equal(ok("app.get_mail", { all: true }), true);
    assert.equal(ok("app.get_mail", { all: "yes" }), false);
    const fake = app_fake();
    await fake.run("app.get_mail");
    await fake.run("app.get_mail", { all: true });
    assert.deepEqual(fake.calls, ["appCommand cmd_getNewMessages", "appCommand cmd_getMsgsForAuthAccounts"]);
});

test("app.get_mail has one default key, U, and refuses with a message when Thunderbird has the command disabled", async () => {
    assert.deepEqual(DEFAULT_KEYMAP.normal?.["U"], { id: "app.get_mail", label: "Fetch mail" });
    assert.equal(registry.get("app.get_mail")?.bridge, false);
    const fake = app_fake(false);
    await fake.run("app.get_mail");
    assert.deepEqual(fake.calls, ["appCommand cmd_getNewMessages", "notify Thunderbird cannot fetch mail now. There may be no mail account."]);
});
