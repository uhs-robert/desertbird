import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";
import type { ChildKey } from "../src/chrome/page_runtime.ts";
import type * as PageActor from "../src/chrome/page_actor_parent.ts";
import { compile_tab_keymap, compile_typing_keymap } from "../src/background/commands/tab_keymaps.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import { stub_platform } from "./chrome_stubs.ts";

const MAIN_WINDOW_URL = "chrome://messenger/content/messenger.xhtml";

// The actor system's stand-ins: the base class records what the parent sends, and the globals record registration, substitution and focus.
class FakeActorParent {
    sent: [string, unknown][] = [];
    send_throws = false;
    browsingContext: FakeContext;
    manager: { documentPrincipal: { addonId: string } };
    constructor(context: FakeContext, addon_id = "") {
        this.browsingContext = context;
        this.manager = { documentPrincipal: { addonId: addon_id } };
    }
    sendAsyncMessage(name: string, data?: unknown) {
        if (this.send_throws) throw new Error("the child is gone");
        this.sent.push([name, data === undefined ? undefined : JSON.parse(JSON.stringify(data))]);
    }
}

interface FakeContext {
    top: FakeContext;
    embedderElement: FakeBrowser | null;
    currentWindowGlobal: { getExistingActor(name: string): unknown; getActor(name: string): unknown };
}

interface FakeBrowser {
    ownerDocument: { defaultView: FakeWindow };
    in_tabs: boolean;
    closest(selector: string): unknown;
    browsingContext: FakeContext;
}

interface FakeWindow {
    location: { href: string };
    document: { activeElement: unknown; getElementById(id: string): unknown };
    tabmail: { currentTabInfo: { browser: FakeBrowser | null } | null; tabInfo: { browser: FakeBrowser | null }[] };
}

const registry = { registered: [] as [string, Record<string, any>][], unregistered: [] as string[], substitutions: [] as [string, unknown][], focused: null as FakeContext | null };

let Parent: new (context: FakeContext, addon_id?: string) => FakeActorParent & { on: boolean; receiveMessage(message: { name: string; data?: unknown }): unknown; didDestroy(): void };
let actor_module: typeof PageActor;

before(async () => {
    const globals = globalThis as Record<string, unknown>;
    globals["JSWindowActorParent"] = FakeActorParent;
    globals["ChromeUtils"] = {
        registerWindowActor: (name: string, options: Record<string, any>) => void registry.registered.push([name, options]),
        unregisterWindowActor: (name: string) => void registry.unregistered.push(name),
    };
    globals["Ci"] = { nsIResProtocolHandler: "nsIResProtocolHandler" };
    globals["Services"] = {
        focus: { get focusedContentBrowsingContext() { return registry.focused; } },
        wm: { getEnumerator: () => open_windows },
        io: { getProtocolHandler: () => ({ QueryInterface: () => ({ setSubstitution: (root: string, uri: unknown) => void registry.substitutions.push([root, uri]) }) }) },
    };
    actor_module = await import("../src/chrome/page_actor_parent.ts");
    Parent = actor_module.DesertBirdPageParent as unknown as typeof Parent;
});

let open_windows: FakeWindow[] = [];

afterEach(() => {
    actor_module.stop();
    registry.registered = [];
    registry.unregistered = [];
    registry.substitutions = [];
    registry.focused = null;
    open_windows = [];
});

function make_window(url = MAIN_WINDOW_URL): FakeWindow {
    const window: FakeWindow = {
        location: { href: url },
        tabmail: { currentTabInfo: null, tabInfo: [] },
        document: { activeElement: null, getElementById: (id: string) => (id === "tabmail" ? window.tabmail : null) },
    };
    return window;
}

