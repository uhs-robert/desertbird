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

test("the body yank request writes its text through the clipboard writer, and an empty one or another shape writes nothing", async () => {
    const written: string[] = [];
    const handle = create_body_requests({ registry, api, allowed: new Set(), run: async () => {}, write_text: async (text) => void written.push(text) });
    await handle({ type: "body.yank", text: "https://example.org/x" }, { tab: { id: 5, windowId: 9 } });
    await handle({ type: "body.yank", text: "  " }, { tab: { id: 5, windowId: 9 } });
    assert.equal(handle({ type: "body.yank", text: 5 }, {}), undefined);
    assert.deepEqual(written, ["https://example.org/x"]);
});

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

test("the body hints request checks the action with the command's validator, names the sender's window and the message place, and answers -1 when it cannot ask", async () => {
    const asked: unknown[] = [];
    const hints = { sendEnter: async () => {}, pick: async (args: unknown) => (asked.push(args), 4) };
    const handle = create_body_requests({ registry, api, allowed: new Set(), run: async () => {}, hints });
    assert.equal(await handle({ type: "body.hints", windowId: 99 }, { tab: { id: 5, windowId: 9 } }), 4);
    assert.equal(await handle({ type: "body.hints", action: "yank" }, { tab: { id: 5, windowId: 9 } }), 4);
    assert.deepEqual(asked, [{ windowId: 9, tabId: 5, action: "activate", place: "message" }, { windowId: 9, tabId: 5, action: "yank", place: "message" }], "the default action comes from the params, and the window and tab from the sender");
    assert.equal(await handle({ type: "body.hints", action: "run" }, { tab: { id: 5, windowId: 9 } }), -1, "an action outside the enum asks nothing");
    assert.equal(await handle({ type: "body.hints" }, {}), -1, "a sender with no window asks nothing");
    assert.equal(await handle({ type: "body.hints" }, { tab: { windowId: 9 } }), -1, "a sender with no tab asks nothing");
    assert.equal(asked.length, 2);
    const without = create_body_requests({ registry, api, allowed: new Set(), run: async () => {} });
    assert.equal(await without({ type: "body.hints" }, { tab: { id: 5, windowId: 9 } }), -1, "no hints Experiment: the body labels itself");
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
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === window ? { id: 7 } : null) }, messageManager: { convert: () => null }, tabManager: { getWrapper: () => null } } };
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
    const make_document = (matching: unknown[]) => ({ querySelectorAll: (selector: string) => (selector.startsWith("button") ? matching : []), elementFromPoint: () => null, createElement: () => ({ style: {}, remove: () => label_host.push("removed"), append() {}, attachShadow: () => ({ append() {} }) }), documentElement: { append: (child: unknown) => label_host.push(child), setAttribute() {}, removeAttribute() {} } });
    const window_like = (matching: unknown[]) => ({ innerHeight: 600, innerWidth: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }), document: make_document(matching) });
    const pane = { ...window_like([button]), ...listeners("pane"), messageBrowser: { contentWindow: null } };
    const main = { ...window_like([]), ...listeners("main"), windowRoot: listeners("root"), matchMedia: () => ({ matches: true }), document: { ...make_document([]), hasFocus: () => true, getElementById: () => ({ currentTabInfo: { mode: { name: "mail3PaneTab" }, chromeBrowser: { contentWindow: pane } } }) } };
    (pane as Record<string, unknown>)["browsingContext"] = { topChromeWindow: main };
    const platform = stub_platform([main]);
    try {
        const { get_hints_api, shutdown } = await import("../src/chrome/parent_hints.ts");
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === main ? { id: 7 } : null) }, messageManager: { convert: () => null }, tabManager: { getWrapper: () => null } } };
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

