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
    const link = { localName: "a", matches: (selector: string) => selector.includes("a[href]") };
    const window = { KeyboardEvent: class { key: string; constructor(_type: string, init: { key: string }) { this.key = init.key; } }, document: { activeElement: { id: "messagepane", contentDocument: { activeElement: link } } } };
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
        // The focus moved off the link: to the thread row, to a field of the message, or to a document that is not the message.
        for (const moved of [{ id: "threadTree", matches: () => false }, { id: "messagepane", contentDocument: { activeElement: { matches: () => false } } }, { id: "other", contentDocument: { activeElement: link } }]) {
            window.document.activeElement = moved as never;
            events.length = 0;
            await assert.rejects(sendEnter({ windowId: 7 }), /focus is not on a link/);
            assert.deepEqual(events, [], "no key is pressed");
        }
    } finally {
        delete globals["Cc"];
        delete globals["Ci"];
        platform.restore();
    }
});

test("hints.pick labels a mail tab, takes the keys on the window root ahead of the window, and ends with shutdown", async () => {
    const added: string[] = [];
    const listeners = (name: string) => ({ addEventListener: (type: string) => void added.push(`${name} ${type}`), removeEventListener: (type: string) => void added.push(`${name} -${type}`) });
    const label_host: unknown[] = [];
    const shown = { top: 10, left: 10, width: 20, height: 10 };
    const button = { getBoundingClientRect: () => shown, contains: () => true, focus() {}, click() {}, matches: () => false, closest: () => null };
    const make_document = (matching: unknown[]) => ({ querySelectorAll: (selector: string) => (selector.startsWith("button") ? matching : []), elementFromPoint: () => null, createElement: () => ({ style: {}, remove: () => label_host.push("removed"), append() {}, attachShadow: () => ({ append() {} }) }), documentElement: { append: (child: unknown) => label_host.push(child) } });
    const window_like = (matching: unknown[]) => ({ innerHeight: 600, innerWidth: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }), document: make_document(matching) });
    const pane = { ...window_like([button]), ...listeners("pane"), messageBrowser: { contentWindow: null } };
    const main = { ...window_like([]), ...listeners("main"), windowRoot: listeners("root"), matchMedia: () => ({ matches: true }), document: { ...make_document([]), hasFocus: () => true, getElementById: () => ({ currentTabInfo: { mode: { name: "mail3PaneTab" }, chromeBrowser: { contentWindow: pane } } }) } };
    (pane as Record<string, unknown>)["browsingContext"] = { topChromeWindow: main };
    const platform = stub_platform([main]);
    try {
        const { get_hints_api, shutdown } = await import("../src/chrome/parent_hints.ts");
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === main ? { id: 7 } : null) }, messageManager: { convert: () => null } } };
        const colors = { dark: { fill: "#000001", text: "#000002" }, light: { fill: "#000003", text: "#000004" } };
        assert.equal(await get_hints_api(context).hints.pick({ windowId: 7, colors }), 1);
        assert.ok(added.includes("root keydown"), "the keys go to the window root");
        assert.ok(!added.includes("main keydown"), "the window's own listeners, the key runtime's among them, never see them");
        assert.equal(label_host.length, 1, "one container in the document with the button");
        await assert.rejects(get_hints_api(context).hints.pick({ windowId: 8, colors }), StubExtensionError);
        shutdown();
        assert.ok(added.includes("root -keydown"), "a shutdown ends the labels and removes the listener");
    } finally {
        platform.restore();
    }
});
