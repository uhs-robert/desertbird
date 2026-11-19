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
        which_key: { on_body_pending: async (window_id, keys, source) => void calls.push(`${window_id} ${keys.join("")} ${source}`) },
        run: async () => {},
    });
    return { calls, handle };
}

test("the window of a pending report comes from the sender", async () => {
    const { calls, handle } = setup();
    assert.deepEqual(await handle({ type: "body.pending", keys: ["g"], windowId: 99 }, { tab: { id: 3, windowId: 7 } }), {});
    assert.deepEqual(calls, ["7 g message"]);
});

test("a pending report with no tab, or with keys that are not strings, reaches nothing", async () => {
    const { calls, handle } = setup();
    assert.deepEqual(await handle({ type: "body.pending", keys: ["g"] }, {}), {});
    assert.equal(handle({ type: "body.pending", keys: [1] }, { tab: { windowId: 7 } }), undefined);
    assert.equal(handle({ type: "body.pending" }, { tab: { windowId: 7 } }), undefined);
    assert.deepEqual(calls, []);
});

test("an own page report names its tree, and nothing else does", async () => {
    const { calls, handle } = setup();
    await handle({ type: "body.pending", keys: ["g"], tree: "own" }, { tab: { windowId: 7 } });
    await handle({ type: "body.pending", keys: ["g"], tree: "other" }, { tab: { windowId: 7 } });
    assert.deepEqual(calls, ["7 g own", "7 g message"]);
});
