import assert from "node:assert/strict";
import { test } from "node:test";
import { registry, message_background_commands } from "../src/background/commands/index.ts";
import { create_body_requests } from "../src/background/body_requests.ts";
import type { BodyRequestApi } from "../src/background/body_requests.ts";
import { create_router } from "../src/background/router.ts";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { fake_api } from "./fake_api.ts";
import type { KeysInvocation } from "../src/shared/protocol.ts";
import type { MessageFindApi } from "../src/background/handlers/message_find.ts";

const find = (pattern: unknown) => ({ command: "search.message", args: { pattern } as never, count: 1, windowId: 3, messageIds: [] });
const notifications = (calls: string[]) => calls.filter((call) => call.startsWith("notify"));

/** The router with the find API added to the fake: the tab list and the body script's answer. */
function find_router(reply: { found: boolean } | "none" | "throws", tabs: { id?: number }[] = [{ id: 7 }]) {
    const base = fake_api();
    const sent: string[] = [];
    const tabs_api: MessageFindApi["tabs"] = {
        query: async (query) => (base.calls.push(`tabs.query ${query.windowId}`), tabs),
        sendMessage: async (tab_id, message) => {
            sent.push(`${tab_id} ${JSON.stringify(message)}`);
            if (reply === "throws") throw new Error("Could not establish connection. Receiving end does not exist.");
            return reply === "none" ? undefined : reply;
        },
    };
    const router = create_router(registry, { ...base.api, tabs: tabs_api } as never);
    return { router, calls: base.calls, sent };
}

test("search.message is a background command named find with one required text param", () => {
    const command = registry.get("search.message")!;
    assert.equal(command.runs_in, "background");
    assert.equal(command.name, "find");
    assert.equal(check_args(command, {}).ok, false);
    assert.equal(check_args(command, { pattern: "   " }).ok, false, "the one validator refuses blank text");
    assert.equal(check_args(command, { pattern: "invoice 42" }).ok, true);
    assert.equal(check_args(command, { pattern: 4 as never }).ok, false);
});

test("the handler sends the pattern to the body script of the front tab", async () => {
    const { router, sent, calls } = find_router({ found: true });
    await router.run(find("invoice"));
    assert.deepEqual(sent, ['7 {"type":"body.find","pattern":"invoice"}']);
    assert.deepEqual(notifications(calls), []);
});

test("no match, no message and no tab each end in a notification", async () => {
    for (const [setup, expected] of [
        [find_router({ found: false }), '"zzz" is not in the message.'],
        [find_router("throws"), "No message is shown to search."],
        [find_router("none"), "No message is shown to search."],
        [find_router({ found: true }, []), "This window has no message to search."],
    ] as const) {
        await setup.router.run(find("zzz"));
        assert.deepEqual(notifications(setup.calls), [`notify ${expected}`]);
    }
});

test("a blank pattern never reaches the handler", async () => {
    const { router, sent, calls } = find_router({ found: true });
    await router.run(find(" "));
    assert.deepEqual(sent, []);
    assert.equal(notifications(calls).length, 1);
});

test("the typed line find invoice runs search.message", async () => {
    const { parse_command_line } = await import("../vendor/desertfox/registry/command_line.ts");
    const parsed = parse_command_line(registry, "find invoice 42");
    assert.equal(parsed.kind, "invocation");
    if (parsed.kind === "invocation") assert.deepEqual([parsed.invocation.id, parsed.invocation.args], ["search.message", { pattern: "invoice 42" }]);
});

function body_requests(window_type: string, displayed = [{ id: 11 }, { id: 12 }]) {
    const calls: string[] = [];
    const ran: KeysInvocation[] = [];
    const api: BodyRequestApi = {
        messageDisplay: { getDisplayedMessages: async (tab_id) => (calls.push(`displayed ${tab_id}`), displayed) },
        windows: { get: async (window_id) => (calls.push(`windows.get ${window_id}`), { type: window_type }) },
        notifications: { create: async (_id, notification) => (calls.push(`notify ${notification.message}`), "n1") },
    };
    const handle = create_body_requests({ registry, api, allowed: message_background_commands(), run: async (invocation) => void ran.push(invocation) });
    return { handle, calls, ran };
}

