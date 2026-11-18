import assert from "node:assert/strict";
import { test } from "node:test";
import { create_runtime } from "../src/chrome/runtime.ts";
import type { KeydownEvent, KeyTarget, RuntimeDeps, WindowListener } from "../src/chrome/runtime.ts";
import { compile_default_keymap } from "../src/background/commands/index.ts";
import { mark_unrepeatable } from "../src/background/config/keymap.ts";
import { create_list_port } from "../src/chrome/view.ts";
import type { About3PaneLike, ListPort } from "../src/chrome/view.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import type { KeysInvocation, KeysMode, KeysPending } from "../src/shared/protocol.ts";
import { StubExtensionError, stub_platform } from "./chrome_stubs.ts";

class FakeWindow implements KeyTarget {
    listeners = new Set<(event: KeydownEvent) => void>();
    tab_listeners = new Set<() => void>();
    blur_listeners = new Set<() => void>();
    adds = 0;
    in_mail_tab = true;
    /** The tab kind outside the mail tab: 1 readable, 2 remote. */
    tab_kind: 1 | 2 = 2;
    in_reading_pane = false;
    /** The folder tree rows and selection while the folder pane has the focus, or null. */
    folder: { rows: number; selected: number } | null = null;
    body_script_live = false;
    menu_open = false;
    has_focus = true;
    document = { getElementById: () => ({ tabInfo: [], currentTabInfo: null }), hasFocus: () => this.has_focus };
    selected = 0;
    rows = 10;
    addEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
    addEventListener(type: "TabSelect", listener: () => void, capture: boolean): void;
    addEventListener(type: "blur", listener: () => void, capture: boolean): void;
    addEventListener(type: string, listener: (event?: any) => void) {
        if (type === "blur") return void this.blur_listeners.add(listener);
        if (type === "TabSelect") return void this.tab_listeners.add(listener as () => void);
        this.adds++;
        this.listeners.add(listener);
    }
    removeEventListener(type: "keydown", listener: (event: KeydownEvent) => void, capture: boolean): void;
    removeEventListener(type: "TabSelect", listener: () => void, capture: boolean): void;
    removeEventListener(type: "blur", listener: () => void, capture: boolean): void;
    removeEventListener(type: string, listener: (event?: any) => void) {
        if (type === "blur") return void this.blur_listeners.delete(listener);
        if (type === "TabSelect") return void this.tab_listeners.delete(listener as () => void);
        this.listeners.delete(listener);
    }
    /** A tab switch with no key: a click on the tab bar. */
    select_tab() {
        for (const listener of [...this.tab_listeners]) listener();
    }
    /** A blur event. `window_lost_focus` is whether the whole window deactivated (an alt-tab) or focus only moved between elements inside it. */
    blur(window_lost_focus = true) {
        this.has_focus = !window_lost_focus;
        for (const listener of [...this.blur_listeners]) listener();
    }
    /** The rows `select_range` selected, or null when one row is selected. */
    range: [number, number] | null = null;
    /** What the list is showing: a new object stands for another folder, a rebuilt view. */
    view = {};
    /** The message key at a row where a test has inserted or removed a message. Other rows have their index as key. */
    key_overrides: Record<number, number> = {};
    port(): ListPort {
        const key_at = (index: number) => this.key_overrides[index] ?? index;
        return {
            marks: (anchor, end) => [this.view, key_at(anchor), key_at(end)],
            row_count: () => this.rows,
            selected_index: () => this.selected,
            select: (index) => void ((this.selected = index), (this.range = null)),
            select_range: (anchor, end) => void ((this.selected = end), (this.range = [Math.min(anchor, end), Math.max(anchor, end)])),
            selected_message_ids: () => (this.range ? Array.from({ length: this.range[1] - this.range[0] + 1 }, (_, offset) => 100 + this.range![0] + offset) : [100 + this.selected]),
        };
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
const unrepeatable = (id: string) => ({ kind: "leaf" as const, steps: [{ ...step(id, "background"), repeatable: false }] });
const tree = () => ({
    version: COMPILED_KEYMAP_VERSION as typeof COMPILED_KEYMAP_VERSION,
    root: {
        kind: "branch",
        children: {
            j: leaf("motion.down", "chrome"),
            k: leaf("motion.up", "chrome"),
            x: leaf("msg.archive", "background"),
            q: leaf("motion.sideways", "chrome"),
            ":": leaf("cmdline.open", "background"),
            ".": leaf("repeat.last", "chrome"),
            v: leaf("visual.toggle", "chrome"),
            r: leaf("msg.read", "background"),
            D: unrepeatable("msg.delete"),
            g: { kind: "branch", children: { g: leaf("motion.top", "chrome") } },
            d: { kind: "branch", children: { d: leaf("msg.delete", "background") } },
        },
    },
});

function setup(list_port_of?: (window: FakeWindow) => ListPort) {
    const windows = [new FakeWindow()];
    const emitted: KeysInvocation[] = [];
    // The `pending` events, kept apart so a test of a command reads only the commands.
    const pending: KeysPending[] = [];
    // The visual mode changes the runtime told the background.
    const modes: KeysMode["mode"][] = [];
    const mode_windows: number[] = [];
    let time = 0;
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
        tab_kind_of: (window) => (window.in_mail_tab ? 0 : (window.tab_kind ?? 2)),
        list_port_of: (window) => (window.in_mail_tab ? (list_port_of ?? ((inner) => inner.port()))(window) : null),
        folder_port_of: ({ folder }) => folder && { row_count: () => folder.rows, selected_index: () => folder.selected, select: (index) => void (folder.selected = index) },
        is_typing_target: (window, event) => (event.target as { localName: string }).localName === "input" || window.body_script_live,
        menu_is_open: (window) => window.menu_open,
        in_reading_pane: (window) => window.in_reading_pane,
        on_tab_select: (window, listener) => {
            window.tab_listeners.add(listener);
            return () => void window.tab_listeners.delete(listener);
        },
        on_window_blur: (window, listener) => {
            window.blur_listeners.add(listener);
            return () => void window.blur_listeners.delete(listener);
        },
        window_id_of: (window) => 7 + windows.indexOf(window),
        now: () => time,
        emit: (event) => void ("keys" in event ? pending.push(event) : "mode" in event ? (modes.push(event.mode), mode_windows.push(event.windowId)) : emitted.push(event)),
    };
    return { modes, mode_windows, advance: (ms: number) => void (time += ms), windows, emitted, pending, runtime: create_runtime(deps), counts: () => ({ registers, unregisters }), load: (window: FakeWindow) => window_listener!.on_load_window(window), unload: (window: FakeWindow) => window_listener!.on_unload_window(window) };
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

const page_tree = () => ({
    version: COMPILED_KEYMAP_VERSION as typeof COMPILED_KEYMAP_VERSION,
    root: {
        kind: "branch",
        children: {
            q: leaf("tab.close", "background"),
            ":": leaf("cmdline.open", "background"),
            x: leaf("msg.archive", "background"),
            j: leaf("motion.down", "chrome"),
            g: { kind: "branch", children: { "?": leaf("help.open", "background"), g: leaf("motion.top", "chrome") } },
            "<A-q>": leaf("tab.close", "background"),
        },
    },
});

test("a readable tab runs q, : and g? and passes every other key", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(page_tree());
    const window = windows[0]!;
    window.in_mail_tab = false;
    window.tab_kind = 1;
    assert.equal(press(window, "q").cancelled, true);
    assert.equal(press(window, ":").cancelled, true);
    press(window, "g");
    assert.equal(press(window, "?").cancelled, true);
    assert.deepEqual(
        emitted.map((event) => [event.command, event.messageIds]),
        [["tab.close", []], ["cmdline.open", []], ["help.open", []]],
    );
    for (const key of ["x", "j", "z"]) assert.equal(press(window, key).cancelled, false, key);
    press(window, "g");
    assert.equal(press(window, "g").cancelled, false);
    assert.equal(emitted.length, 3);
    assert.equal(window.selected, 0);
});

test("a readable tab leaves q to a text field or an open menu", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(page_tree());
    const window = windows[0]!;
    window.in_mail_tab = false;
    window.tab_kind = 1;
    assert.equal(press(window, "q", { target: { localName: "input" } }).cancelled, false);
    window.menu_open = true;
    assert.equal(press(window, "q").cancelled, false);
    assert.equal(emitted.length, 0);
});

