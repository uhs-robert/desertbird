import assert from "node:assert/strict";
import { test } from "node:test";
import { get_menukeys_api, shutdown } from "../src/chrome/parent_menukeys.ts";
import type { MenuEvent } from "../src/chrome/menu_keys.ts";
import { stub_platform } from "./chrome_stubs.ts";

type Listener = (event: MenuEvent) => void;

interface SentKey {
    type: string;
    key: string;
    keyCode: number;
}

// A popup that records the keys dispatched at it. `on_dispatch` lets a test act while the dispatch is under way.
function fake_node(local_name: string, options: { state?: string; ignorekeys?: boolean } = {}) {
    const sent: SentKey[] = [];
    const node = {
        localName: local_name,
        state: options.state ?? "open",
        isConnected: true,
        children: [] as unknown[],
        on_dispatch: (_event: SentKey) => {},
        getAttribute: (name: string) => (name === "ignorekeys" && options.ignorekeys ? "true" : null),
        contains(other: unknown) {
            return other === node || node.children.includes(other);
        },
        ownerDocument: {
            defaultView: {
                KeyboardEvent: class {
                    type: string;
                    key: string;
                    keyCode: number;
                    constructor(type: string, init: { key: string; keyCode: number }) {
                        this.type = type;
                        this.key = init.key;
                        this.keyCode = init.keyCode;
                    }
                },
            },
        } as { defaultView: { KeyboardEvent: new (type: string, init: object) => unknown } | null } | null,
        dispatchEvent(event: unknown) {
            sent.push({ ...(event as SentKey) });
            node.on_dispatch(event as SentKey);
            return true;
        },
    };
    return { node, sent };
}

// A chrome window: a root that holds the listeners, a focused element and a count of them for leak checks.
function fake_window() {
    const listeners = new Map<string, Set<Listener>>();
    const root = {
        addEventListener: (type: string, listener: Listener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
        removeEventListener: (type: string, listener: Listener) => void listeners.get(type)?.delete(listener),
    };
    const document = { activeElement: null as unknown };
    const fire = (type: string, event: Partial<MenuEvent>) => {
        const full = { type, taken: false, stopped: false, preventDefault() { this.taken = true; }, stopImmediatePropagation() { this.stopped = true; }, ...event } as MenuEvent & { taken: boolean; stopped: boolean };
        for (const listener of [...(listeners.get(type) ?? [])]) listener(full);
        return full;
    };
    return {
        window: { windowRoot: root, addEventListener: root.addEventListener, removeEventListener: root.removeEventListener, document },
        document,
        press: (key: string, extra: Partial<MenuEvent> = {}) => fire("keydown", { key, ...extra }),
        show: (popup: unknown) => fire("popupshown", { originalTarget: popup }),
        hide: (popup: unknown) => fire("popuphidden", { originalTarget: popup }),
        listener_count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    };
}

type FakeWindow = ReturnType<typeof fake_window>;

async function setup(open: FakeWindow[] = [fake_window()], keys: { key: string; direction: "down" | "up" }[] = [{ key: "j", direction: "down" }, { key: "k", direction: "up" }]) {
    const platform = stub_platform();
    const api = get_menukeys_api().menukeys;
    await api.install({ keys });
    const listener = () => platform.window_listeners.get("desertbird@uhs-robert/menukeys")!;
    for (const each of open) listener().onLoadWindow(each.window);
    return { api, platform, listener, done: () => (shutdown(), platform.restore()) };
}

const arrows = (sent: SentKey[]) => sent.map((each) => `${each.type} ${each.key}`);

test("j and k under an open menu send keydown and keyup of the arrow at the popup and take the key", async () => {
    const win = fake_window();
    const { done } = await setup([win]);
    try {
        const { node, sent } = fake_node("menupopup");
        win.show(node);
        const down = win.press("j");
        assert.deepEqual([down.taken, down.stopped], [true, true]);
        win.press("k");
        assert.deepEqual(arrows(sent), ["keydown ArrowDown", "keyup ArrowDown", "keydown ArrowUp", "keyup ArrowUp"]);
        assert.deepEqual(sent.slice(0, 1).map((each) => each.keyCode), [40]);
        assert.deepEqual(sent.slice(2, 3).map((each) => each.keyCode), [38]);
    } finally {
        done();
    }
});

test("the arrow does not re-enter the handler: a key that reaches the root while the arrow is sent is left alone", async () => {
    const win = fake_window();
    const { done } = await setup([win]);
    try {
        const { node, sent } = fake_node("menupopup");
        win.show(node);
        const nested: (MenuEvent & { taken: boolean })[] = [];
        // The arrow reaches the window root as a trusted key (measured). Here a j arrives in its place, which the handler would take if it did not know its own replay.
        node.on_dispatch = () => void nested.push(win.press("j") as never);
        win.press("j");
        assert.equal(sent.length, 2);
        assert.deepEqual(nested.map((each) => each.taken), [false, false]);
        // The flag ends with the dispatch.
        win.press("j");
        assert.equal(sent.length, 4);
    } finally {
        done();
    }
});

test("a popup that closes between the key and the dispatch does not throw and leaves the key alone", async () => {
    const win = fake_window();
    const { done } = await setup([win]);
    try {
        const closed = fake_node("menupopup");
        win.show(closed.node);
        closed.node.state = "closed";
        assert.equal(win.press("j").taken, false);
        const detached = fake_node("menupopup");
        win.show(detached.node);
        detached.node.isConnected = false;
        assert.equal(win.press("j").taken, false);
        const gone = fake_node("menupopup");
        win.show(gone.node);
        gone.node.ownerDocument = { defaultView: null };
        assert.equal(win.press("j").taken, false);
        win.hide(gone.node);
        assert.deepEqual([closed.sent, detached.sent, gone.sent], [[], [], []]);
    } finally {
        done();
    }
});

test("a nested submenu gets the arrow at the innermost open popup, and the parent gets it again once the submenu hides", async () => {
    const win = fake_window();
    const { done } = await setup([win]);
    try {
        const outer = fake_node("menupopup");
        const inner = fake_node("menupopup");
        win.show(outer.node);
        win.show(inner.node);
        win.press("j");
        assert.deepEqual([outer.sent.length, inner.sent.length], [0, 2]);
        win.hide(inner.node);
        win.press("j");
        assert.deepEqual([outer.sent.length, inner.sent.length], [2, 2]);
    } finally {
        done();
    }
});

test("a panel takes the arrow at the focused element inside it, and passes the key when the focus is outside or in a browser", async () => {
    const win = fake_window();
    const { done } = await setup([win]);
    try {
        const panel = fake_node("panel");
        const button = fake_node("toolbarbutton");
        const list = fake_node("tree");
        const popup_browser = fake_node("browser");
        panel.node.children.push(button.node, popup_browser.node);
        win.show(panel.node);
        win.document.activeElement = button.node;
        assert.equal(win.press("j").taken, true);
        assert.deepEqual([button.sent.length, panel.sent.length], [2, 0]);
        // A click-opened app menu leaves the focus in the list: the key is not taken.
        win.document.activeElement = list.node;
        assert.equal(win.press("j").taken, false);
        win.document.activeElement = null;
        assert.equal(win.press("j").taken, false);
        // An add-on's popup holds a browser that takes the key itself.
        win.document.activeElement = popup_browser.node;
        assert.equal(win.press("j").taken, false);
        assert.deepEqual([list.sent.length, popup_browser.sent.length], [0, 0]);
    } finally {
        done();
    }
});

test("keys outside the gate are left alone", async () => {
    const win = fake_window();
    const { done } = await setup([win]);
    try {
        const none = win.press("j");
        assert.equal(none.taken, false);
        const { node, sent } = fake_node("menupopup");
        win.show(node);
        for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) assert.equal(win.press("j", extra).taken, false, JSON.stringify(extra));
        assert.equal(win.press("x").taken, false);
        assert.equal(win.press("J").taken, false);
        const typing = fake_node("panel", { ignorekeys: true });
        win.show(typing.node);
        win.hide(node);
        assert.equal(win.press("j").taken, false);
        assert.equal(sent.length + typing.sent.length, 0);
        const tooltip = fake_node("tooltip");
        win.show(tooltip.node);
        assert.equal(win.press("j").taken, false);
    } finally {
        done();
    }
});

