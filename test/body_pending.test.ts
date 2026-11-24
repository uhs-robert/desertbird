import assert from "node:assert/strict";
import { test } from "node:test";
import { create_body_requests } from "../src/background/body_requests.ts";
import type { BodyRequestApi } from "../src/background/body_requests.ts";
import type { Registry } from "../vendor/desertfox/registry/define.ts";

function setup(extra: Partial<Parameters<typeof create_body_requests>[0]> = {}) {
    const calls: string[] = [];
    const handle = create_body_requests({
        registry: {} as Registry,
        api: {} as BodyRequestApi,
        allowed: new Set(),
        which_key: { on_body_pending: async (window_id, keys, source) => void calls.push(`${window_id} ${keys.join("")} ${source}`) },
        run: async () => {},
        ...extra,
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

test("an own page and a message window report name their tree, and nothing else does", async () => {
    const { calls, handle } = setup();
    await handle({ type: "body.pending", keys: ["g"], tree: "own" }, { tab: { windowId: 7 } });
    await handle({ type: "body.pending", keys: ["g"], tree: "window" }, { tab: { windowId: 7 } });
    await handle({ type: "body.pending", keys: ["g"], tree: "other" }, { tab: { windowId: 7 } });
    assert.deepEqual(calls, ["7 g own", "7 g window", "7 g message"]);
});

test("a mode report of the body script reaches the mode sink with the window of the sender, and a bad mode or a missing tab reaches nothing", async () => {
    const modes: string[] = [];
    const { handle } = setup({ on_mode: (event) => void modes.push(`${event.windowId} ${event.mode}`) });
    assert.deepEqual(await handle({ type: "body.mode", mode: "insert", windowId: 99 }, { tab: { id: 3, windowId: 7 } }), {});
    await handle({ type: "body.mode", mode: "normal" }, { tab: { id: 3, windowId: 7 } });
    assert.deepEqual(await handle({ type: "body.mode", mode: "insert" }, {}), {});
    assert.equal(handle({ type: "body.mode", mode: "visual" }, { tab: { windowId: 7 } }), undefined);
    assert.equal(handle({ type: "body.mode" }, { tab: { windowId: 7 } }), undefined);
    assert.deepEqual(modes, ["7 insert", "7 normal"]);
});

test("a message displayed in a tab ends the insert mode its body reported, and a message in another tab of the window does not", async () => {
    const modes: string[] = [];
    let displayed: (tab: { id?: number }) => void = () => {};
    const api = { messageDisplay: { getDisplayedMessages: async () => [], onMessageDisplayed: { addListener: (listener: typeof displayed) => void (displayed = listener) } } } as unknown as BodyRequestApi;
    const { handle } = setup({ api, on_mode: (event) => void modes.push(`${event.windowId} ${event.mode}`) });
    await handle({ type: "body.mode", mode: "insert" }, { tab: { id: 3, windowId: 7 } });
    displayed({ id: 4 });
    assert.deepEqual(modes, ["7 insert"], "another tab of the same window leaves the label alone");
    displayed({ id: 3 });
    displayed({ id: 3 });
    assert.deepEqual(modes, ["7 insert", "7 normal"], "one end, for the tab that reported");
    await handle({ type: "body.mode", mode: "insert" }, { tab: { id: 3, windowId: 7 } });
    await handle({ type: "body.mode", mode: "normal" }, { tab: { id: 3, windowId: 7 } });
    displayed({ id: 3 });
    assert.deepEqual(modes, ["7 insert", "7 normal", "7 insert", "7 normal"], "a body that ended it already leaves nothing to end");
});