test("a remote tab runs a bound chord and passes plain keys, even q", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(page_tree());
    const window = windows[0]!;
    window.in_mail_tab = false;
    for (const key of ["q", ":", "x"]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(emitted.length, 0);
    assert.equal(press(window, "q", { altKey: true }).cancelled, true);
    assert.deepEqual(emitted.map((event) => event.command), ["tab.close"]);
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

    await assert.rejects(keys.install({ tree: { version: 0 as never, root: {} }, settings: {}, holdCommands: [] }), (error) => error instanceof StubExtensionError && /^keys\.install: keymap version 0/.test(error.message));

    await keys.install({ tree: tree(), settings: {}, holdCommands: [] });
    await keys.install({ tree: tree(), settings: {}, holdCommands: [] });
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

test("with the body script live, reading-pane keys are no longer swallowed and still run nothing in the list", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.in_reading_pane = true;
    window.body_script_live = true;
    for (const key of ["j", "x", "m", "G"]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(window.selected, 0);
    assert.deepEqual(emitted, []);
    // The fake window stands in for the focus check: with the flag off, a key in the list runs as before. That the flag is on only for a live message body under the focus is proved in focus.test.ts.
    window.in_reading_pane = false;
    window.body_script_live = false;
    assert.equal(press(window, "j").cancelled, true);
    assert.equal(window.selected, 1);
});

test("a half-typed sequence in the list does not finish after a visit to a live reading pane", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "d");
    window.in_reading_pane = true;
    window.body_script_live = true;
    press(window, "j");
    window.in_reading_pane = false;
    window.body_script_live = false;
    press(window, "d");
    assert.deepEqual(emitted, []);
});

