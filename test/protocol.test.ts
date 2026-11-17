import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPERIMENT_VERBS, type KeysInvocation } from "../src/shared/protocol.ts";

test("the Experiment exposes the fixed verb table", () => {
    assert.deepEqual(EXPERIMENT_VERBS.keys.functions, ["install"]);
    assert.deepEqual(EXPERIMENT_VERBS.overlay.functions, ["mount", "unmount"]);
    assert.deepEqual(Object.keys(EXPERIMENT_VERBS), ["keys", "overlay"]);
});

test("an invocation payload is plain data", () => {
    const invocation: KeysInvocation = { command: "msg.delete", args: {}, count: 1, windowId: 1, messageIds: [4, 5] };
    assert.deepEqual(JSON.parse(JSON.stringify(invocation)), invocation);
});
