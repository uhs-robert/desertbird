import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { summary_problems } from "../vendor/desertfox/registry/summary.ts";
import { DEFAULT_KEYMAP, GROUPS, registry } from "../src/background/commands/index.ts";

/** One row per group file: the side it runs on and the command ids it holds. Add a row with each new group. */
const GROUP_TABLE: Record<string, { runs_in: "chrome" | "background"; ids: string[] }> = {
    motion: { runs_in: "chrome", ids: ["motion.down", "motion.up", "motion.top", "motion.bottom"] },
    messages: { runs_in: "background", ids: ["msg.archive", "msg.delete", "msg.reply"] },
    view: { runs_in: "background", ids: ["filter.set", "search.threads", "sort.set", "pane.toggle"] },
};

test("every group file has a table row and each row has a group", () => {
    assert.deepEqual(Object.keys(GROUPS).sort(), Object.keys(GROUP_TABLE).sort());
});

test("the registry holds exactly the commands of the groups", () => {
    const expected = Object.values(GROUP_TABLE).flatMap((row) => row.ids);
    assert.deepEqual(registry.list().map((command) => command.id).sort(), expected.sort());
});

for (const [name, row] of Object.entries(GROUP_TABLE)) {
    test(`group ${name}: commands, runs_in and handlers follow the side`, () => {
        assert.deepEqual(Object.keys(GROUPS[name]!.commands).sort(), [...row.ids].sort());
        for (const id of row.ids) {
            const command = registry.get(id);
            assert.equal(command?.runs_in, row.runs_in, id);
            assert.equal(typeof command?.run, row.runs_in === "background" ? "function" : "undefined", id);
            assert.equal(typeof command?.bridge, "boolean", id);
        }
    });

    test(`group ${name}: every default key names a command of the group`, () => {
        for (const [keys, binding] of Object.entries(GROUPS[name]!.normal_keys)) assert.ok(binding && !Array.isArray(binding) && row.ids.includes(binding.id), keys);
    });
}

test("every summary follows the summary rules", () => {
    const ids = registry.list().map((command) => command.id);
    for (const command of registry.list()) assert.deepEqual(summary_problems(command, ids), [], command.id);
});

test("msg.reply checks its args in the one validator", () => {
    const reply = registry.get("msg.reply");
    assert.ok(reply);
    assert.equal(check_args(reply, { to: "sender" }).ok, true);
    assert.equal(check_args(reply, {}).ok, true);
    assert.equal(check_args(reply, { to: "everyone" }).ok, false);
    assert.equal(check_args(reply, { cc: "x" }).ok, false);
    const archive = registry.get("msg.archive");
    assert.ok(archive);
    assert.equal(check_args(archive, { to: "sender" }).ok, false);
});

/** The phase 1 commands as shipped: their default key, args, side and bridge value. A refactor of the table must keep every row. */
const PHASE_1_COMMANDS = [
    { id: "motion.down", keys: "j", args: undefined, runs_in: "chrome", bridge: true },
    { id: "motion.up", keys: "k", args: undefined, runs_in: "chrome", bridge: true },
    { id: "motion.top", keys: "gg", args: undefined, runs_in: "chrome", bridge: true },
    { id: "motion.bottom", keys: "G", args: undefined, runs_in: "chrome", bridge: true },
    { id: "msg.archive", keys: "x", args: undefined, runs_in: "background", bridge: false },
    { id: "msg.delete", keys: "dd", args: undefined, runs_in: "background", bridge: false },
    { id: "msg.reply", keys: "r", args: { to: "sender" }, runs_in: "background", bridge: false },
];

test("the phase 1 commands keep their keys, args, side and bridge value", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    for (const row of PHASE_1_COMMANDS) {
        const binding = normal[row.keys];
        assert.ok(binding && !Array.isArray(binding), row.id);
        assert.equal(binding.id, row.id);
        assert.deepEqual(binding.args, row.args, row.id);
        assert.equal(registry.get(row.id)?.runs_in, row.runs_in, row.id);
        assert.equal(registry.get(row.id)?.bridge, row.bridge, row.id);
    }
});

test("every default key runs a registered command and no key is bound in two groups", () => {
    const per_group = Object.values(GROUPS).flatMap((group) => Object.keys(group.normal_keys));
    assert.equal(new Set(per_group).size, per_group.length, "a key sits in two groups");
    assert.equal(Object.keys(DEFAULT_KEYMAP.normal ?? {}).length, per_group.length);
    for (const [keys, binding] of Object.entries(DEFAULT_KEYMAP.normal ?? {})) {
        assert.ok(binding && !Array.isArray(binding) && registry.get(binding.id), keys);
    }
});

test("the view keys run the planned commands with the planned args", () => {
    const normal = DEFAULT_KEYMAP.normal ?? {};
    const planned: Record<string, { id: string; args: Record<string, string> }> = {
        Fu: { id: "filter.set", args: { state: "unread" } },
        Fa: { id: "filter.set", args: { state: "all" } },
        Fs: { id: "filter.set", args: { state: "starred" } },
        Ff: { id: "filter.set", args: { state: "attachment" } },
        tm: { id: "pane.toggle", args: { pane: "message" } },
        tf: { id: "pane.toggle", args: { pane: "folder" } },
    };
    for (const [keys, binding] of Object.entries(planned)) assert.deepEqual(normal[keys], binding, keys);
});