test("with the folder pane focused the motions move the folder, while a background command still reads the thread list", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.folder = { rows: 5, selected: 2 };
    press(window, "j");
    assert.deepEqual([window.folder.selected, window.selected], [3, 0]);
    press(window, "k");
    press(window, "k");
    assert.equal(window.folder.selected, 1);
    press(window, "g");
    press(window, "g");
    assert.equal(window.folder.selected, 0);
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [100]);
    window.folder = null;
    press(window, "j");
    assert.equal(window.selected, 1);
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

test("a half-typed sequence does not survive a tab switch by mouse, by Ctrl+Tab or by a bound tab chord", () => {
    const switches: [string, (window: FakeWindow) => void][] = [
        ["a click on another tab and back", (window) => window.select_tab()],
        ["Ctrl+Tab", (window) => void press(window, "Tab", { ctrlKey: true })],
        ["Ctrl+PageDown", (window) => void press(window, "PageDown", { ctrlKey: true })],
        ["a bound tab chord", (window) => void press(window, "j", { ctrlKey: true })],
    ];
    for (const [name, switch_tab] of switches) {
        const { windows, emitted, runtime } = setup();
        runtime.install(chord_tree());
        const window = windows[0]!;
        press(window, "d");
        switch_tab(window);
        press(window, "d");
        const deletes = () => emitted.filter((invocation) => invocation.command === "msg.delete").length;
        assert.equal(deletes(), 0, `${name}: the second d starts over`);
        press(window, "d");
        assert.equal(deletes(), 1, `${name}: a fresh d d still deletes`);
    }
});

test("a tab switch also drops a pending count, and shutdown stops the listening", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "3");
    window.select_tab();
    press(window, "x");
    assert.equal(emitted[0]?.count, 1);
    runtime.shutdown();
    assert.equal(window.tab_listeners.size, 0);
});

