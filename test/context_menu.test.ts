import assert from "node:assert/strict";
import { test } from "node:test";
import { get_context_api, shutdown } from "../src/chrome/parent_context.ts";
import { stub_platform } from "./chrome_stubs.ts";

interface Fake {
    events: { type: string; init: Record<string, number | boolean | object> }[];
    sent: string[];
    registered: string[];
    unregistered: string[];
    roots: (string | null)[];
}

const BOX = { x: 100, y: 200, width: 600, height: 30 };

// A chrome window view with one thread tree, one folder tree and a system document, as about:3pane is.
function setup(opts: { windows?: Record<string, unknown[]> } = {}) {
    const platform = stub_platform();
    const fake: Fake = { events: [], sent: [], registered: [], unregistered: [], roots: [] };
    const globals = globalThis as unknown as { ChromeUtils: Record<string, unknown>; Services: { wm: { getEnumerator(type: string): unknown[] }; io: { getProtocolHandler(): unknown } } };
    globals.ChromeUtils.registerWindowActor = (name: string, options: { child: { esModuleURI: string } }) => {
        assert.match(options.child.esModuleURI, /^resource:\/\/desertbird-context-\d+\/experiment\/context_actor_child\.sys\.mjs$/);
        assert.equal((options as Record<string, unknown>)["matches"], undefined);
        fake.registered.push(name);
    };
    globals.ChromeUtils.unregisterWindowActor = (name: string) => void fake.unregistered.push(name);
    globals.Services.io.getProtocolHandler = () => ({ QueryInterface: () => ({ setSubstitution: (root: string, uri: unknown) => void fake.roots.push(uri === null ? null : root) }) });
    const by_type = opts.windows ?? {};
    globals.Services.wm.getEnumerator = (type: string) => by_type[type] ?? [];
    class MouseEvent {
        type: string;
        init: Record<string, number | boolean | object>;
        constructor(type: string, init: Record<string, number | boolean | object>) {
            this.type = type;
            this.init = init;
        }
    }
    const view: Record<string, unknown> = { mozInnerScreenX: 10, mozInnerScreenY: 50, MouseEvent, browsingContext: { currentWindowGlobal: { documentPrincipal: { isSystemPrincipal: true } } } };
    const element = (local = "div") => {
        const node: Record<string, unknown> = { localName: local, ownerDocument: { defaultView: view }, getBoundingClientRect: () => BOX, dispatchEvent: (event: Fake["events"][number]) => (fake.events.push(event), true), contains: (other: unknown) => other === node };
        return node;
    };
    // The module keeps its registration between tests, as an add-on scope does until it shuts down.
    shutdown();
    fake.unregistered.length = 0;
    fake.roots.length = 0;
    return { platform, fake, view, element, windows: by_type };
}

const api_for = (windows: unknown[]) => get_context_api({ extension: { rootURI: "file:///addon/", windowManager: { getWrapper: (window: unknown) => ({ id: windows.indexOf(window) + 1 }) } } } as never).context;
const window_focusing = (...chain: unknown[]) => {
    const [first, ...rest] = chain as Record<string, unknown>[];
    // Each next node sits in the contentDocument of the one before, as focus_chain walks it.
    chain.forEach((node, index) => {
        const next = rest[index];
        if (next) (node as Record<string, unknown>)["contentDocument"] = { activeElement: next };
    });
    return { document: { activeElement: first ?? null } };
};

test("a thread list opens its menu as a right-click on the cursor row, at the row's screen point", async () => {
    const t = setup();
    const row = t.element("tr");
    const body = t.element("tbody");
    t.view["threadTree"] = { currentIndex: 4, table: { body }, getRowAtIndex: (index: number) => (index === 4 ? row : null) };
    const window = window_focusing(t.element("browser"), body);
    const windows = [window];
    t.windows["mail:3pane"] = windows;
    assert.equal(await api_for(windows).open({ windowId: 1 }), true);
    assert.equal(t.fake.events.length, 1);
    assert.equal(t.fake.events[0]!.type, "contextmenu");
    assert.deepEqual(t.fake.events[0]!.init, { bubbles: true, cancelable: true, view: t.view, button: 2, clientX: 120, clientY: 210, screenX: 130, screenY: 260 });
    assert.deepEqual(t.fake.registered, [], "a chrome target never registers the actor");
    t.platform.restore();
});

test("an empty thread list does nothing and does not throw", async () => {
    const t = setup();
    const body = t.element("tbody");
    t.view["threadTree"] = { currentIndex: -1, table: { body }, getRowAtIndex: () => null };
    const windows = [window_focusing(t.element("browser"), body)];
    t.windows["mail:3pane"] = windows;
    assert.equal(await api_for(windows).open({ windowId: 1 }), false);
    assert.deepEqual(t.fake.events, []);
    t.platform.restore();
});