test("an autocomplete popup with ignorekeys does not hide the context menu under it", async () => {
    const win = fake_window();
    const { done } = await setup([win]);
    try {
        const menu = fake_node("menupopup");
        const complete = fake_node("panel", { ignorekeys: true });
        win.show(menu.node);
        win.show(complete.node);
        assert.equal(win.press("j").taken, true);
        assert.deepEqual([menu.sent.length, complete.sent.length], [2, 0]);
    } finally {
        done();
    }
});

test("a second install replaces the key table and adds no window listener and no key listener", async () => {
    const win = fake_window();
    const { api, platform, done } = await setup([win]);
    try {
        const { node, sent } = fake_node("menupopup");
        win.show(node);
        const before = win.listener_count();
        await api.install({ keys: [{ key: "n", direction: "up" }] });
        assert.equal(platform.register_calls, 1);
        assert.equal(win.listener_count(), before);
        assert.equal(win.press("j").taken, false);
        assert.equal(win.press("n").taken, true);
        assert.deepEqual(arrows(sent), ["keydown ArrowUp", "keyup ArrowUp"]);
    } finally {
        done();
    }
});

test("the window listener has no URL filter, hooks a window opened later and a dialog, and unhooks each on unload", async () => {
    const { listener, platform, done } = await setup([]);
    try {
        assert.equal(platform.register_calls, 1);
        assert.equal(Object.hasOwn(listener(), "chromeURLs"), false);
        const late = fake_window();
        const dialog = fake_window();
        listener().onLoadWindow(late.window);
        listener().onLoadWindow(dialog.window);
        const { node, sent } = fake_node("menupopup");
        dialog.show(node);
        assert.equal(dialog.press("k").taken, true);
        assert.deepEqual(arrows(sent), ["keydown ArrowUp", "keyup ArrowUp"]);
        // The window listener may report a window again.
        const count = late.listener_count();
        listener().onLoadWindow(late.window);
        assert.equal(late.listener_count(), count);
        listener().onUnloadWindow(late.window);
        listener().onUnloadWindow(dialog.window);
        assert.deepEqual([late.listener_count(), dialog.listener_count()], [0, 0]);
        assert.equal(dialog.press("k").taken, false);
    } finally {
        done();
    }
});

test("shutdown removes every listener from every window and the window listener, and a later key does nothing", async () => {
    const a = fake_window();
    const b = fake_window();
    const { platform, done } = await setup([a, b]);
    try {
        const { node, sent } = fake_node("menupopup");
        a.show(node);
        assert.deepEqual([a.listener_count(), b.listener_count()], [3, 3]);
        shutdown();
        assert.deepEqual([a.listener_count(), b.listener_count(), platform.window_listeners.size], [0, 0, 0]);
        assert.equal(a.press("j").taken, false);
        assert.equal(sent.length, 0);
        // An install after a shutdown starts clean, as after an update.
        await get_menukeys_api().menukeys.install({ keys: [{ key: "j", direction: "down" }] });
        assert.equal(platform.window_listeners.size, 1);
    } finally {
        done();
    }
});