test("a window blur drops a half-typed sequence and a pending count, and shutdown stops the listening", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "3");
    window.blur();
    press(window, "x");
    assert.equal(emitted[0]?.count, 1);
    press(window, "g");
    window.blur();
    press(window, "g");
    assert.equal(emitted.length, 1);
    runtime.shutdown();
    assert.equal(window.blur_listeners.size, 0);
});

test("the parent listens for TabSelect on each window and stops on shutdown", async () => {
    const window = new FakeWindow();
    const platform = stub_platform([window]);
    const keys_parent = await import("../src/chrome/parent_keys.ts");
    await keys_parent.get_keys_api({ extension: { windowManager: { getWrapper: () => ({ id: 1 }) }, messageManager: { convert: () => null } } }).keys.install({ tree: tree(), settings: {}, holdCommands: [] });
    assert.equal(window.tab_listeners.size, 1);
    assert.equal(window.blur_listeners.size, 1);
    keys_parent.shutdown();
    assert.equal(window.tab_listeners.size, 0);
    assert.equal(window.blur_listeners.size, 0);
    platform.restore();
});

test("the parent resets on a blur only when the window lost focus, not when focus moved inside it", async () => {
    const window = new FakeWindow();
    // A mail tab in front with a thread list, so the parent finds a list port and the keys run.
    const about_3pane = { threadTree: { currentIndex: 0 }, gDBView: { rowCount: 5, getSelectedMsgHdrs: () => [] } };
    window.document.getElementById = () => ({ currentTabInfo: { mode: { name: "mail3PaneTab" }, chromeBrowser: { contentWindow: about_3pane } } }) as never;
    const platform = stub_platform([window]);
    const keys_parent = await import("../src/chrome/parent_keys.ts");
    const keys = keys_parent.get_keys_api({ extension: { windowManager: { getWrapper: () => ({ id: 1 }) }, messageManager: { convert: () => null } } }).keys;
    const emitted: KeysInvocation[] = [];
    (keys.onInvocation as unknown as { subscribe(listener: (invocation: KeysInvocation) => void): void }).subscribe((invocation) => void ("keys" in invocation || emitted.push(invocation)));
    await keys.install({ tree: tree(), settings: {}, holdCommands: [] });
    press(window, "3");
    window.blur(false);
    press(window, "x");
    assert.equal(emitted[0]?.count, 3);
    press(window, "3");
    window.blur(true);
    press(window, "x");
    assert.equal(emitted[1]?.count, 1);
    keys_parent.shutdown();
    platform.restore();
});

test("an unloaded window stops listening while another keeps its listener", () => {
    const { windows, runtime, load, unload } = setup();
    runtime.install(tree());
    const other = new FakeWindow();
    load(other);
    unload(other);
    assert.equal(other.tab_listeners.size, 0);
    assert.equal(windows[0]!.tab_listeners.size, 1);
});

// The overlay takes the focus a round trip after the key that opens it. Plain keys typed in between are dropped, so they never act on the list.
test("after a hold command, plain keys are dropped until the focus reaches a text field", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    press(windows[0]!, ":");
    const dropped = ["j", "x"].map((key) => press(windows[0]!, key));
    assert.deepEqual(dropped.map((result) => result.cancelled), [true, true]);
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["cmdline.open"]);
    assert.equal(windows[0]!.selected, 0);
    // The focus arrives: a key from a text field ends the hold, and the next list key runs.
    press(windows[0]!, "a", { target: { localName: "input" } });
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 1);
});

test("the hold ends after its timeout", () => {
    const { windows, advance, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    press(windows[0]!, ":");
    advance(1400);
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 0);
    advance(200);
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 1);
});

test("a tab change ends the hold", () => {
    const { windows, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    press(windows[0]!, ":");
    windows[0]!.select_tab();
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 1);
});

test("named keys and chords pass during the hold, and other commands start no hold", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    press(windows[0]!, "x");
    assert.equal(press(windows[0]!, "j").cancelled, true);
    assert.equal(windows[0]!.selected, 1);
    press(windows[0]!, ":");
    assert.equal(press(windows[0]!, "Escape").cancelled, false);
    assert.equal(press(windows[0]!, "ArrowDown").cancelled, false);
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["msg.archive", "cmdline.open"]);
});