const sender = { tab: { id: 5, windowId: 9 } };
const open_line = { type: "body.invoke", command: "cmdline.open", args: { text: "find " }, count: 1 };

test("only the commands a message key binds are allowed", () => {
    const allowed = message_background_commands();
    for (const id of ["cmdline.open", "pane.focus", "msg.archive", "msg.delete", "msg.reply", "msg.yank", "tab.close", "tab.next", "tab.prev"]) assert.ok(allowed.has(id), id);
    for (const id of ["motion.down", "folder.read_all", "thread.expand", "app.open_page", "step.unread"]) assert.equal(allowed.has(id), false, id);
});

test("body.invoke runs the command on the window and the messages of the sender, not on ones the message names", async () => {
    const { handle, ran } = body_requests("normal");
    await handle({ ...open_line, windowId: 1, messageIds: [99] }, sender);
    assert.deepEqual(ran, [{ command: "cmdline.open", args: { text: "find " }, count: 1, windowId: 9, messageIds: [11, 12] }]);
});

test("body.invoke runs a mail command on the displayed message of the sender's window", async () => {
    const { handle, ran } = body_requests("messageDisplay");
    await handle({ type: "body.invoke", command: "msg.delete", args: {}, count: 1 }, sender);
    await handle({ type: "body.invoke", command: "tab.close", args: {}, count: 1 }, sender);
    assert.deepEqual(ran, [
        { command: "msg.delete", args: {}, count: 1, windowId: 9, messageIds: [11, 12] },
        { command: "tab.close", args: {}, count: 1, windowId: 9, messageIds: [11, 12] },
    ]);
});

test("a mail key with no displayed message refuses with a notification and acts on nothing", async () => {
    const base = fake_api();
    const router = create_router(registry, base.api);
    const refusing = create_body_requests({ registry, api: { messageDisplay: { getDisplayedMessages: async () => [] }, windows: { get: async () => ({ type: "normal" }) }, notifications: { create: async (_id, notification) => (base.calls.push(`notify ${notification.message}`), "n1") } }, allowed: message_background_commands(), run: (invocation) => router.run(invocation) });
    for (const command of ["msg.delete", "msg.archive"]) await refusing({ type: "body.invoke", command, args: {}, count: 1 }, sender);
    assert.equal(notifications(base.calls).length, 2);
    assert.equal(base.calls.some((call) => /messages\.(delete|archive)/.test(call)), false);
});

test("body.invoke refuses a message window with a notification and runs nothing", async () => {
    const { handle, ran, calls } = body_requests("messageDisplay");
    await handle(open_line, sender);
    assert.deepEqual(ran, []);
    assert.deepEqual(notifications(calls), ["notify The command line is not available in a message window. Open the message in a tab to use it."]);
});

test("body.invoke drops a command no message key binds, a request with no tab and a malformed request", async () => {
    const { handle, ran } = body_requests("normal");
    await handle({ ...open_line, command: "folder.read_all" }, sender);
    await handle({ ...open_line, command: "motion.down" }, sender);
    await handle(open_line, {});
    assert.deepEqual(ran, []);
    for (const bad of [{ ...open_line, count: 0 }, { ...open_line, args: [] }, { ...open_line, command: 4 }, { type: "cmdline.hello", windowId: 1 }, null, "x"]) assert.equal(handle(bad, sender), undefined);
});

test("a body.invoke command with a bad arg is refused by the one validator in the router", async () => {
    const base = fake_api();
    const router = create_router(registry, base.api);
    await router.run({ command: "cmdline.open", args: { text: 5 } as never, count: 1, windowId: 3, messageIds: [] });
    assert.equal(notifications(base.calls).length, 1);
    assert.equal(base.calls.some((call) => call.startsWith("cmdline.begin")), false);
});
