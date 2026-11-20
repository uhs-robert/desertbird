import assert from "node:assert/strict";
import { test } from "node:test";
import { create_page_runtime } from "../src/chrome/page_runtime.ts";
import type { PageDeps } from "../src/chrome/page_runtime.ts";
import type { KeydownEvent, KeyTarget, WindowListener } from "../src/chrome/runtime.ts";
import type { Situation } from "../src/chrome/readable_focus.ts";
import { compile_tab_keymap, page_message_tree } from "../src/background/commands/tab_keymaps.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import type { KeysEvent, KeysInvocation } from "../src/shared/protocol.ts";

class FakeWindow {
    key_listeners = new Set<(event: KeydownEvent) => void>();
    tab_listeners = new Set<() => void>();
    blur_listeners = new Set<() => void>();
    situation: Situation = "page";
    overlay_loading = false;
    /** The target the runtime listens on, a stand-in for the window root. */
    root: KeyTarget = {
        addEventListener: (_type, listener) => void this.key_listeners.add(listener),
        removeEventListener: (_type, listener) => void this.key_listeners.delete(listener),
    };
}

function press(window: FakeWindow, key: string, options: Partial<KeydownEvent> = {}) {
    const result = { cancelled: false, stopped: false };
    const event: KeydownEvent = {
        key,
        code: "",
        ctrlKey: false,
        altKey: false,
        shiftKey: key.length === 1 && key !== key.toLowerCase(),
        metaKey: false,
        target: { localName: "body" },
        preventDefault: () => void (result.cancelled = true),
        stopPropagation: () => void (result.stopped = true),
        ...options,
    };
    window.overlay_loading = (event.target as { id?: string }).id === "desertbird-overlay-loading";
    for (const listener of [...window.key_listeners]) listener(event);
    return result;
}

const tree_of = (result: ReturnType<typeof compile_tab_keymap>) => ({ version: COMPILED_KEYMAP_VERSION, root: JSON.parse(JSON.stringify(result.compiled.modes.normal)) as unknown });
const tree = (user?: Parameters<typeof compile_tab_keymap>[1]) => ({ page: tree_of(compile_tab_keymap("page", user)), message: page_message_tree(tree_of(compile_tab_keymap("message", user)) as never) });

function setup(window_count = 1) {
    const windows = Array.from({ length: window_count }, () => new FakeWindow());
    const events: KeysEvent[] = [];
    const scrolls: [string, number | undefined][] = [];
    let time = 0;
    let window_listener: WindowListener<FakeWindow> | null = null;
    let registers = 0;
    let unregisters = 0;
    const deps: PageDeps<FakeWindow> = {
        register_window_listener(listener) {
            registers++;
            window_listener = listener;
        },
        unregister_window_listener: () => void unregisters++,
        open_windows: () => windows,
        key_target_of: (window) => window.root,
        situation_of: (window) => window.situation,
        overlay_is_loading: (window) => window.overlay_loading,
        message_ids_of: () => [42],
        scroll: (_window, id, count) => (scrolls.push([id, count]), true),
        on_tab_select(window, listener) {
            window.tab_listeners.add(listener);
            return () => void window.tab_listeners.delete(listener);
        },
        on_window_blur(window, listener) {
            window.blur_listeners.add(listener);
            return () => void window.blur_listeners.delete(listener);
        },
        window_id_of: (window) => 7 + windows.indexOf(window),
        now: () => time,
        emit: (event) => void events.push(event),
    };
    const invocations = () => events.filter((event): event is KeysInvocation => "args" in event);
    const pending = () => events.filter((event) => "keys" in event);
    return { windows, events, invocations, pending, scrolls, advance: (ms: number) => void (time += ms), runtime: create_page_runtime(deps), counts: () => ({ registers, unregisters }), load: (window: FakeWindow) => window_listener!.on_load_window(window), unload: (window: FakeWindow) => window_listener!.on_unload_window(window) };
}

test("j, k, the half page keys and gg and G scroll the page, take the key and report only the half-typed g", () => {
    const { windows, runtime, scrolls, events } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    for (const [key, options] of [["j", {}], ["k", {}], ["d", { ctrlKey: true }], ["u", { ctrlKey: true }], ["G", {}]] as const) {
        const result = press(window, key, options);
        assert.equal(result.cancelled && result.stopped, true, key);
    }
    press(window, "g");
    assert.equal(press(window, "g").cancelled, true);
    assert.deepEqual(scrolls.map(([id]) => id), ["page.scroll_down", "page.scroll_up", "page.half_down", "page.half_up", "page.bottom", "page.top"]);
    assert.deepEqual(events.map((event) => ("keys" in event ? event.keys.join("") : event.command)), ["g", ""]);
});

test("a count reaches the scroll", () => {
    const { windows, runtime, scrolls } = setup();
    runtime.install(tree());
    press(windows[0]!, "3");
    press(windows[0]!, "j");
    assert.deepEqual(scrolls, [["page.scroll_down", 3]]);
});