test("with no hold commands installed, a key after a background command runs at once", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, ":");
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 1);
});

test("shutdown clears the hold", () => {
    const { windows, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    press(windows[0]!, ":");
    runtime.shutdown();
    runtime.install(tree());
    press(windows[0]!, "j");
    assert.equal(windows[0]!.selected, 1);
});

test("a dot replays the last motion, and a count replaces the count it ran with", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "j");
    press(windows[0]!, ".");
    assert.equal(windows[0]!.selected, 2);
    press(windows[0]!, "3");
    press(windows[0]!, ".");
    assert.equal(windows[0]!.selected, 5);
    press(windows[0]!, "2");
    press(windows[0]!, "j");
    press(windows[0]!, ".");
    assert.equal(windows[0]!.selected, 9);
});

test("a dot replays a background command with the selection at the dot", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "r");
    windows[0]!.selected = 1;
    press(windows[0]!, ".");
    assert.deepEqual(emitted.map((invocation) => [invocation.command, invocation.messageIds]), [["msg.read", [100]], ["msg.read", [101]]]);
});

test("a dot never records itself and does nothing with no last run", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    assert.equal(press(windows[0]!, ".").cancelled, true);
    assert.deepEqual(emitted, []);
    press(windows[0]!, "r");
    press(windows[0]!, ".");
    press(windows[0]!, ".");
    assert.equal(emitted.length, 3);
});

test("a command marked unrepeatable is not replayed and clears the last run", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "j");
    press(windows[0]!, "D");
    press(windows[0]!, ".");
    assert.equal(windows[0]!.selected, 1);
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["msg.delete"]);
});

test("a dot that breaks a half-typed sequence ends it and then runs as a first key", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "j");
    press(windows[0]!, "g");
    press(windows[0]!, ".");
    assert.equal(windows[0]!.selected, 2);
    press(windows[0]!, "g");
    press(windows[0]!, "g");
    assert.equal(windows[0]!.selected, 0);
});

test("a tab switch ends a half-typed sequence but not the last run", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "j");
    press(windows[0]!, "g");
    windows[0]!.select_tab();
    press(windows[0]!, ".");
    assert.equal(windows[0]!.selected, 2);
});

// The real chain: the default keymap, the background's tagging, the runtime. A hand-built tree could not catch a tag that never reaches a leaf.
function default_tree(tag: boolean) {
    const root = JSON.parse(JSON.stringify(compile_default_keymap().compiled.modes.normal));
    if (tag) mark_unrepeatable(root);
    return { version: COMPILED_KEYMAP_VERSION as typeof COMPILED_KEYMAP_VERSION, root };
}

test("the default tree carries repeatable false on the leaves that snooze or undo, and not on delete or archive", () => {
    const { root } = default_tree(true);
    const step_of = (...keys: string[]) => keys.reduce((node, key) => node.children[key], root).steps[0];
    for (const keys of [["m", "z", "t"], ["u"]]) assert.equal(step_of(...keys).repeatable, false);
    for (const keys of [["d", "d"], ["x"], ["m", "r"]]) assert.equal(step_of(...keys).repeatable, undefined);
});

test("a dot after d d or x runs it again with its count, on the selection at the dot", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(default_tree(true));
    const window = windows[0]!;
    for (const [keys, command] of [[["3", "d", "d"], "msg.delete"], [["2", "x"], "msg.archive"]] as const) {
        for (const key of keys) press(window, key);
        window.selected += 1;
        press(window, ".");
        const [first, again] = emitted.splice(0);
        assert.equal(first?.command, command);
        assert.deepEqual([again?.command, again?.count], [command, first?.count], `a dot after ${keys.join(" ")}`);
        assert.notDeepEqual(again?.messageIds, first?.messageIds, "the dot reads the selection again");
    }
});