test("hints.pick in a page tab labels the window and the tab's own page, and marks the window root while the labels show", async () => {
    const added: string[] = [];
    const listeners = (name: string) => ({ addEventListener: (type: string) => void added.push(`${name} ${type}`), removeEventListener: (type: string) => void added.push(`${name} -${type}`) });
    const drawn_in: string[] = [];
    const marks = new Set<string>();
    const shown = { top: 10, left: 10, width: 20, height: 10 };
    // The page scan walks every element and keeps the ones that match, so this control matches the page selector and no field one.
    const control = { getBoundingClientRect: () => shown, contains: () => true, focus() {}, click() {}, matches: (selector: string) => selector.startsWith("button"), closest: () => null };
    const make_document = (name: string, matching: unknown[]) => ({ querySelectorAll: () => matching, elementFromPoint: () => null, createElement: () => ({ style: {}, remove() {}, append() {}, attachShadow: () => ({ append() {} }) }), documentElement: { append: () => void drawn_in.push(name), setAttribute: (attribute: string) => void marks.add(attribute), removeAttribute: (attribute: string) => void marks.delete(attribute) } });
    const window_like = (name: string, matching: unknown[]) => ({ innerHeight: 600, innerWidth: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }), document: make_document(name, matching), ...listeners(name) });
    const page = window_like("page", [control, control]);
    const tab: Record<string, unknown> = { mode: { name: "preferencesTab" }, browser: { contentDocument: page.document, contentWindow: page } };
    const main = { ...window_like("main", [control]), windowRoot: listeners("root"), matchMedia: () => ({ matches: false }), document: { ...make_document("main", [control]), hasFocus: () => true, getElementById: () => ({ currentTabInfo: tab }) } };
    const message_window = { ...window_like("message window", []), matchMedia: () => ({ matches: false }), document: { ...make_document("message window", []), hasFocus: () => true, getElementById: () => null } };
    const platform = stub_platform([main, message_window]);
    try {
        const { get_hints_api, shutdown } = await import("../src/chrome/parent_hints.ts");
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === main ? { id: 7 } : candidate === message_window ? { id: 9 } : null) }, messageManager: { convert: () => null }, tabManager: { getWrapper: () => null } } };
        const colors = { dark: { fill: "#000001", text: "#000002" }, light: { fill: "#000003", text: "#000004" } };
        const { pick } = get_hints_api(context).hints;
        assert.equal(await pick({ windowId: 7, colors }), 3);
        assert.deepEqual(drawn_in, ["main", "page"]);
        assert.ok(added.includes("root keydown") && added.includes("page scroll"), "the keys come from the window root and a scroll of the page ends the labels");
        assert.deepEqual([...marks], ["data-desertbird-hints"], "the page keys see the marker and leave the keys to the labels");
        shutdown();
        assert.deepEqual([...marks], [], "the end of the labels removes the marker");
        // A remote page: the parent cannot read its document, so only the window is labelled.
        tab["browser"] = { isRemoteBrowser: true, contentDocument: null, contentWindow: page };
        drawn_in.length = 0;
        assert.equal(await pick({ windowId: 7, colors }), 1);
        assert.deepEqual(drawn_in, ["main"]);
        shutdown();
        // A remote page with the page actor on: its child labels the page, and the parent draws nothing and holds no key.
        const queries: [string, unknown][] = [];
        let answer: Promise<unknown> = Promise.resolve(4);
        const actor = { on: true, sendQuery: (name: string, data: unknown) => (queries.push([name, data]), answer) };
        let focused = 0;
        tab["browser"] = { isRemoteBrowser: true, contentDocument: null, focus: () => void focused++, browsingContext: { currentWindowGlobal: { getExistingActor: (name: string) => (name === "DesertBirdPage" ? actor : undefined) } } };
        drawn_in.length = 0;
        added.length = 0;
        assert.equal(await pick({ windowId: 7, colors, action: "yank" }), 4);
        assert.deepEqual(queries, [["DesertBird:Hints", { scheme: colors.dark, action: "yank" }]], "only the colors and the action cross");
        assert.equal(focused, 1, "the page gets the focus, so its child reads the label keys");
        assert.deepEqual(drawn_in, []);
        assert.deepEqual(added, []);
        // The tab closed or its page went before the child answered.
        answer = Promise.reject(new Error("Actor 'DesertBirdPage' destroyed before query 'DesertBird:Hints' was resolved"));
        assert.equal(await pick({ windowId: 7, colors }), 0);
        // An actor that is off (the add-on's own page, a stopped actor) leaves the old path: the window's own controls.
        actor.on = false;
        assert.equal(await pick({ windowId: 7, colors }), 1);
        assert.deepEqual(drawn_in, ["main"]);
        shutdown();
        await assert.rejects(pick({ windowId: 9, colors }), /no tab in window 9/, "a message window with no about:message has nothing to label");
    } finally {
        platform.restore();
    }
});