test("q, :, the tab keys and g p a run in the background with the window id and no message", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "q");
    press(window, ":");
    press(window, "J");
    press(window, "k", { altKey: true });
    for (const key of ["t", "p"]) press(window, key);
    press(window, "q", { altKey: true });
    for (const key of ["g", "p", "a"]) press(window, key);
    assert.deepEqual(
        invocations().map((event) => [event.command, event.args, event.windowId, event.messageIds]),
        [["tab.close", {}, 7, []], ["cmdline.open", {}, 7, []], ["tab.next", {}, 7, []], ["tab.prev", {}, 7, []], ["tab.prev", {}, 7, []], ["tab.close", {}, 7, []], ["app.open_page", { page: "addons" }, 7, []]],
    );
});

test("a key the tree leaves unbound passes, and so does a chord a mail key would take", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    for (const key of ["x", "d", "o", "z"]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(press(window, "c", { ctrlKey: true }).cancelled, false);
    assert.equal(press(window, "x", { ctrlKey: true }).cancelled, false);
    press(window, "g");
    assert.equal(press(window, "z").cancelled, false, "g then an unbound key");
    assert.deepEqual(invocations(), []);
});

test("a half-typed g takes the key and waits, and an unrelated second key starts over", () => {
    const { windows, runtime, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    assert.equal(press(window, "g").cancelled, true);
    press(window, "z");
    press(window, "g");
    assert.equal(scrolls.length, 0);
    press(window, "g");
    assert.deepEqual(scrolls.map(([id]) => id), ["page.top"]);
});

test("a key in a text field, in the mail tab or with a menu open passes and drops a half-typed sequence", () => {
    for (const situation of ["typing", "pass"] as const) {
        const { windows, runtime, scrolls, invocations } = setup();
        runtime.install(tree());
        const window = windows[0]!;
        press(window, "g");
        window.situation = situation;
        assert.equal(press(window, "q").cancelled, false, situation);
        window.situation = "page";
        press(window, "g");
        assert.equal(scrolls.length, 0, `${situation}: the g from before no longer counts`);
        assert.deepEqual(invocations(), []);
    }
});

test("a remote page runs only the close chord and passes every other key, J, K and Alt+J among them", () => {
    const { windows, runtime, invocations, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "remote";
    for (const key of ["q", ":", "j", "g", "J", "K"]) assert.equal(press(window, key).cancelled, false, key);
    for (const key of ["d", "j", "k"]) assert.equal(press(window, key, { ctrlKey: true }).cancelled, false, `Ctrl+${key} stays the page's own`);
    for (const key of ["j", "k"]) assert.equal(press(window, key, { altKey: true }).cancelled, false, `Alt+${key} stays the page's own`);
    assert.equal(press(window, "q", { altKey: true }).cancelled, true);
    assert.deepEqual(invocations().map((event) => event.command), ["tab.close"]);
    assert.equal(scrolls.length, 0);
});


test("g ? asks for the root of the page tree and the next key reports its end once", () => {
    const { windows, runtime, invocations, pending } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "g");
    press(window, "?");
    assert.deepEqual(invocations(), []);
    assert.deepEqual(pending().slice(2).map((event) => [event.keys, event.source, event.root]), [[[], "page", true]]);
    press(window, "j");
    press(window, "j");
    assert.deepEqual(pending().slice(3).map((event) => [event.keys, event.windowId, event.root]), [[[], 7, undefined]]);
});

test("a half-typed t reports its keys with the page source, and the key after it ends the panel", () => {
    const { windows, runtime, pending } = setup();
    runtime.install(tree());
    press(windows[0]!, "t");
    assert.deepEqual(pending().map((event) => [event.keys, event.source]), [[["t"], "page"]]);
    press(windows[0]!, "n");
    assert.deepEqual(pending().map((event) => event.keys), [["t"], []]);
});

test("a half-typed key in a message tab names the message source", () => {
    const { windows, runtime, pending } = setup();
    runtime.install(tree());
    windows[0]!.situation = "message";
    press(windows[0]!, "t");
    assert.deepEqual(pending().map((event) => event.source), ["message"]);
});

test("plain keys are dropped after a held command until the focus reaches a text field, and a hold ends after 1.5 seconds", () => {
    const { windows, runtime, invocations, advance } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    assert.equal(press(window, "q").cancelled, true, "swallowed");
    assert.deepEqual(invocations().map((event) => event.command), ["cmdline.open"]);
    window.situation = "typing";
    assert.equal(press(window, "q").cancelled, false, "the overlay took the focus");
    window.situation = "page";
    assert.equal(press(window, "j").cancelled, true);
    press(window, ":");
    advance(1600);
    press(window, "q");
    assert.deepEqual(invocations().map((event) => event.command), ["cmdline.open", "cmdline.open", "tab.close"]);
});

test("plain keys are dropped while the focus is in a loading overlay, even after the hold ran out", () => {
    const { windows, runtime, invocations, advance } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    advance(1600);
    window.situation = "remote";
    const loading = { target: { localName: "browser", id: "desertbird-overlay-loading" } };
    assert.equal(press(window, "q", loading).cancelled, true);
    assert.deepEqual(invocations().map((event) => event.command), ["cmdline.open"]);
    assert.equal(press(window, "Escape", loading).cancelled, false);
});

test("a chord is not held", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    press(windows[0]!, ":");
    press(windows[0]!, "q", { altKey: true });
    assert.deepEqual(invocations().map((event) => event.command), ["cmdline.open", "tab.close"]);
});