test("a dot after m z t or u runs nothing, even after a repeatable command", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(default_tree(true));
    for (const keys of [["m", "z", "t"], ["u"]]) {
        for (const key of ["m", "r"]) press(windows[0]!, key);
        for (const key of keys) press(windows[0]!, key);
        const before = emitted.length;
        press(windows[0]!, ".");
        assert.equal(emitted.length, before, `a dot after ${keys.join(" ")}`);
    }
});

test("visual mode: motions extend the range and a background command acts on it once", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    press(window, "v");
    press(window, "j");
    press(window, "j");
    assert.deepEqual(window.range, [2, 4]);
    press(window, "k");
    assert.deepEqual(window.range, [2, 3], "k shrinks the range back toward the anchor");
    press(window, "x");
    assert.deepEqual(emitted.map((invocation) => invocation.messageIds), [[102, 103]]);
    press(window, "j");
    assert.equal(window.range, null, "the command ended visual mode, so j moves one row again");
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [104]);
});

test("visual mode: a range runs through the anchor when it extends upward, and v again ends it on the current row", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 5;
    press(window, "v");
    press(window, "k");
    press(window, "k");
    assert.deepEqual(window.range, [3, 5]);
    press(window, "v");
    assert.equal(window.range, null);
    assert.equal(window.selected, 3);
});

test("visual mode: Escape ends it only while it is active", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 1;
    assert.equal(press(window, "Escape").cancelled, false, "Escape passes when visual mode is off");
    press(window, "v");
    press(window, "j");
    assert.equal(press(window, "Escape").cancelled, true);
    assert.equal(window.range, null);
    assert.equal(window.selected, 2);
    assert.equal(press(window, "Escape").cancelled, false, "and passes again afterwards");
});

test("visual mode: Escape in a text field passes and a tab change ends the mode", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "v");
    assert.equal(press(window, "Escape", { target: { localName: "input" } }).cancelled, false);
    window.select_tab();
    press(window, "j");
    assert.equal(window.range, null, "the tab change dropped visual mode");
});

test("visual mode is not a command that `.` replays", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "j");
    press(window, "v");
    press(window, ".");
    assert.equal(window.selected, 2, ". repeated j and not v");
    assert.deepEqual(window.range, [1, 2]);
});

test("the list port selects a range and makes its end the current row", () => {
    const tree_fake = { selectedIndex: 0, selectedIndices: [] as number[], currentIndex: 0 };
    const port = create_list_port({ gDBView: { rowCount: 9, getSelectedMsgHdrs: () => [] }, threadTree: tree_fake }, () => 1);
    port.select_range(5, 3);
    assert.deepEqual(tree_fake.selectedIndices, [3, 4, 5]);
    assert.equal(tree_fake.currentIndex, 3);
});

test("visual mode: a click on another row drops the mode, so j does not extend across the gap", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.rows = 50;
    window.selected = 2;
    press(window, "v");
    press(window, "j");
    window.selected = 20;
    window.range = null;
    press(window, "j");
    assert.equal(window.selected, 21);
    assert.equal(window.range, null, "the range did not reach back to the old anchor");
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [121]);
});

test("visual mode: rows that shift above the range drop the mode", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 5;
    press(window, "v");
    press(window, "j");
    // A message arrives at the top: Thunderbird keeps the selection on the same messages, one row lower.
    window.selected = 7;
    window.range = [6, 7];
    press(window, "j");
    assert.equal(window.range, null, "the old anchor row, now the message above the range, stays out");
    assert.equal(window.selected, 8);
});

test("visual mode: a change of folder drops the mode even when the current row is the same", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.rows = 50;
    window.selected = 40;
    press(window, "v");
    press(window, "j");
    window.view = {};
    window.range = null;
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [141], "x acts on the one row and not on a range over the new folder");
    press(window, "j");
    assert.equal(window.range, null);
});

test("visual mode: a command collapses the selection to the current row, and a key in a text field ends the mode", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    press(window, "v");
    press(window, "j");
    press(window, "x");
    assert.equal(window.range, null, "the range is gone once x has taken it");
    assert.equal(window.selected, 3);
    press(window, "v");
    press(window, "j");
    press(window, "a", { target: { localName: "input" } });
    press(window, "j");
    assert.equal(window.range, null, "a key that went to a text field ended the mode");
});