// The reading pane or a message tab with the focus in the body: the main window holds the about:message browser, which holds `#messagepane`, which holds the mail.
function message_setup() {
    const heard = new Map<string, (event?: unknown) => void>();
    const added: string[] = [];
    const listeners = (name: string) => ({
        addEventListener: (type: string, listener: (event?: unknown) => void) => (added.push(`${name} ${type}`), heard.set(`${name} ${type}`, listener)),
        removeEventListener: (type: string) => (added.push(`${name} -${type}`), heard.delete(`${name} ${type}`)),
    });
    const drawn_in: string[] = [];
    const removed: string[] = [];
    const shown = { top: 10, left: 10, width: 20, height: 10 };
    const log: string[] = [];
    const element = (name: string, openable: boolean) => ({ name, isConnected: true, getBoundingClientRect: () => shown, contains: () => true, focus: () => void log.push(`focus ${name}`), click: () => void log.push(`click ${name}`), matches: (selector: string) => openable && selector === "a[href], button", closest: () => null });
    const make_document = (name: string, matching: unknown[]) => ({ querySelectorAll: () => matching, elementFromPoint: () => null, createElement: () => ({ style: {}, remove: () => void removed.push(name), append() {}, attachShadow: () => ({ append() {} }) }), documentElement: { append: () => void drawn_in.push(name), setAttribute() {}, removeAttribute() {} } });
    const window_like = (name: string, matching: unknown[]) => ({ innerHeight: 600, innerWidth: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }), document: make_document(name, matching), ...listeners(name) });
    const reply = element("reply", false);
    const link = element("link", true);
    const messagepane: Record<string, unknown> = { id: "messagepane", contentDocument: { activeElement: link } };
    const message_like = window_like("message", [reply]);
    const message = { ...message_like, document: { ...message_like.document, getElementById: (id: string) => (id === "messagepane" ? messagepane : null) } };
    const body = window_like("body", [link]);
    Object.assign(messagepane, { contentWindow: body, ownerDocument: { defaultView: message } });
    const message_browser = { id: "messageBrowser", contentDocument: { activeElement: messagepane } };
    const queued: (() => void)[] = [];
    let has_focus = true;
    const tab: { mode: { name: string }; chromeBrowser?: unknown } = { mode: { name: "mail3PaneTab" } };
    const main = { ...window_like("main", []), windowRoot: listeners("root"), matchMedia: () => ({ matches: true }), setTimeout: (callback: () => void) => void queued.push(callback), KeyboardEvent: class { key: string; constructor(_type: string, init: { key: string }) { this.key = init.key; } }, document: { ...make_document("main", []), activeElement: message_browser as unknown, hasFocus: () => has_focus, getElementById: () => ({ currentTabInfo: tab }) } };
    // A message window has no tabmail. Its about:message sits in `messageBrowser`, and the focus goes down through it to the body.
    const message_window = { ...window_like("message window", []), windowRoot: listeners("window root"), matchMedia: () => ({ matches: true }), setTimeout: (callback: () => void) => void queued.push(callback), KeyboardEvent: main.KeyboardEvent, messageBrowser: { contentWindow: message }, document: { ...make_document("message window", []), activeElement: message_browser as unknown, hasFocus: () => true, getElementById: () => null } };
    return { heard, added, drawn_in, removed, log, reply, link, message, messagepane, main, message_window, queued, tab, set_focus: (value: boolean) => void (has_focus = value) };
}

