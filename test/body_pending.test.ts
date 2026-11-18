import assert from "node:assert/strict";
import { test } from "node:test";
import { create_body_requests } from "../src/background/body_requests.ts";
import type { BodyRequestApi } from "../src/background/body_requests.ts";
import type { Registry } from "../vendor/desertfox/registry/define.ts";

function setup() {
    const calls: string[] = [];
    const handle = create_body_requests({
        registry: {} as Registry,
        api: {} as BodyRequestApi,
        allowed: new Set(),
        which_key: { on_body_pending: async (window_id, keys) => void calls.push(`${window_id} ${keys.join("")}`) },
        run: async () => {},
    });
    return { calls, handle };
}

test("the window of a pending report comes from the sender", async () => {
    const { calls, handle } = setup();
    assert.deepEqual(await handle({ type: "body.pending", keys: ["g"], windowId: 99 }, { tab: { id: 3, windowId: 7 } }), {});
    assert.deepEqual(calls, ["7 g"]);
});

test("a pending report with no tab, or with keys that are not strings, reaches nothing", async () => {
    const { calls, handle } = setup();
    assert.deepEqual(await handle({ type: "body.pending", keys: ["g"] }, {}), {});
    assert.equal(handle({ type: "body.pending", keys: [1] }, { tab: { windowId: 7 } }), undefined);
    assert.equal(handle({ type: "body.pending" }, { tab: { windowId: 7 } }), undefined);
    assert.deepEqual(calls, []);
});
