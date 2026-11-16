import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../vendor/desertfox/registry/check_args.ts";
import { create_registry } from "../vendor/desertfox/registry/define.ts";
import { summary_problems } from "../vendor/desertfox/registry/summary.ts";
import { registry } from "../src/background/registry.ts";
import { create_router } from "../src/background/router.ts";
import type { KeysInvocation } from "../src/shared/protocol.ts";
import type { RouterApi } from "../src/background/router.ts";

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

test("a handler that calls a view verb outside its needs fails", async () => {
    const local = create_registry();
    local.define("test.rows_only", {
        runs_in: "background",
        label: "Probe",
        intent: "Probe the needs guard.",
        needs: ["view.rows"],
        run: async (ctx) => {
            const scope = ctx as unknown as { view: { select(args: { anchor: number; end: number }): Promise<void> } };
            await scope.view.select({ anchor: 0, end: 0 });
        },
    });
    const calls: string[] = [];
    const api = {
        tabs: { query: async () => [{ id: 7 }] },
        mailTabs: { getSelectedMessages: async () => ({ messages: [{ id: 1 }] }) },
        notifications: { create: async (_id: string | undefined, notification: { message: string }) => (calls.push(`notify ${notification.message}`), "n1") },
        view: {
            rows: async () => [],
            select: async () => void calls.push("view.select"),
        },
    } as unknown as RouterApi;
    await create_router(local, api).run({ command: "test.rows_only", args: {}, count: 1, windowId: 1 } satisfies KeysInvocation);
    assert.equal(calls.filter((call) => call.startsWith("view.select")).length, 0);
    assert.match(calls.find((call) => call.startsWith("notify")) ?? "", /view\.select is not listed/);
});