/** A tab browser with its page's actor. `front` makes it the window's front tab. */
function make_tab(window: FakeWindow, { front = true, in_tabs = true, addon_id = "" } = {}) {
    let actor: InstanceType<typeof Parent> | null = null;
    const context = { currentWindowGlobal: { getExistingActor: () => actor, getActor: () => (actor ??= new Parent(context, addon_id)) } } as unknown as FakeContext;
    context.top = context;
    const browser: FakeBrowser = { ownerDocument: { defaultView: window }, in_tabs, closest: (selector) => (selector === "#tabpanelcontainer" && in_tabs ? {} : null), browsingContext: context };
    context.embedderElement = browser;
    window.tabmail.tabInfo.push({ browser });
    if (front) window.tabmail.currentTabInfo = { browser };
    // The actor system makes the parent when the child first talks.
    const parent = context.currentWindowGlobal.getActor("DesertBirdPage") as InstanceType<typeof Parent>;
    return { browser, context, parent };
}

const tree_of = (result: ReturnType<typeof compile_tab_keymap>) => ({ version: COMPILED_KEYMAP_VERSION, root: JSON.parse(JSON.stringify(result.compiled.modes.normal)) as unknown });
const page_tree = () => tree_of(compile_tab_keymap("page"));
const typing_tree = () => tree_of(compile_typing_keymap());

function start(own_id = "desertbird@uhs-robert") {
    const keys: [unknown, ChildKey | null][] = [];
    actor_module.start({ own_id, on_key: (window, key) => void keys.push([window, key]) });
    return keys;
}

const states = (parent: FakeActorParent) => parent.sent.filter(([name]) => name === "DesertBird:State").map(([, data]) => data as PageActor.ActorState);

test("start registers the actor from its own URL, for web, file and add-on pages, top-level only, with the key, load and show events", () => {
    start();
    assert.equal(registry.registered.length, 1);
    const [name, options] = registry.registered[0]!;
    assert.equal(name, "DesertBirdPage");
    assert.match(options["parent"].esModuleURI, /page_actor_parent\.ts$/);
    assert.match(options["child"].esModuleURI, /page_actor_child\.sys\.mjs$/);
    assert.deepEqual(options["child"].events, { keydown: { capture: true }, DOMContentLoaded: {}, pageshow: {} });
    assert.equal(options["allFrames"], false);
    assert.deepEqual(options["matches"], ["http://*/*", "https://*/*", "file:///*", "moz-extension://*/*"]);
    assert.ok(!options["remoteTypes"].includes("privilegedabout"), "the about: pages stay the parent's");
});

test("a hello from the front tab's page turns the child on, ends insert mode there and answers the keys to take", () => {
    const keys = start();
    actor_module.set_keys(page_tree(), typing_tree());
    const window = make_window();
    const { parent } = make_tab(window);
    const state = parent.receiveMessage({ name: "DesertBird:Hello" }) as PageActor.ActorState;
    assert.equal(state.on, true);
    assert.equal(state.insert, false);
    for (const token of ["j", "G", "g", "<C-d>", "i", "1", "9"]) assert.ok(state.page.includes(token), token);
    assert.ok(!state.page.includes("x"));
    assert.deepEqual([...state.typing].sort(), ["<A-j>", "<A-k>", "<C-[>", "<Escape>"]);
    assert.deepEqual(keys, [[window, null]]);
});

test("a hello from a background tab answers on but ends no insert mode", () => {
    const keys = start();
    const window = make_window();
    const { parent } = make_tab(window, { front: false });
    make_tab(window);
    assert.equal((parent.receiveMessage({ name: "DesertBird:Hello" }) as PageActor.ActorState).on, true);
    assert.deepEqual(keys, []);
});

test("the add-on's own pages, a browser outside the tab panels and another window's browser get an off answer", () => {
    start("own@id");
    for (const [label, parent] of [
        ["own page", make_tab(make_window(), { addon_id: "own@id" }).parent],
        ["popup browser", make_tab(make_window(), { in_tabs: false }).parent],
        ["other window", make_tab(make_window("chrome://messenger/content/messageWindow.xhtml")).parent],
    ] as const) {
        assert.equal((parent.receiveMessage({ name: "DesertBird:Hello" }) as PageActor.ActorState).on, false, label);
    }
});

