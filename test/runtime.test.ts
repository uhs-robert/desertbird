import assert from "node:assert/strict";
import { test } from "node:test";
import { create_runtime } from "../src/chrome/runtime.ts";
import type { Invocation, KeydownEvent, KeyTarget, RuntimeDeps, WindowListener } from "../src/chrome/runtime.ts";
import type { ViewPort } from "../src/chrome/motions.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import { StubExtensionError, stub_platform } from "./chrome_stubs.ts";

class FakeWindow implements KeyTarget {
    listeners = new Set<(event: KeydownEvent) => void>();
    adds = 0;
    in_mail_tab = true;
    in_reading_pane = false;
    document = { getElementById: () => ({ tabInfo: [], currentTabInfo: null }) };
    selected = 0;
    rows = 10;
    addEventListener(_type: "keydown", listener: (event: KeydownEvent) => void) {
        this.adds++;
        this.listeners.add(listener);
    }
    removeEventListener(_type: "keydown", listener: (event: KeydownEvent) => void) {
        this.listeners.delete(listener);
    }
    port(): ViewPort {
        return { row_count: () => this.rows, selected_index: () => this.selected, select: (index) => void (this.selected = index) };
    }
}

interface KeyResult {
    cancelled: boolean;
}

function press(window: FakeWindow, key: string, options: Partial<KeydownEvent> = {}): KeyResult {
    const result = { cancelled: false };
    const event: KeydownEvent = {
        key,
        code: "",
        ctrlKey: false,
        altKey: false,
        shiftKey: key.length === 1 && key !== key.toLowerCase(),
        metaKey: false,
        target: { localName: "tbody" },
        preventDefault: () => void (result.cancelled = true),
        stopPropagation: () => {},
        ...options,
    };
    for (const listener of [...window.listeners]) listener(event);
    return result;
}

const step = (id: string, runs_in: "chrome" | "background") => ({ invocation: { id }, runs_in, count_rule: "repeat" as const });
const leaf = (id: string, runs_in: "chrome" | "background") => ({ kind: "leaf" as const, steps: [step(id, runs_in)] });
const tree = () => ({
    version: COMPILED_KEYMAP_VERSION as typeof COMPILED_KEYMAP_VERSION,
    root: {
        kind: "branch",
        children: {
            j: leaf("motion.down", "chrome"),
            k: leaf("motion.up", "chrome"),
            x: leaf("message.archive", "background"),
            q: leaf("motion.sideways", "chrome"),
            g: { kind: "branch", children: { g: leaf("motion.top", "chrome") } },
        },
    },
});

function setup() {
    const windows = [new FakeWindow()];
    const emitted: Invocation[] = [];
    let window_listener: WindowListener<FakeWindow> | null = null;
    let registers = 0;
    let unregisters = 0;
    const deps: RuntimeDeps<FakeWindow> = {
        register_window_listener(listener) {
            registers++;
            window_listener = listener;
        },
        unregister_window_listener: () => void unregisters++,
        open_windows: () => windows,
        view_port_of: (window) => (window.in_mail_tab ? window.port() : null),
        is_typing_target: (_window, event) => (event.target as { localName: string }).localName === "input",
        in_reading_pane: (window) => window.in_reading_pane,
        window_id_of: () => 7,
        emit: (invocation) => void emitted.push(invocation),
    };
    return { windows, emitted, runtime: create_runtime(deps), counts: () => ({ registers, unregisters }), load: (window: FakeWindow) => window_listener!.on_load_window(window) };
}

test("a motion key runs in the chrome and is cancelled", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    assert.equal(press(windows[0]!, "j").cancelled, true);
    assert.equal(windows[0]!.selected, 1);
});

test("a background leaf is emitted with its window id and a count", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "3");
    press(windows[0]!, "x");
    assert.deepEqual(emitted, [{ command: "message.archive", args: {}, count: 3, windowId: 7 }]);
});

test("a sequence waits, completes, and cancels each key", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    windows[0]!.selected = 5;
    assert.equal(press(windows[0]!, "g").cancelled, true);
    assert.equal(windows[0]!.selected, 5);
    assert.equal(press(windows[0]!, "g").cancelled, true);
    assert.equal(windows[0]!.selected, 0);
});

test("an unbound plain printable key is swallowed, a named or modified key passes", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    assert.equal(press(window, "m").cancelled, true);
    assert.equal(press(window, "J").cancelled, true);
    for (const key of ["Enter", "Escape", "ArrowDown", "Tab", " ", "Backspace"]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(press(window, "j", { ctrlKey: true }).cancelled, false);
    assert.equal(press(window, "j", { altKey: true }).cancelled, false);
    assert.equal(press(window, "j", { metaKey: true }).cancelled, false);
    assert.equal(window.selected, 0);
});

