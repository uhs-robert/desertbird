import assert from "node:assert/strict";
import { test } from "node:test";
import { create_runtime } from "../src/chrome/runtime.ts";
import type { KeydownEvent, KeyTarget, RuntimeDeps, WindowListener } from "../src/chrome/runtime.ts";
import { create_list_port } from "../src/chrome/view.ts";
import type { About3PaneLike, ListPort } from "../src/chrome/view.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import type { KeysInvocation } from "../src/shared/protocol.ts";
import { StubExtensionError, stub_platform } from "./chrome_stubs.ts";

class FakeWindow implements KeyTarget {
    listeners = new Set<(event: KeydownEvent) => void>();
    adds = 0;
    in_mail_tab = true;
    in_reading_pane = false;
    menu_open = false;
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
    port(): ListPort {
        return { row_count: () => this.rows, selected_index: () => this.selected, select: (index) => void (this.selected = index), selected_message_ids: () => [100 + this.selected] };
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
            x: leaf("msg.archive", "background"),
            q: leaf("motion.sideways", "chrome"),
            g: { kind: "branch", children: { g: leaf("motion.top", "chrome") } },
            d: { kind: "branch", children: { d: leaf("msg.delete", "background") } },
        },
    },
});

function setup(list_port_of?: (window: FakeWindow) => ListPort) {
    const windows = [new FakeWindow()];
    const emitted: KeysInvocation[] = [];
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
        list_port_of: (window) => (window.in_mail_tab ? (list_port_of ?? ((inner) => inner.port()))(window) : null),
        is_typing_target: (_window, event) => (event.target as { localName: string }).localName === "input",
        menu_is_open: (window) => window.menu_open,
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
    assert.deepEqual(emitted, [{ command: "msg.archive", args: {}, count: 3, windowId: 7, messageIds: [100] }]);
});

test("x then j at once: x carries the ids selected at its own key press", () => {
    // The real adapter over a fake about:3pane, so the ids come from the thread list as it stands when each key runs.
    const about_3pane: About3PaneLike & { selected: number } = {
        selected: 0,
        gDBView: { rowCount: 10, getSelectedMsgHdrs: () => [{ key: about_3pane.selected }] },
        threadTree: {
            get selectedIndex() { return about_3pane.selected; },
            set selectedIndex(index: number) { about_3pane.selected = index; },
            get currentIndex() { return about_3pane.selected; },
        },
    };
    const { windows, emitted, runtime } = setup(() => create_list_port(about_3pane, (header) => 500 + (header as { key: number }).key));
    runtime.install(tree());
    press(windows[0]!, "x");
    press(windows[0]!, "j");
    assert.equal(about_3pane.selected, 1, "j moved the selection before the background could read it");
    assert.deepEqual(emitted.map((invocation) => invocation.messageIds), [[500]]);
});

test("the list port drops a header the extension cannot name", () => {
    const about_3pane: About3PaneLike = { gDBView: { rowCount: 3, getSelectedMsgHdrs: () => [{ key: 1 }, { key: 2 }, { key: 3 }] }, threadTree: { selectedIndex: 0, currentIndex: 0 } };
    const port = create_list_port(about_3pane, (header) => ((header as { key: number }).key === 2 ? null : (header as { key: number }).key));
    assert.deepEqual(port.selected_message_ids(), [1, 3]);
    assert.deepEqual(create_list_port({ ...about_3pane, gDBView: null }, () => 1).selected_message_ids(), []);
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
    const context = { extension: { windowManager: { getWrapper: () => ({ id: 1 }) }, messageManager: { convert: () => null } } };
    const keys = keys_parent.get_keys_api(context).keys;

    await assert.rejects(keys.install({ tree: { version: 0 as never, root: {} }, settings: {} }), (error) => error instanceof StubExtensionError && /^keys\.install: keymap version 0/.test(error.message));

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

test("a count reaches a chrome motion", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "3");
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 3);
});

test("a key that leaves the list ends a half-typed sequence", () => {
    const leave: [string, (window: FakeWindow) => KeyResult, (window: FakeWindow) => void][] = [
        ["a key typed into an input", (window) => press(window, "o", { target: { localName: "input" } }), () => {}],
        ["a key in the reading pane", (window) => ((window.in_reading_pane = true), press(window, "o")), (window) => void (window.in_reading_pane = false)],
        ["a key in an open menu", (window) => ((window.menu_open = true), press(window, "o")), (window) => void (window.menu_open = false)],
        ["a key in another tab", (window) => ((window.in_mail_tab = false), press(window, "o")), (window) => void (window.in_mail_tab = true)],
    ];
    for (const [name, step_away, come_back] of leave) {
        const { windows, emitted, runtime } = setup();
        runtime.install(tree());
        const window = windows[0]!;
        press(window, "d");
        step_away(window);
        come_back(window);
        press(window, "d");
        assert.deepEqual(emitted, [], name);
        press(window, "d");
        assert.equal(emitted.length, 1, `${name}: a fresh d d still deletes`);
    }
});

test("a sequence never spans two windows", () => {
    const { windows, runtime, load } = setup();
    runtime.install(tree());
    const other = new FakeWindow();
    load(other);
    windows[0]!.selected = 4;
    other.selected = 4;
    press(windows[0]!, "g");
    press(other, "g");
    assert.equal(windows[0]!.selected, 4);
    assert.equal(other.selected, 4);
    press(other, "g");
    assert.equal(other.selected, 0);
});