test("hints.pick at the message labels the header and the body in one set, and the Enter of a body link waits for the end of the key and for the focus", async () => {
    const setup = message_setup();
    const events: string[] = [];
    const platform = stub_platform([setup.main, setup.message_window]);
    const globals = globalThis as Record<string, unknown>;
    globals["Cc"] = { "@mozilla.org/text-input-processor;1": { createInstance: () => ({ beginInputTransactionForTests: () => true, keydown: (event: { key: string }) => events.push(`down ${event.key}`), keyup() {} }) } };
    globals["Ci"] = { nsITextInputProcessor: {} };
    try {
        const { get_hints_api, shutdown } = await import("../src/chrome/parent_hints.ts");
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === setup.main ? { id: 7 } : candidate === setup.message_window ? { id: 9 } : null) }, messageManager: { convert: () => null }, tabManager: { getWrapper: (candidate: unknown) => (candidate === setup.tab ? { id: 5 } : null) } } };
        const colors = { dark: { fill: "#000001", text: "#000002" }, light: { fill: "#000003", text: "#000004" } };
        const { pick } = get_hints_api(context).hints;
        assert.equal(await pick({ windowId: 7, tabId: 5, colors, place: "message" }), 2);
        assert.deepEqual(setup.drawn_in, ["message", "body"], "the header labels sit in about:message and the link label in the mail");
        for (const heard of ["root keydown", "message MsgLoading", "body scroll", "body pointerdown", "message scroll", "main TabSelect"]) assert.ok(setup.added.includes(heard), heard);
        // The link has the second label. The pick focuses it at once and queues the Enter out of the key's own handling.
        const press = (key: string) => setup.heard.get("root keydown")!({ key, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} } as never);
        press("s");
        assert.deepEqual(setup.log, ["focus link"]);
        assert.deepEqual(events, [], "no Enter inside the key");
        setup.queued.shift()!();
        assert.deepEqual(events, ["down Enter"]);
        // The focus left the link before the queued Enter ran: no key.
        await pick({ windowId: 7, tabId: 5, colors, place: "message" });
        press("s");
        setup.messagepane["contentDocument"] = { activeElement: { matches: () => false } };
        setup.queued.shift()!();
        assert.deepEqual(events, ["down Enter"], "the Enter goes only where the pick put the focus");
        // The focus moved to another link of the mail: no key either, the Enter belongs to the picked link.
        await pick({ windowId: 7, tabId: 5, colors, place: "message" });
        press("s");
        setup.messagepane["contentDocument"] = { activeElement: { matches: (selector: string) => selector === "a[href], button" } };
        setup.queued.shift()!();
        assert.deepEqual(events, ["down Enter"], "the Enter goes only to the picked link");
        setup.messagepane["contentDocument"] = { activeElement: setup.link };
        // A header control is clicked.
        await pick({ windowId: 7, tabId: 5, colors, place: "message" });
        press("a");
        assert.deepEqual(setup.log.at(-1), "click reply");
        shutdown();
    } finally {
        delete globals["Cc"];
        delete globals["Ci"];
        platform.restore();
    }
});