test("a key reaches the runtime only from the front tab's page, rebuilt with nothing but the key fields", () => {
    const keys = start();
    const window = make_window();
    const background = make_tab(window, { front: false }).parent;
    const front = make_tab(window).parent;
    for (const parent of [background, front]) parent.receiveMessage({ name: "DesertBird:Hello" });
    keys.length = 0;
    background.receiveMessage({ name: "DesertBird:Key", data: { key: "j" } });
    front.receiveMessage({ name: "DesertBird:Key", data: { key: "j", code: "KeyJ", shiftKey: "yes", field: true, prevented: true, extra: "page text" } });
    assert.equal(keys.length, 1);
    const [seen_window, key] = keys[0]!;
    assert.equal(seen_window, window);
    const { preventDefault: _p, stopPropagation: _s, ...fields } = key!;
    assert.deepEqual(fields, { key: "j", code: "KeyJ", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, field: true, defaultPrevented: true, target: null });
});

test("a key from a child the parent never answered on is dropped", () => {
    const keys = start();
    const { parent } = make_tab(make_window());
    parent.receiveMessage({ name: "DesertBird:Key", data: { key: "j" } });
    assert.deepEqual(keys, []);
});

test("a keymap change pushes the new keys to every live child", () => {
    start();
    const window = make_window();
    const tabs = [make_tab(window, { front: false }), make_tab(window)];
    for (const { parent } of tabs) parent.receiveMessage({ name: "DesertBird:Hello" });
    actor_module.set_keys(page_tree(), typing_tree());
    for (const { parent } of tabs) assert.ok(states(parent).at(-1)!.page.includes("j"));
    actor_module.set_keys({ root: { kind: "branch", children: { x: { kind: "leaf" }, m: { kind: "branch", children: { "": { kind: "leaf" } } } } } }, typing_tree());
    for (const { parent } of tabs) assert.deepEqual([...states(parent).at(-1)!.page].sort(), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "m", "x"]);
});

test("the insert flag reaches only the children of its window, and a later hello there answers it", () => {
    start();
    const first = make_window();
    const second = make_window();
    const in_first = make_tab(first).parent;
    const in_second = make_tab(second).parent;
    for (const parent of [in_first, in_second]) parent.receiveMessage({ name: "DesertBird:Hello" });
    actor_module.set_insert(first, true);
    assert.equal(states(in_first).at(-1)!.insert, true);
    assert.deepEqual(states(in_second), []);
    const late = make_tab(first, { front: false }).parent;
    assert.equal((late.receiveMessage({ name: "DesertBird:Hello" }) as PageActor.ActorState).insert, true);
    actor_module.set_insert(first, false);
    assert.equal(states(in_first).at(-1)!.insert, false);
});

test("start reaches the pages already open: their children get the state with no first key", () => {
    const window = make_window();
    const { parent } = make_tab(window);
    open_windows = [window];
    start();
    assert.equal(states(parent).at(-1)?.on, true);
});

test("takes_keys holds only while the focus sits in the front tab's own top-level page and its child is on", () => {
    start();
    const window = make_window();
    const { context, parent } = make_tab(window);
    assert.equal(actor_module.takes_keys(window), false, "no hello yet");
    parent.receiveMessage({ name: "DesertBird:Hello" });
    assert.equal(actor_module.takes_keys(window), false, "the focus is in the chrome");
    registry.focused = context;
    assert.equal(actor_module.takes_keys(window), true);
    registry.focused = { top: context, embedderElement: null } as unknown as FakeContext;
    assert.equal(actor_module.takes_keys(window), false, "a frame has the focus");
});

test("scroll and blur go to the front tab's child, and answer false when it has none", () => {
    start();
    const window = make_window();
    const { browser, parent } = make_tab(window);
    assert.equal(actor_module.scroll(window, "page.scroll_down", 2), false);
    parent.receiveMessage({ name: "DesertBird:Hello" });
    assert.equal(actor_module.scroll(window, "page.scroll_down", 2), true);
    assert.equal(actor_module.blur(window), false, "the chrome has the focus, so its own field is blurred");
    window.document.activeElement = browser;
    assert.equal(actor_module.blur(window), true);
    assert.deepEqual(parent.sent.filter(([name]) => name !== "DesertBird:State"), [["DesertBird:Scroll", { id: "page.scroll_down", count: 2 }], ["DesertBird:Blur", undefined]]);
});