test("only the mail tab in front gives keys a thread list", async () => {
    const { front_about_3pane } = await import("../src/chrome/view.ts");
    const about_3pane = { gDBView: null, threadTree: { selectedIndex: 0, currentIndex: 0 } };
    const tab = (name: string) => ({ mode: { name }, chromeBrowser: { contentWindow: about_3pane } });
    assert.equal(front_about_3pane({ currentTabInfo: tab("mail3PaneTab") }), about_3pane);
    for (const name of ["mailMessageTab", "contentTab", "calendar"]) assert.equal(front_about_3pane({ currentTabInfo: tab(name) }), null, name);
    assert.equal(front_about_3pane({ currentTabInfo: null }), null);
    assert.equal(front_about_3pane(null), null);
});

test("with a menu open every key passes to the menu and runs nothing", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.menu_open = true;
    for (const key of ["j", "k", "x", "m"]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(window.selected, 0);
    assert.deepEqual(emitted, []);
});

// The chords the phase 2 groups bind. No default binding exists yet, so a test tree binds each one to its own background id.
const BOUND_CHORDS = ["o", "i", "l", "j", "k", "x", "c", "h"];
const chord_id = (letter: string) => `test.ctrl_${letter}`;
const chord_tree = () => {
    const with_chords = tree();
    for (const letter of BOUND_CHORDS) Object.assign(with_chords.root.children, { [`<C-${letter}>`]: leaf(chord_id(letter), "background") });
    return with_chords;
};
// Real hardware sends a keydown for the bare Control before the letter, and that keydown must leave a half-typed sequence and a count alone.
function press_ctrl(window: FakeWindow, letter: string, options: Partial<KeydownEvent> = {}): KeyResult {
    press(window, "Control", { ctrlKey: true, code: "ControlLeft", ...options });
    return press(window, letter, { ctrlKey: true, code: `Key${letter.toUpperCase()}`, ...options });
}

test("each bound chord runs its command and is cancelled, so the Thunderbird default does not fire", () => {
    for (const letter of BOUND_CHORDS) {
        const { windows, emitted, runtime } = setup();
        runtime.install(chord_tree());
        assert.equal(press_ctrl(windows[0]!, letter).cancelled, true, `<C-${letter}>`);
        assert.deepEqual(emitted.map((invocation) => invocation.command), [chord_id(letter)]);
    }
});

test("an unbound chord passes untouched and runs nothing", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(chord_tree());
    const window = windows[0]!;
    for (const options of [{}, { shiftKey: true }]) assert.equal(press_ctrl(window, "q", options).cancelled, false);
    assert.equal(press_ctrl(window, "o", { shiftKey: true }).cancelled, false, "<CS-o> is not <C-o>");
    assert.equal(press(window, "h", { altKey: true, code: "KeyH" }).cancelled, false, "alt chords stay unbound");
    assert.equal(press(window, "o", { metaKey: true, code: "KeyO" }).cancelled, false);
    assert.equal(press(window, "Tab", { ctrlKey: true }).cancelled, false);
    assert.equal(press(window, "@", { ctrlKey: true, altKey: true, code: "KeyQ" }).cancelled, false, "an AltGr character arrives with ctrl and alt held");
    assert.deepEqual(emitted, []);
});

test("a bound chord passes untouched in a text field, an open menu, the reading pane and another tab", () => {
    const away: [string, (window: FakeWindow) => KeyResult][] = [
        ["a text field", (window) => press_ctrl(window, "c", { target: { localName: "input" } })],
        ["an open menu", (window) => ((window.menu_open = true), press_ctrl(window, "c"))],
        ["the reading pane", (window) => ((window.in_reading_pane = true), press_ctrl(window, "c"))],
        ["another tab", (window) => ((window.in_mail_tab = false), press_ctrl(window, "c"))],
    ];
    for (const [name, press_away] of away) {
        const { windows, emitted, runtime } = setup();
        runtime.install(chord_tree());
        assert.equal(press_away(windows[0]!).cancelled, false, name);
        assert.deepEqual(emitted, [], name);
    }
});

test("a chord after a half-typed plain sequence drops the sequence", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(chord_tree());
    const window = windows[0]!;
    const commands = () => emitted.map((invocation) => invocation.command);
    press(window, "d");
    assert.equal(press_ctrl(window, "o").cancelled, true, "a bound chord still runs as a first key");
    press(window, "d");
    assert.deepEqual(commands(), [chord_id("o")], "the d before the chord does not pair with the d after it");
    assert.equal(press_ctrl(window, "q").cancelled, false, "an unbound chord still passes");
    press(window, "d");
    assert.deepEqual(commands(), [chord_id("o")], "nor does a d before an unbound chord");
    press(window, "d");
    assert.deepEqual(commands(), [chord_id("o"), "msg.delete"], "a fresh d d still deletes");
});

test("a count reaches a bound chord", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(chord_tree());
    press(windows[0]!, "3");
    press_ctrl(windows[0]!, "j");
    assert.equal(emitted[0]?.count, 3);
});