test("hints.pick at the message removes every listener it added on each way it ends, and a window blur ends it only when the window lost the focus", async () => {
    const setup = message_setup();
    const platform = stub_platform([setup.main]);
    try {
        const { get_hints_api, shutdown } = await import("../src/chrome/parent_hints.ts");
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === setup.main ? { id: 7 } : null) }, messageManager: { convert: () => null }, tabManager: { getWrapper: (candidate: unknown) => (candidate === setup.tab ? { id: 5 } : null) } } };
        const colors = { dark: { fill: "#000001", text: "#000002" }, light: { fill: "#000003", text: "#000004" } };
        const { pick } = get_hints_api(context).hints;
        // Counts each listener's adds against its removes, so a listener added twice or left behind shows.
        const live = () => {
            const balance = new Map<string, number>();
            for (const entry of setup.added) balance.set(entry.replace(" -", " "), (balance.get(entry.replace(" -", " ")) ?? 0) + (entry.includes(" -") ? -1 : 1));
            return [...balance].filter(([, count]) => count !== 0).map(([key, count]) => `${key} ${count}`).sort();
        };
        const one_set = ["root keydown", "main scroll", "message scroll", "body scroll", "main pointerdown", "message pointerdown", "body pointerdown", "main blur", "main TabSelect", "message MsgLoading"].map((key) => `${key} 1`).sort();
        const press = (key: string) => setup.heard.get("root keydown")!({ key, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} } as never);
        const ends: [string, () => void][] = [
            ["another message loading", () => setup.heard.get("message MsgLoading")!()],
            ["a tab switch", () => setup.heard.get("main TabSelect")!()],
            ["a scroll of the body", () => setup.heard.get("body scroll")!()],
            ["a click in the header", () => setup.heard.get("message pointerdown")!()],
            ["a typed label", () => press("a")],
            ["Escape", () => press("Escape")],
            ["a window that lost the focus", () => (setup.set_focus(false), setup.heard.get("main blur")!(), setup.set_focus(true))],
        ];
        for (const [name, end] of ends) {
            await pick({ windowId: 7, tabId: 5, colors, place: "message" });
            assert.deepEqual(live(), one_set, name);
            end();
            assert.deepEqual([...new Set(setup.removed)].sort(), ["body", "message"], name);
            assert.deepEqual(live(), [], name);
            setup.removed.length = 0;
        }
        await pick({ windowId: 7, tabId: 5, colors, place: "message" });
        setup.heard.get("main blur")!();
        assert.deepEqual(setup.removed, [], "a blur inside the window (the chrome took the focus) keeps the labels");
        // Two tabs: the second pick ends the first one's labels and listeners.
        await pick({ windowId: 7, tabId: 5, colors, place: "message" });
        assert.deepEqual(setup.removed, ["message", "body"]);
        assert.deepEqual(live(), one_set, "a second pick");
        shutdown();
        assert.deepEqual(live(), [], "shutdown");
    } finally {
        platform.restore();
    }
});

test("hints.pick at the message answers 0 when the focus left the body or its tab left the front, and -1 for a body the parent cannot read", async () => {
    const setup = message_setup();
    const platform = stub_platform([setup.main, setup.message_window]);
    try {
        const { get_hints_api } = await import("../src/chrome/parent_hints.ts");
        const context = { extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === setup.main ? { id: 7 } : candidate === setup.message_window ? { id: 9 } : null) }, messageManager: { convert: () => null }, tabManager: { getWrapper: (candidate: unknown) => (candidate === setup.tab ? { id: 5 } : null) } } };
        const colors = { dark: { fill: "#000001", text: "#000002" }, light: { fill: "#000003", text: "#000004" } };
        const { pick } = get_hints_api(context).hints;
        const focus_before = setup.main.document.activeElement;
        setup.main.document.activeElement = { id: "threadTree" };
        assert.equal(await pick({ windowId: 7, tabId: 5, colors, place: "message" }), 0);
        setup.main.document.activeElement = focus_before;
        assert.equal(await pick({ windowId: 7, tabId: 6, colors, place: "message" }), 0, "the body that asked is in another tab than the one shown now");
        setup.messagepane["isRemoteBrowser"] = true;
        assert.equal(await pick({ windowId: 7, tabId: 5, colors, place: "message" }), -1, "a remote body");
        setup.messagepane["isRemoteBrowser"] = false;
        setup.messagepane["contentDocument"] = null;
        assert.equal(await pick({ windowId: 7, tabId: 5, colors, place: "message" }), -1, "a body with no document the parent can read");
        assert.equal(await pick({ windowId: 9, tabId: 5, colors, place: "message" }), -1, "a remote body in a message window");
        assert.deepEqual(setup.drawn_in, []);
        setup.message_window.document.activeElement = { id: "other" };
        assert.equal(await pick({ windowId: 9, colors, place: "message" }), 0, "the focus left the body of a message window");
    } finally {
        platform.restore();
    }
});

