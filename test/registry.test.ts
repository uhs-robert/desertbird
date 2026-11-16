import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { summary_problems } from "../vendor/desertfox/registry/summary.ts";
import { registry } from "../src/background/registry.ts";

const CHROME_IDS = ["motion.down", "motion.up", "motion.top", "motion.bottom"];
const BACKGROUND_IDS = ["msg.archive", "msg.delete", "msg.reply"];

test("the registry defines the seven phase 1 commands", () => {
    assert.deepEqual(registry.list().map((command) => command.id).sort(), [...CHROME_IDS, ...BACKGROUND_IDS].sort());
});

test("runs_in and handlers follow the side", () => {
    for (const id of CHROME_IDS) {
        const command = registry.get(id);
        assert.equal(command?.runs_in, "chrome");
        assert.equal(command?.run, undefined);
    }
    for (const id of BACKGROUND_IDS) {
        const command = registry.get(id);
        assert.equal(command?.runs_in, "background");
        assert.equal(typeof command?.run, "function");
    }
});

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

test("every command states its bridge flag", () => {
    for (const command of registry.list()) assert.equal(typeof command.bridge, "boolean", command.id);
});
