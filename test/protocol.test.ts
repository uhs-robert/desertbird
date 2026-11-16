import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPERIMENT_VERBS, type KeysInvocation } from "../src/shared/protocol.ts";

test("the Experiment exposes the fixed verb table", () => {
    assert.deepEqual(EXPERIMENT_VERBS.keys.functions, ["install"]);
    assert.deepEqual(EXPERIMENT_VERBS.view.functions, ["rows", "select"]);
});

test("an invocation payload is plain data", () => {
    const invocation: KeysInvocation = { command: "message.delete", args: {}, count: 1, windowId: 1 };
    assert.deepEqual(JSON.parse(JSON.stringify(invocation)), invocation);
});