const message_context = (setup: ReturnType<typeof message_setup>) => ({ extension: { windowManager: { getWrapper: (candidate: unknown) => (candidate === setup.main ? { id: 7 } : candidate === setup.message_window ? { id: 9 } : null) }, messageManager: { convert: () => null }, tabManager: { getWrapper: (candidate: unknown) => (candidate === setup.tab ? { id: 5 } : null) } } });
const message_colors = { dark: { fill: "#000001", text: "#000002" }, light: { fill: "#000003", text: "#000004" } };

test("hints.pick with no place in a message tab labels its header and body in one set, and only the header of a body the parent cannot read", async () => {
    const setup = message_setup();
    // The focus sits in the header, outside the body: the header keys send hint.window, which names no place.
    setup.main.document.activeElement = { id: "messageBrowser", contentDocument: { activeElement: setup.reply } };
    Object.assign(setup.tab, { mode: { name: "mailMessageTab" }, chromeBrowser: { contentWindow: setup.message } });
    const platform = stub_platform([setup.main]);
    try {
        const { get_hints_api, shutdown } = await import("../src/chrome/parent_hints.ts");
        const { pick } = get_hints_api(message_context(setup)).hints;
        assert.equal(await pick({ windowId: 7, colors: message_colors, action: "focus" }), 2);
        assert.deepEqual(setup.drawn_in, ["message", "body"]);
        for (const heard of ["root keydown", "message MsgLoading", "body scroll", "main TabSelect"]) assert.ok(setup.added.includes(heard), heard);
        shutdown();
        for (const unreadable of [{ isRemoteBrowser: true }, { isRemoteBrowser: false, contentDocument: null }]) {
            Object.assign(setup.messagepane, unreadable);
            setup.drawn_in.length = 0;
            setup.added.length = 0;
            assert.equal(await pick({ windowId: 7, colors: message_colors }), 1, JSON.stringify(unreadable));
            assert.deepEqual(setup.drawn_in, ["message"], "the header alone");
            assert.ok(!setup.added.includes("body scroll"));
            shutdown();
        }
    } finally {
        platform.restore();
    }
});

test("hints.pick in a message window labels the header and the body from the body and from no place, and the Enter of a body link goes to that window", async () => {
    const setup = message_setup();
    const events: string[] = [];
    const platform = stub_platform([setup.main, setup.message_window]);
    const globals = globalThis as Record<string, unknown>;
    globals["Cc"] = { "@mozilla.org/text-input-processor;1": { createInstance: () => ({ beginInputTransactionForTests: (window: unknown) => window === setup.message_window, keydown: (event: { key: string }) => events.push(`down ${event.key}`), keyup() {} }) } };
    globals["Ci"] = { nsITextInputProcessor: {} };
    try {
        const { get_hints_api, shutdown } = await import("../src/chrome/parent_hints.ts");
        const { pick } = get_hints_api(message_context(setup)).hints;
        // The window has no tab the tab manager knows, so the tab check is skipped.
        assert.equal(await pick({ windowId: 9, tabId: 12, colors: message_colors, place: "message" }), 2);
        assert.deepEqual(setup.drawn_in, ["message", "body"]);
        for (const heard of ["window root keydown", "message MsgLoading", "body scroll", "message window blur"]) assert.ok(setup.added.includes(heard), heard);
        assert.ok(!setup.added.includes("root keydown"), "the main window keeps its keys");
        setup.heard.get("window root keydown")!({ key: "s", ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} } as never);
        assert.deepEqual(setup.log, ["focus link"]);
        setup.queued.shift()!();
        assert.deepEqual(events, ["down Enter"], "the Enter goes to the message window");
        setup.drawn_in.length = 0;
        assert.equal(await pick({ windowId: 9, colors: message_colors }), 2, "no place: the same set");
        assert.deepEqual(setup.drawn_in, ["message", "body"]);
        // A pick in the main window ends the labels left up in the message window.
        setup.removed.length = 0;
        await pick({ windowId: 7, tabId: 5, colors: message_colors, place: "message" });
        assert.deepEqual(setup.removed, ["message", "body"]);
        assert.ok(setup.added.includes("window root -keydown"));
        shutdown();
    } finally {
        delete globals["Cc"];
        delete globals["Ci"];
        platform.restore();
    }
});