test("a key in an input, outside the mail tab or from a bare modifier passes", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    assert.equal(press(window, "j", { target: { localName: "input" } }).cancelled, false);
    window.in_mail_tab = false;
    assert.equal(press(window, "j").cancelled, false);
    window.in_mail_tab = true;
    assert.equal(press(window, "Shift").cancelled, false);
    assert.equal(window.selected, 0);
});

test("Escape ends a half-typed sequence", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "g");
    assert.equal(press(window, "Escape").cancelled, false);
    window.selected = 4;
    press(window, "g");
    assert.equal(window.selected, 4);
});

test("an unknown chrome id is cancelled and does nothing", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    assert.equal(press(windows[0]!, "q").cancelled, true);
    assert.equal(windows[0]!.selected, 0);
});

test("install rejects a wrong version and a root that is not a branch", () => {
    const { runtime } = setup();
    assert.throws(() => runtime.install({ version: 0, root: tree().root }), /version/);
    assert.throws(() => runtime.install({ version: COMPILED_KEYMAP_VERSION, root: "x" }), /branch/);
    assert.throws(() => runtime.install({ version: COMPILED_KEYMAP_VERSION, root: null }), /branch/);
});

test("a rejected install leaves keys unhooked", () => {
    const { windows, runtime, counts } = setup();
    assert.throws(() => runtime.install({ version: 0, root: {} }));
    assert.equal(counts().registers, 0);
    assert.equal(windows[0]!.listeners.size, 0);
});

test("a second install replaces the tree and adds no listener", () => {
    const { windows, runtime, counts } = setup();
    runtime.install(tree());
    const replaced = tree();
    replaced.root.children.j = leaf("motion.bottom", "chrome");
    runtime.install(replaced);
    assert.equal(counts().registers, 1);
    assert.equal(windows[0]!.adds, 1);
    assert.equal(windows[0]!.listeners.size, 1);
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 9);
});

test("a window opened after the install gets the listener, and an unloaded one loses it", () => {
    const { runtime, load } = setup();
    runtime.install(tree());
    const late = new FakeWindow();
    load(late);
    load(late);
    assert.equal(late.listeners.size, 1);
    assert.equal(late.adds, 1);
    press(late, "j");
    assert.equal(late.selected, 1);
});

test("shutdown removes every listener, unregisters the window listener and clears the sequence", () => {
    const { windows, runtime, counts, load } = setup();
    const late = new FakeWindow();
    runtime.install(tree());
    load(late);
    press(windows[0]!, "g");
    runtime.shutdown();
    assert.equal(windows[0]!.listeners.size + late.listeners.size, 0);
    assert.deepEqual(counts(), { registers: 1, unregisters: 1 });
    runtime.shutdown();
    assert.equal(counts().unregisters, 1);
    runtime.install(tree());
    assert.equal(counts().registers, 2);
    windows[0]!.selected = 4;
    press(windows[0]!, "g");
    assert.equal(windows[0]!.selected, 4, "the g typed before shutdown no longer counts");
});

test("the parent removes the window listener on shutdown and every verb rethrows an ExtensionError", async () => {
    const window = new FakeWindow();
    const platform = stub_platform([window]);
    const keys_parent = await import("../src/chrome/parent_keys.ts");
    const view_parent = await import("../src/chrome/parent_view.ts");
    const context = { extension: { messageManager: { convert: () => ({ id: 1 }) } } };
    const keys = keys_parent.get_keys_api(context).keys;
    const view = view_parent.get_view_api(context).view;

    await assert.rejects(keys.install({ tree: { version: 0 as never, root: {} }, settings: {} }), (error) => error instanceof StubExtensionError && /^keys\.install: keymap version 0/.test(error.message));
    await assert.rejects(view.rows({ first: 0, last: 3 }), (error) => error instanceof StubExtensionError && /^view\.rows: no mail window/.test(error.message));
    await assert.rejects(view.select({ anchor: 0, end: 1 }), (error) => error instanceof StubExtensionError && /^view\.select: no mail window/.test(error.message));

    await keys.install({ tree: tree(), settings: {} });
    await keys.install({ tree: tree(), settings: {} });
    assert.equal(platform.register_calls, 1);
    assert.equal(platform.window_listeners.size, 1);
    assert.equal(window.listeners.size, 1);

    keys_parent.shutdown();
    assert.equal(platform.window_listeners.size, 0);
    assert.equal(window.listeners.size, 0);
    platform.restore();
});

test("in the reading pane plain printable keys are swallowed and run nothing, named and modified keys pass", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.in_reading_pane = true;
    assert.equal(press(window, "j").cancelled, true);
    assert.equal(press(window, "x").cancelled, true);
    assert.equal(press(window, "m").cancelled, true);
    assert.equal(window.selected, 0);
    assert.deepEqual(emitted, []);
    for (const key of ["Enter", "Escape", "ArrowDown", "Tab", " "]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(press(window, "j", { ctrlKey: true }).cancelled, false);
    assert.equal(press(window, "j", { target: { localName: "input" } }).cancelled, false);
});
