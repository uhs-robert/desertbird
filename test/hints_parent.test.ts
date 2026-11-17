import assert from "node:assert/strict";
import { test } from "node:test";
import { create_body_requests } from "../src/background/body_requests.ts";
import type { BodyRequestApi } from "../src/background/body_requests.ts";
import { registry } from "../src/background/commands/index.ts";
import { stub_platform, StubExtensionError } from "./chrome_stubs.ts";

const api: BodyRequestApi = {
    messageDisplay: { getDisplayedMessages: async () => [] },
    windows: { get: async () => ({ type: "normal" }) },
    notifications: { create: async () => "n1" },
};

test("the body open_link request presses Enter in the window of the sender and in no other", async () => {
    const sent: unknown[] = [];
    const handle = create_body_requests({ registry, api, allowed: new Set(), run: async () => {}, hints: { sendEnter: async (args) => void sent.push(args) } });
    await handle({ type: "body.open_link", windowId: 99 }, { tab: { id: 5, windowId: 9 } });
    assert.deepEqual(sent, [{ windowId: 9 }]);
    await handle({ type: "body.open_link" }, {});
    assert.equal(sent.length, 1, "a sender with no window gets no key press");
});

test("the request does nothing when the hints Experiment is not loaded", async () => {
    const handle = create_body_requests({ registry, api, allowed: new Set(), run: async () => {} });
    assert.deepEqual(await handle({ type: "body.open_link" }, { tab: { id: 5, windowId: 9 } }), {});
});

test("hints.sendEnter presses Enter through the text input processor in the named window", async () => {
    const events: string[] = [];
    const window = { KeyboardEvent: class { key: string; constructor(_type: string, init: { key: string }) { this.key = init.key; } } };
    const platform = stub_platform([window]);
    const globals = globalThis as Record<string, unknown>;
    globals["Cc"] = { "@mozilla.org/text-input-processor;1": { createInstance: () => ({ beginInputTransactionForTests: () => true, keydown: (event: { key: string }) => events.push(`down ${event.key}`), keyup: (event: { key: string }) => events.push(`up ${event.key}`) }) } };
    globals["Ci"] = { nsITextInputProcessor: {} };
    try {
        const { get_hints_api } = await import("../src/chrome/parent_hints.ts");
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === window ? { id: 7 } : null) }, messageManager: { convert: () => null } } };
        const { sendEnter } = get_hints_api(context).hints;
        await sendEnter({ windowId: 7 });
        assert.deepEqual(events, ["down Enter", "up Enter"]);
        await assert.rejects(sendEnter({ windowId: 8 }), StubExtensionError);
    } finally {
        delete globals["Cc"];
        delete globals["Ci"];
        platform.restore();
    }
});
