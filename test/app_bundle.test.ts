import assert from "node:assert/strict";
import { test } from "node:test";
import { registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";

// Thunderbird loads the `app` script on the first call, so a verb answers only after that load. These tests stand the load in with a gate that the first call waits on.

function gated_app() {
    const calls: string[] = [];
    let open_gate: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open_gate = resolve));
    const app = {
        paneFocus: async ({ pane }: { pane: string }) => (await gate, calls.push(`paneFocus ${pane}`), true),
        appCommand: async () => (await gate, calls.push("appCommand"), true),
        viewRows: async () => (await gate, calls.push("viewRows"), { current: 0, rows: [] }),
    };
    const notes: string[] = [];
    const api = { app, notifications: { create: async (_id: string, notification: { message: string }) => (notes.push(notification.message), "n1") } } as unknown as RouterApi;
    const run = (command: string, args: Record<string, unknown> = {}) => create_router(registry, api).run({ command, args: args as never, count: 1, windowId: 3, messageIds: [] });
    return { run, calls, notes, open_gate };
}

test("a verb called while the app script loads waits for it and then runs once", async () => {
    const { run, calls, open_gate } = gated_app();
    const pending = run("pane.focus", { pane: "folders" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, []);
    open_gate();
    await pending;
    assert.deepEqual(calls, ["paneFocus folders"]);
});

test("first calls that arrive together each run once, in the order they came", async () => {
    const { run, calls, open_gate } = gated_app();
    const all = Promise.all([run("pane.focus", { pane: "folders" }), run("pane.focus", { pane: "threads" }), run("thread.open_conversation")]);
    await new Promise((resolve) => setImmediate(resolve));
    open_gate();
    await all;
    assert.deepEqual(calls, ["paneFocus folders", "paneFocus threads", "appCommand"]);
});

test("with no app script loaded a command that needs it refuses with a notice and calls nothing", async () => {
    const notes: string[] = [];
    const api = { app: undefined, notifications: { create: async (_id: string, notification: { message: string }) => (notes.push(notification.message), "n1") } } as unknown as RouterApi;
    await create_router(registry, api).run({ command: "pane.focus", args: { pane: "folders" } as never, count: 1, windowId: 3, messageIds: [] });
    assert.equal(notes.length, 1);
    assert.match(notes[0]!, /Experiment/);
});

test("the app parent holds no state: shutdown before any call, twice, and a call after it all work", async () => {
    const parent = await import("../src/chrome/parent_app.ts");
    parent.shutdown();
    parent.shutdown();
    const context = { extension: { windowManager: { getWrapper: () => null }, messageManager: { convert: () => null } } };
    const first = parent.get_app_api(context);
    const second = parent.get_app_api(context);
    assert.deepEqual(Object.keys(first.app).sort(), Object.keys(second.app).sort());
    assert.equal(Object.keys(first.app).length, 7);
});
