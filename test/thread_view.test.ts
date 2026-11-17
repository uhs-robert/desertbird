import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { DEFAULT_KEYMAP, compile_default_keymap, registry } from "../src/background/commands/index.ts";
import { create_router } from "../src/background/router.ts";
import type { RouterApi } from "../src/background/router.ts";
import type { ViewRow } from "../src/shared/protocol.ts";

const ok = (id: string, args: Record<string, unknown>) => check_args(registry.get(id)!, args).ok;

// A row spec is its depth, with "+" for a closed thread. Row ids are index + 100.
function list_fake(spec: (number | "+")[], current: number, count = 1, ids?: number[]) {
    const rows: ViewRow[] = spec.map((entry, index) => ({ index, id: ids?.[index] ?? index + 100, depth: entry === "+" ? 0 : entry, collapsed: entry === "+", unread: false, flags: 0 }));
    const calls: string[] = [];
    const keys = {
        viewRows: async ({ first, last }: { first: number; last: number }) => (calls.push(`viewRows ${first} ${last}`), { current, rows: rows.slice(first, last + 1) }),
        viewThread: async ({ row, open }: { row: number; open: boolean }) => void calls.push(`viewThread ${row} ${open}`),
        viewAllThreads: async ({ open }: { open: boolean }) => void calls.push(`viewAllThreads ${open}`),
        viewScroll: async ({ row, position }: { row: number; position: string }) => void calls.push(`viewScroll ${row} ${position}`),
    };
    const mailTabs = {
        query: async () => [{ id: 9 }],
        setSelectedMessages: async (tab_id: number, ids: number[]) => void calls.push(`select ${tab_id} ${ids.join(",")}`),
    };
    const notifications = { create: async (_id: string, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") };
    const api = { keys, mailTabs, notifications } as unknown as RouterApi;
    const run = (command: string, args: Record<string, unknown> = {}) => create_router(registry, api).run({ command, args: args as never, count, windowId: 3, messageIds: [] });
    return { run, calls: () => calls.filter((call) => !call.startsWith("viewRows")), all: calls };
}

test("the thread commands check their typed args", () => {
    assert.equal(ok("step.thread_root", { direction: "next" }), true);
    assert.equal(ok("step.thread_root", { direction: "up" }), false);
    assert.equal(ok("step.thread_root", {}), false);
    assert.equal(ok("view.reposition", { position: "center" }), true);
    assert.equal(ok("view.reposition", { position: "middle" }), false);
    assert.equal(ok("thread.fold_all", { open: true }), true);
    assert.equal(ok("thread.fold_all", { open: 3 }), false);
    assert.equal(ok("thread.fold_all", {}), true);
    assert.equal(ok("motion.left", {}), true);
});

test("the keys h l z z z t z b z M z R and the thread root steps bind their commands", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    assert.deepEqual(normal["h"], { id: "motion.left" });
    assert.deepEqual(normal["l"], { id: "motion.right" });
    assert.deepEqual(normal["]t"], { id: "step.thread_root", args: { direction: "next" } });
    assert.deepEqual(normal["[t"], { id: "step.thread_root", args: { direction: "previous" } });
    for (const [keys, position] of [["zz", "center"], ["zt", "top"], ["zb", "bottom"]] as const) assert.deepEqual(normal[keys], { id: "view.reposition", args: { position } }, keys);
    assert.deepEqual(normal["zM"], { id: "thread.fold_all", args: { open: false } });
    assert.deepEqual(normal["zR"], { id: "thread.fold_all", args: { open: true } });
    assert.deepEqual(compile_default_keymap().warnings ?? [], []);
});

test("the thread commands need the chrome verbs they call", () => {
    for (const id of ["motion.left", "motion.right", "step.thread_root", "view.reposition", "thread.fold_all"]) assert.ok(registry.get(id)?.needs?.some((need) => need.startsWith("keys.view")), id);
});

test("h on a reply selects the root of its thread, and on a root closes the thread", async () => {
    const reply = list_fake([0, 1, 2, 0], 2);
    await reply.run("motion.left");
    assert.deepEqual(reply.calls(), ["select 9 100"]);
    const root = list_fake([0, 1, 0], 0);
    await root.run("motion.left");
    assert.deepEqual(root.calls(), ["viewThread 0 false"]);
});

test("l opens a closed thread, goes from an open root to its first reply and stays on a lone message", async () => {
    const closed = list_fake(["+", 0], 0);
    await closed.run("motion.right");
    assert.deepEqual(closed.calls(), ["viewThread 0 true"]);
    const open = list_fake([0, 1, 0], 0);
    await open.run("motion.right");
    assert.deepEqual(open.calls(), ["select 9 101"]);
    const lone = list_fake([0, 0], 0);
    await lone.run("motion.right");
    assert.deepEqual(lone.calls(), []);
});

test("step.thread_root next skips replies and previous from a reply goes to its own root", async () => {
    const next = list_fake([0, 1, 1, 0, 1], 1);
    await next.run("step.thread_root", { direction: "next" });
    assert.deepEqual(next.calls(), ["select 9 103"]);
    const previous = list_fake([0, 1, 0, 1, 1], 4);
    await previous.run("step.thread_root", { direction: "previous" });
    assert.deepEqual(previous.calls(), ["select 9 102"]);
    const from_root = list_fake([0, 1, 0, 1], 2);
    await from_root.run("step.thread_root", { direction: "previous" });
    assert.deepEqual(from_root.calls(), ["select 9 100"]);
});

test("step.thread_root repeats by the count, stops at the end and refuses where it cannot move at all", async () => {
    const two = list_fake([0, 1, 0, 0, 1], 0, 2);
    await two.run("step.thread_root", { direction: "next" });
    assert.deepEqual(two.calls(), ["select 9 103"]);
    const past = list_fake([0, 0, 0], 0, 9);
    await past.run("step.thread_root", { direction: "next" });
    assert.deepEqual(past.calls(), ["select 9 102"]);
    const last = list_fake([0, 1], 1);
    await last.run("step.thread_root", { direction: "next" });
    assert.deepEqual(last.calls(), ["notify No later thread."]);
    const first = list_fake([0, 1], 0);
    await first.run("step.thread_root", { direction: "previous" });
    assert.deepEqual(first.calls(), ["notify No earlier thread."]);
});

test("the search for a root crosses the blocks of rows it reads", async () => {
    const spec = [0, ...Array.from({ length: 130 }, () => 1), 0];
    const forward = list_fake(spec, 0);
    await forward.run("step.thread_root", { direction: "next" });
    assert.deepEqual(forward.calls(), ["select 9 231"]);
    const backward = list_fake(spec, 130);
    await backward.run("step.thread_root", { direction: "previous" });
    assert.deepEqual(backward.calls(), ["select 9 100"]);
});

test("a list with no current row refuses", async () => {
    const none = list_fake([0, 0], -1);
    await none.run("motion.left");
    assert.deepEqual(none.calls(), ["notify No row is selected."]);
});

test("view.reposition scrolls the current row and thread.fold_all passes the open flag", async () => {
    const scroll = list_fake([0, 0, 0], 2);
    await scroll.run("view.reposition", { position: "bottom" });
    assert.deepEqual(scroll.calls(), ["viewScroll 2 bottom"]);
    const fold = list_fake([0], 0);
    await fold.run("thread.fold_all", { open: false });
    await fold.run("thread.fold_all", { open: true });
    assert.deepEqual(fold.calls(), ["viewAllThreads false", "viewAllThreads true"]);
});

test("a thread command refuses when the Experiment is missing", async () => {
    const calls: string[] = [];
    const api = { keys: undefined, notifications: { create: async (_id: string, notification: { message: string }) => (calls.push(notification.message), "n1") } } as unknown as RouterApi;
    await create_router(registry, api).run({ command: "motion.left", args: {}, count: 1, windowId: 3, messageIds: [] });
    assert.match(calls[0] ?? "", /Experiment/);
});

test("in a grouped view a header shares the id of its first member: [ t searches past it and h closes the group", async () => {
    const depths = [0, 1, 1, 0, 1, 1];
    const ids = [100, 100, 101, 102, 102, 103];
    const back = list_fake(depths, 4, 1, ids);
    await back.run("step.thread_root", { direction: "previous" });
    assert.deepEqual(back.calls(), ["select 9 100"]);
    const none = list_fake(depths, 1, 1, ids);
    await none.run("step.thread_root", { direction: "previous" });
    assert.deepEqual(none.calls(), ["notify No earlier thread."]);
    const close = list_fake(depths, 4, 1, ids);
    await close.run("motion.left");
    assert.deepEqual(close.calls(), ["viewThread 3 false"]);
    const reply = list_fake(depths, 5, 1, ids);
    await reply.run("motion.left");
    assert.deepEqual(reply.calls(), ["select 9 102"]);
});