test("the folder pane opens its menu on the selected row, and does nothing with no row", async () => {
    const t = setup();
    const row = t.element("li");
    const tree = t.element("ul");
    t.view["folderTree"] = Object.assign(tree, { selectedRow: row });
    const windows = [window_focusing(t.element("browser"), tree)];
    t.windows["mail:3pane"] = windows;
    assert.equal(await api_for(windows).open({ windowId: 1 }), true);
    assert.equal(t.fake.events[0]!.init["button"], 2);
    (tree as Record<string, unknown>)["selectedRow"] = null;
    assert.equal(await api_for(windows).open({ windowId: 1 }), false);
    assert.equal(t.fake.events.length, 1);
    t.platform.restore();
});

test("a header field of a message window and a field of a compose window take a plain event on the focused element", async () => {
    for (const type of ["mail:messageWindow", "msgcompose"]) {
        const t = setup();
        const field = t.element("li");
        const windows = [window_focusing(t.element("browser"), field)];
        t.windows[type] = windows;
        assert.equal(await api_for(windows).open({ windowId: 1 }), true, type);
        assert.deepEqual(t.fake.events.map((event) => event.init["button"]), [0], type);
        assert.equal(t.fake.events[0]!.init["screenX"], 10 + 120, type);
        t.platform.restore();
    }
});

// A content document: its element sits in a browsing context whose global holds a non-system principal. The actor is the only way in.
function content_window(t: ReturnType<typeof setup>, remote: boolean) {
    const sent = t.fake.sent;
    const global = { documentPrincipal: { isSystemPrincipal: false }, getActor: (name: string) => ({ sendAsyncMessage: (message: string) => void sent.push(`${name} ${message}`) }) };
    const content_view = { browsingContext: { currentWindowGlobal: global } };
    const browser = Object.assign(t.element("browser"), { browsingContext: { currentWindowGlobal: global } });
    if (remote) return window_focusing(browser);
    const inner = { ...t.element("body"), ownerDocument: { defaultView: content_view } };
    return window_focusing(t.element("browser"), inner);
}

test("a message body, a compose body and a page tab ask the actor, which registers once, and the chrome dispatches nothing", async () => {
    const t = setup();
    for (const remote of [false, true, false]) {
        const windows = [content_window(t, remote)];
        t.windows["mail:3pane"] = windows;
        assert.equal(await api_for(windows).open({ windowId: 1 }), true);
    }
    assert.deepEqual(t.fake.sent, Array(3).fill("DesertBirdContext DesertBird:ContextMenu"));
    assert.deepEqual(t.fake.registered, ["DesertBirdContext"], "one registration for three menus");
    assert.deepEqual(t.fake.events, []);
    t.platform.restore();
});

test("no focus, an unknown window and a message window with nothing focused do nothing", async () => {
    const t = setup();
    const windows = [{ document: { activeElement: null } }];
    t.windows["mail:3pane"] = windows;
    const api = api_for(windows);
    assert.equal(await api.open({ windowId: 1 }), false);
    assert.equal(await api.open({ windowId: 99 }), false);
    assert.deepEqual([t.fake.events, t.fake.registered], [[], []]);
    t.platform.restore();
});

test("shutdown unregisters the actor and drops its root, and a later load registers again", async () => {
    const t = setup();
    const windows = [content_window(t, true)];
    t.windows["mail:3pane"] = windows;
    await api_for(windows).open({ windowId: 1 });
    shutdown();
    assert.deepEqual(t.fake.unregistered, ["DesertBirdContext"]);
    assert.equal(t.fake.roots.at(-1), null);
    shutdown();
    assert.deepEqual(t.fake.unregistered, ["DesertBirdContext"], "a second shutdown does nothing");
    await api_for(windows).open({ windowId: 1 });
    assert.deepEqual(t.fake.registered, ["DesertBirdContext", "DesertBirdContext"]);
    shutdown();
    t.platform.restore();
});

test("shutdown with no menu ever opened in a page registers and unregisters nothing", () => {
    const t = setup();
    shutdown();
    assert.deepEqual([t.fake.unregistered, t.fake.roots], [[], []]);
    t.platform.restore();
});

test("the handler asks the context verb once with the key's window and nothing else", async () => {
    const { open_context_menu } = await import("../src/background/handlers/context.ts");
    const asked: unknown[] = [];
    await open_context_menu({ window_id: 7, api: { context: { open: async (args: unknown) => (asked.push(args), false) } } } as never);
    assert.deepEqual(asked, [{ windowId: 7 }]);
});