test("a child whose page went (didDestroy) or whose send throws gets no more pushes", () => {
    start();
    const window = make_window();
    const gone = make_tab(window, { front: false }).parent;
    const broken = make_tab(window, { front: false }).parent;
    for (const parent of [gone, broken]) parent.receiveMessage({ name: "DesertBird:Hello" });
    gone.didDestroy();
    broken.send_throws = true;
    actor_module.set_insert(window, true);
    broken.send_throws = false;
    actor_module.set_insert(window, false);
    assert.deepEqual(states(gone), []);
    assert.deepEqual(states(broken), []);
});

test("stop turns every child off, unregisters, drops its resource root and the hooks, so a late key calls nothing", () => {
    const keys = start();
    const window = make_window();
    const { parent } = make_tab(window);
    parent.receiveMessage({ name: "DesertBird:Hello" });
    keys.length = 0;
    actor_module.stop();
    assert.equal(states(parent).at(-1)?.on, false);
    assert.deepEqual(registry.unregistered, ["DesertBirdPage"]);
    assert.equal(registry.substitutions.at(-1)?.[1], null);
    parent.receiveMessage({ name: "DesertBird:Key", data: { key: "j" } });
    assert.equal((parent.receiveMessage({ name: "DesertBird:Hello" }) as PageActor.ActorState).on, false);
    assert.deepEqual(keys, [], "the hooks of the old add-on scope are never called");
});

test("a second start after stop registers again", () => {
    start();
    actor_module.stop();
    start();
    assert.equal(registry.registered.length, 2);
});

test("the pages API loads the actor from a new resource root on each load, after the runtime, and stops it on shutdown", async () => {
    const platform = stub_platform();
    const globals = globalThis as Record<string, any>;
    const roots: string[] = [];
    const calls: string[] = [];
    const fake_actor = { start: () => void calls.push("start"), stop: () => void calls.push("stop"), set_keys: () => void calls.push("set_keys") };
    globals["Services"] = { ...globals["Services"], io: { getProtocolHandler: () => ({ QueryInterface: () => ({ setSubstitution: (root: string) => void roots.push(root) }) }) } };
    const import_platform = globals["ChromeUtils"].importESModule;
    globals["ChromeUtils"] = { importESModule: (url: string) => (url.startsWith("resource://desertbird-actor-") ? (calls.push(url), fake_actor) : import_platform(url)) };
    const now = mock.method(Date, "now", () => 1000);
    try {
        const pages = await import("../src/chrome/parent_pages.ts");
        const context = { extension: { rootURI: "jar:file:///x.xpi!/", id: "desertbird@uhs-robert", windowManager: { getWrapper: () => null }, messageManager: { convert: () => null } } };
        const install = (api: ReturnType<typeof pages.get_pages_api>) => api.pages.install({ pageTree: page_tree(), messageTree: page_tree(), typingTree: typing_tree(), holdCommands: [] } as never);
        await install(pages.get_pages_api(context as never));
        await install(pages.get_pages_api(context as never));
        pages.shutdown();
        now.mock.mockImplementation(() => 2000);
        await install(pages.get_pages_api(context as never));
        pages.shutdown();
        assert.equal(roots.length, 2, "one root per load, not per install");
        assert.notEqual(roots[0], roots[1]);
        assert.deepEqual(calls.filter((call) => !call.startsWith("resource://")), ["start", "set_keys", "set_keys", "stop", "start", "set_keys", "stop"]);
        assert.deepEqual(calls.filter((call) => call.startsWith("resource://")), roots.map((root) => `resource://${root}/experiment/page_actor_parent.sys.mjs`));
    } finally {
        now.mock.restore();
        platform.restore();
    }
});