test("a tab change or a window blur drops a half-typed sequence and a hold", () => {
    const resets: ((window: FakeWindow) => void)[] = [(window) => window.tab_listeners.forEach((listener) => listener()), (window) => window.blur_listeners.forEach((listener) => listener())];
    for (const reset of resets) {
        const { windows, runtime, scrolls, invocations } = setup();
        runtime.install(tree(), ["cmdline.open"]);
        const window = windows[0]!;
        press(window, "g");
        reset(window);
        press(window, "g");
        assert.equal(scrolls.length, 0);
        press(window, ":");
        reset(window);
        press(window, "q");
        assert.deepEqual(invocations().map((event) => event.command), ["cmdline.open", "tab.close"]);
    }
});

test("a g in one window and a g in another do not make gg", () => {
    const { windows, runtime, scrolls } = setup(2);
    runtime.install(tree());
    press(windows[0]!, "g");
    press(windows[1]!, "g");
    assert.equal(scrolls.length, 0);
});

test("a user rebind and a user null apply", () => {
    const { windows, runtime, scrolls, invocations } = setup();
    runtime.install(tree({ z: { id: "page.scroll_down" }, q: null }));
    const window = windows[0]!;
    press(window, "z");
    assert.equal(press(window, "q").cancelled, false);
    assert.deepEqual(scrolls.map(([id]) => id), ["page.scroll_down"]);
    assert.deepEqual(invocations(), []);
});

test("nothing happens before an install, and a second install swaps the tree and adds no listener", () => {
    const { windows, runtime, counts, scrolls } = setup();
    const window = windows[0]!;
    assert.equal(window.key_listeners.size, 0);
    runtime.install(tree());
    runtime.install(tree({ z: { id: "page.scroll_down" } }));
    assert.equal(counts().registers, 1);
    assert.equal(window.key_listeners.size, 1);
    press(window, "z");
    assert.equal(scrolls.length, 1);
});

test("a window that opens later is hooked, and one that closes is released", () => {
    const { windows, runtime, load, unload } = setup(1);
    runtime.install(tree());
    const late = new FakeWindow();
    load(late);
    load(late);
    assert.equal(late.key_listeners.size, 1);
    unload(late);
    assert.equal(late.key_listeners.size, 0);
    assert.equal(late.tab_listeners.size + late.blur_listeners.size, 0);
    assert.equal(windows[0]!.key_listeners.size, 1);
});

test("shutdown removes every listener and the window listener, and the keys pass after it", () => {
    const { windows, runtime, counts, scrolls } = setup(2);
    runtime.install(tree());
    runtime.shutdown();
    for (const window of windows) assert.equal(window.key_listeners.size + window.tab_listeners.size + window.blur_listeners.size, 0);
    assert.deepEqual(counts(), { registers: 1, unregisters: 1 });
    press(windows[0]!, "j");
    assert.equal(scrolls.length, 0);
    runtime.install(tree());
    assert.equal(windows[0]!.key_listeners.size, 1);
});

test("a bare modifier and an unnamed key pass", () => {
    const { windows, runtime, scrolls } = setup();
    runtime.install(tree());
    assert.equal(press(windows[0]!, "Shift").cancelled, false);
    assert.equal(scrolls.length, 0);
});

test("a message tab takes the message tree: reading keys scroll, mail commands run with the message id", () => {
    const { windows, runtime, scrolls, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "message";
    press(window, "j");
    press(window, "d");
    assert.equal(press(window, "d").cancelled, true);
    press(window, "r");
    assert.deepEqual(scrolls.map(([id]) => id), ["message.scroll_down"]);
    assert.deepEqual(invocations().map((event) => [event.command, event.messageIds]), [["msg.delete", [42]], ["msg.reply", [42]]]);
});

test("in a message tab a plain key with no binding is cancelled, so Thunderbird's own single keys do not fire, and a chord passes", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "message";
    assert.equal(press(window, "X").cancelled, true);
    assert.equal(press(window, "c", { ctrlKey: true }).cancelled, false);
    assert.equal(invocations().length, 0);
});

test("in a message tab the find key opens no line, and the picks that need the body script run nothing", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "message";
    assert.equal(press(window, "/").cancelled, true);
    press(window, "f");
    assert.deepEqual(invocations().map((event) => event.command), []);
});

test("the page tree and the message tree keep separate half-typed sequences", () => {
    const { windows, runtime, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "g");
    window.situation = "message";
    press(window, "g");
    window.situation = "page";
    press(window, "g");
    assert.equal(scrolls.length, 0, "no gg out of three g in two tabs");
    press(window, "g");
    assert.deepEqual(scrolls.map(([id]) => id), ["page.top"]);
});