test("visual mode: a message inserted inside an upward range drops the mode", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.rows = 20;
    window.selected = 8;
    press(window, "v");
    press(window, "k");
    press(window, "k");
    assert.deepEqual(window.range, [6, 8]);
    // A message arrives at row 7. The anchor message moves to row 9 and the current row stays at 6.
    window.key_overrides = { 8: 7 };
    press(window, "k");
    assert.equal(window.range, null, "the range did not grow over the shifted rows");
    assert.equal(window.selected, 5);
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [105]);
});

test("visual mode: a message removed inside an upward range drops the mode", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.rows = 20;
    window.selected = 8;
    press(window, "v");
    press(window, "k");
    press(window, "k");
    window.key_overrides = { 8: 9 };
    press(window, "k");
    assert.equal(window.range, null);
    assert.equal(window.selected, 5);
});

const pending_keys = (pending: KeysPending[]) => pending.map((event) => event.keys.join(""));

test("a prefix key reports the typed keys, and finishing the sequence reports the end", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "d");
    assert.deepEqual(pending, [{ command: "pending", keys: ["d"], windowId: 7 }]);
    press(windows[0]!, "d");
    assert.deepEqual(pending_keys(pending), ["d", ""]);
});

test("keys that start no sequence report nothing, and a count alone reports nothing either", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "j");
    press(windows[0]!, "3");
    press(windows[0]!, "x");
    assert.deepEqual(pending, []);
});

test("a stray key cancels the sequence and reports the end once", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "g");
    press(windows[0]!, "z");
    press(windows[0]!, "z");
    assert.deepEqual(pending_keys(pending), ["g", ""]);
});

test("a count before a prefix key is left out of the typed keys", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "3");
    press(windows[0]!, "g");
    assert.deepEqual(pending_keys(pending), ["g"]);
});

test("a key that goes to a text field ends the sequence", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "d");
    press(windows[0]!, "d", { target: { localName: "input" } });
    assert.deepEqual(pending_keys(pending), ["d", ""]);
});

test("a dot replays a command and reports no pending keys", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(tree());
    press(windows[0]!, "j");
    press(windows[0]!, ".");
    assert.deepEqual(pending, []);
});

test("Escape in visual mode ends a half-typed sequence and reports the end", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    press(window, "v");
    press(window, "d");
    assert.deepEqual(pending_keys(pending).at(-1), "d");
    assert.equal(press(window, "Escape").cancelled, true);
    assert.deepEqual(pending_keys(pending).at(-1), "");
    assert.equal(window.range, null);
});

test("visual mode is told once on v and once when it ends, by Escape, v, a command, a tab change or a blur", () => {
    const { windows, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "j");
    assert.deepEqual(modes, [], "a motion tells nothing");
    press(window, "v");
    press(window, "j");
    assert.deepEqual(modes, ["visual"]);
    press(window, "Escape");
    assert.deepEqual(modes, ["visual", "normal"]);
    press(window, "v");
    press(window, "v");
    assert.deepEqual(modes.slice(2), ["visual", "normal"]);
    press(window, "v");
    press(window, "x");
    assert.equal(modes.at(-1), "normal");
    press(window, "v");
    window.select_tab();
    assert.equal(modes.at(-1), "normal");
    press(window, "v");
    window.blur();
    assert.equal(modes.at(-1), "normal");
    assert.equal(modes.length, 10);
});

test("visual mode that another window ends is reported to the window that started it", () => {
    const { windows, modes, mode_windows, runtime, load } = setup();
    runtime.install(tree());
    const other = new FakeWindow();
    windows.push(other);
    load(other);
    press(windows[0]!, "v");
    other.select_tab();
    assert.deepEqual(modes, ["visual", "normal"]);
    assert.deepEqual(mode_windows, [7, 7], "the end goes to the window that heard the start");
});
