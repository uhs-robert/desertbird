import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_COMMAND_CHARS, create_bridge_run, list_bridge_commands, never_listed } from "../src/background/bridge/run.ts";
import { registry } from "../src/background/commands/index.ts";
import type { KeysInvocation } from "../src/shared/protocol.ts";

function run_under_test(options: { window_id?: number | undefined; route?: (invocation: KeysInvocation) => Promise<void> } = {}) {
    const routed: KeysInvocation[] = [];
    const bridge = create_bridge_run({
        target_window: async () => ("window_id" in options ? options.window_id : 4),
        route: async (invocation) => {
            routed.push(invocation);
            await options.route?.(invocation);
        },
    });
    return { run: bridge.run, routed };
}

const bridge_flag = (id: string) => (registry.get(id) as { bridge?: boolean } | undefined)?.bridge;

test("a bridge command runs through the router in the last focused main window, with no selection and a count of 1", async () => {
    const { run, routed } = run_under_test();
    assert.deepEqual(await run("pane.toggle folder"), { ok: true });
    assert.deepEqual(routed, [{ command: "pane.toggle", args: { pane: "folder" }, count: 1, windowId: 4, messageIds: [] }]);
});

test("send, delete, move and the other mail changes are refused before their args are read", async () => {
    const { run, routed } = run_under_test();
    for (const text of ["msg.delete", "msg.move --no-such-flag", "msg.archive", "msg.junk", "msg.snooze", "msg.reply", "msg.forward", "msg.new", "msg.reply_with 1", "msg.delete \"unclosed"]) {
        const answer = await run(text);
        assert.equal(answer.ok, false, text);
        assert.match((answer as { message: string }).message, /never runs through the bridge/, text);
    }
    assert.equal((await run('"msg.delete"')).ok, false, "a quoted first word is refused after the parse");
    assert.deepEqual(routed, []);
});

test("repeat.last, every hint command, mark.set and msg.undo are refused, whatever their bridge field says", async () => {
    const { run, routed } = run_under_test();
    assert.equal(bridge_flag("repeat.last"), true, "the never-list must hold even for a bridge: true command");
    assert.equal(bridge_flag("hint.pick"), true);
    for (const id of ["repeat.last", "hint.pick", "mark.set", "msg.undo"]) assert.deepEqual(await run(id), { ok: false, message: `${id} never runs through the bridge` });
    assert.deepEqual(routed, []);
});

test("the clipboard group and the commands that open an address never run", async () => {
    const { run } = run_under_test();
    for (const id of ["msg.yank", "msg.open", "msg.unsubscribe", "app.open_page", "help.open"]) {
        assert.ok(never_listed(id), id);
        assert.equal((await run(id)).ok, false, id);
    }
    for (const id of ["config.reload", "settings.set", "native.call", "permissions.request", "clipboard.read", "hint.any"]) assert.ok(never_listed(id), id);
});

test("every never-listed and every bridge: false command is refused and reaches no router", async () => {
    const { run, routed } = run_under_test();
    for (const command of registry.list()) {
        if (!never_listed(command.id) && bridge_flag(command.id) === true) continue;
        const answer = await run(command.id);
        assert.equal(answer.ok, false, command.id);
    }
    assert.deepEqual(routed, []);
});

test("a bridge: false command names the bridge field in its refusal", async () => {
    const { run } = run_under_test();
    assert.deepEqual(await run("notify.toggle"), { ok: false, message: "notify.toggle is not allowed through the bridge" });
});

test("a chrome or message command is refused: the background cannot start a key command", async () => {
    const { run, routed } = run_under_test();
    assert.deepEqual(await run("motion.down"), { ok: false, message: "motion.down runs on a key in the mail window and cannot run through the bridge" });
    assert.equal((await run("message.scroll_down")).ok, false);
    assert.deepEqual(routed, []);
});

test("bad args fail in the one validator and reach no router", async () => {
    const { run, routed } = run_under_test();
    const answer = await run("pane.toggle sideways");
    assert.equal(answer.ok, false);
    assert.match((answer as { message: string }).message, /sideways/);
    assert.equal((await run("pane.toggle")).ok, false, "a missing required value is a refusal, never an open command line");
    assert.deepEqual(routed, []);
});

test("unknown text, help, @sources and an over-long line are refused", async () => {
    const { run, routed } = run_under_test();
    assert.deepEqual(await run("no.such"), { ok: false, message: 'unknown command "no.such"' });
    assert.equal((await run("")).ok, false);
    assert.equal((await run("search.threads @clipboard")).ok, false);
    assert.deepEqual(await run(`search.threads ${"x".repeat(MAX_COMMAND_CHARS)}`), { ok: false, message: "the command text is too long" });
    assert.deepEqual(routed, []);
});

test("with no main window open nothing runs", async () => {
    const { run, routed } = run_under_test({ window_id: undefined });
    assert.deepEqual(await run("tab.next"), { ok: false, message: "no mail window is open" });
    assert.deepEqual(routed, []);
});

test("a handler failure comes back as fixed text, so no folder name or subject leaves", async () => {
    const { run } = run_under_test({ route: () => Promise.reject(new Error("No folder named Secret Plans")) });
    assert.deepEqual(await run("folder.open --folder=Secret"), { ok: false, message: "folder.open failed" });
});

test("list holds exactly the commands run accepts", async () => {
    const { run } = run_under_test();
    const listed = list_bridge_commands().map((command) => command.id);
    for (const id of listed) {
        const answer = await run(id);
        // A command with a required value refuses in the validator, never in the bridge rules.
        if (!answer.ok) assert.doesNotMatch(answer.message, /bridge|runs on a key/, id);
    }
    for (const command of registry.list()) if (!listed.includes(command.id)) assert.match(((await run(command.id)) as { message: string }).message, /bridge/, command.id);
});

test("list withholds folder, tag and tab names: a dynamic param carries only its source", () => {
    const dynamic = list_bridge_commands().flatMap((command) => (command.params ?? []).filter((param) => param.values !== undefined && !Array.isArray(param.values)).map((param) => [command.id, param.values]));
    assert.ok(dynamic.length > 0);
    for (const [id, values] of dynamic) assert.deepEqual(Object.keys(values as object), ["from"], id as string);
    const listed = list_bridge_commands();
    assert.ok(listed.every((command) => Object.keys(command).every((key) => ["id", "label", "name", "aliases", "intent", "params", "count"].includes(key))));
});
