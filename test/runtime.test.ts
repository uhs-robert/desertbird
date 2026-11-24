import assert from "node:assert/strict";
import { test } from "node:test";
import { is_typing_element } from "../src/chrome/focus.ts";
import { OVERLAY_BROWSER_ID, OVERLAY_LOADING_ID } from "../src/chrome/overlay_id.ts";
import { create_runtime } from "../src/chrome/runtime.ts";
import type { KeydownEvent, KeyTarget, RuntimeDeps, WindowListener } from "../src/chrome/runtime.ts";
import { compile_default_keymap } from "../src/background/commands/index.ts";
import { mark_steps } from "../src/background/config/keymap.ts";
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
    in_reading_pane = false;
    /** The folder tree rows and selection while the folder pane has the focus, or null. */
    folder: { rows: number; selected: number } | null = null;
    body_script_live = false;
    /** The focus sits in the overlay's browser and its page is not ready. */
    overlay_loading = false;
    /** The keys the open menu takes, or null with no menu open. */
    menu_keys: string[] | null = null;
    has_focus = true;
    /** The focus sits in a text field. */
    text_field = false;
    /** The count of ended hint picks the runtime reads through `hints_done_of`. */
    hints_done = 0;
    document = { getElementById: () => ({ tabInfo: [], currentTabInfo: null }), hasFocus: () => this.has_focus };
    /** The current row (Thunderbird's `currentIndex`). */
    cursor = 0;
    /** The selected rows, in ascending order. */
    chosen: number[] = [0];
    /** How many times the fake fired Thunderbird's `select` event: a change of the selection, never a move of the cursor alone. */
    select_events = 0;
    /** Called inside each `select` event, as Thunderbird's own listeners run inside the call that changes the selection. */
    on_select: () => void = () => {};
    /** The current row. Setting it from a test stands for a click: that row alone is selected. */
    get selected(): number {
        return this.cursor;
    }
    set selected(index: number) {
        this.cursor = index;
        this.chosen = [index];
    }
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
    /** The first and last selected rows, or null when one row or none is selected. Setting it selects that run of rows, and null selects the current row alone. */
    get range(): [number, number] | null {
        return this.chosen.length > 1 ? [this.chosen[0]!, this.chosen.at(-1)!] : null;
    }
    set range(span: [number, number] | null) {
        this.chosen = span ? Array.from({ length: span[1] - span[0] + 1 }, (_, offset) => span[0] + offset) : [this.cursor];
    }
    private choose(rows: number[]) {
        this.chosen = [...rows].sort((a, b) => a - b);
        this.select_events++;
        this.on_select();
    }
    /** What the list is showing: a new object stands for another folder, a rebuilt view. */
    view = {};
    /** The message key at a row where a test has inserted or removed a message. Other rows have their index as key. */
    key_overrides: Record<number, number> = {};
    port(): ListPort {
        const key_at = (index: number) => this.key_overrides[index] ?? index;
        return {
            marks: (rows) => [this.view, ...rows.map(key_at)],
            row_count: () => this.rows,
            selected_index: () => this.cursor,
            select: (index) => void ((this.cursor = index), this.choose([index])),
            selected_rows: () => [...this.chosen],
            select_rows: (rows, current) => {
                assert.equal(new Set(rows).size, rows.length, "a row listed twice would be toggled off again");
                this.choose(rows);
                this.cursor = current;
            },
            // Thunderbird moves the current row to the toggled row and fires `select` inside the call.
            toggle: (index) => void ((this.cursor = index), this.choose(this.chosen.includes(index) ? this.chosen.filter((row) => row !== index) : [...this.chosen, index])),
            move_cursor: (index) => void (this.cursor = index),
            selected_message_ids: () => this.chosen.map((row) => 100 + row),
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
    // The loading id on the target stands for a focus in the overlay browser whose page is not ready.
    window.overlay_loading = (event.target as { id?: string }).id === OVERLAY_LOADING_ID;
    for (const listener of [...window.listeners]) listener(event);
    return result;
}

const step = (id: string, runs_in: "chrome" | "background") => ({ invocation: { id }, runs_in, count_rule: "repeat" as const });
const leaf = (id: string, runs_in: "chrome" | "background") => ({ kind: "leaf" as const, steps: [step(id, runs_in)] });
const unrepeatable = (id: string) => ({ kind: "leaf" as const, steps: [{ ...step(id, "background"), repeatable: false }] });
const unrepeatable_chrome = (id: string) => ({ kind: "leaf" as const, steps: [{ ...step(id, "chrome"), repeatable: false }] });
const keeps_selection = (id: string) => ({ kind: "leaf" as const, steps: [{ ...step(id, "background"), keeps_selection: true }] });
const tree = () => ({
    version: COMPILED_KEYMAP_VERSION as typeof COMPILED_KEYMAP_VERSION,
    root: {
        kind: "branch",
        children: {
            j: leaf("motion.down", "chrome"),
            k: leaf("motion.up", "chrome"),
            x: leaf("msg.archive", "background"),
            f: leaf("hint.window", "background"),
            q: leaf("motion.sideways", "chrome"),
            ":": leaf("cmdline.open", "background"),
            ".": leaf("repeat.last", "chrome"),
            v: leaf("visual.toggle", "chrome"),
            "<Space>": unrepeatable_chrome("select.toggle"),
            w: { kind: "branch", children: { r: leaf("pane.resize_mode", "chrome") } },
            "<C-b>": { kind: "branch", children: { y: leaf("msg.read", "background") } },
            r: leaf("msg.read", "background"),
            "=": leaf("msg.sort", "background"),
            s: keeps_selection("msg.flag"),
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
        tab_kind_of: (window) => (window.in_mail_tab ? 0 : 1),
        list_port_of: (window) => (window.in_mail_tab ? (list_port_of ?? ((inner) => inner.port()))(window) : null),
        folder_port_of: ({ folder }) => folder && { row_count: () => folder.rows, selected_index: () => folder.selected, select: (index) => void (folder.selected = index) },
        is_typing_target: (window, event) => is_typing_element(event.target as { localName: string }) || window.body_script_live,
        menu_takes_key: (window, key) => window.menu_keys && window.menu_keys.includes(key.toLowerCase()),
        overlay_is_loading: (window) => window.overlay_loading,
        hints_done_of: (window) => window.hints_done,
        in_reading_pane: (window) => window.in_reading_pane,
        in_text_field: (window) => window.text_field,
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
    for (const key of ["Enter", "Escape", "ArrowDown", "Tab", "Backspace"]) assert.equal(press(window, key).cancelled, false, key);
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
            o: { kind: "leaf" as const, steps: [{ ...step("cmdline.open", "background"), invocation: { id: "cmdline.open", args: { text: "open " } } }] },
            j: leaf("motion.down", "chrome"),
            g: { kind: "branch", children: { "?": leaf("help.whichkey", "background"), g: leaf("motion.top", "chrome"), p: { kind: "branch", children: { a: leaf("motion.down", "chrome") } } } },
            "<A-q>": leaf("tab.close", "background"),
            "<C-c>": leaf("tab.close_mail", "background"),
        },
    },
});

test("outside the mail tab the key runtime runs nothing, a bound key and a close chord included, and drops a half-typed sequence", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "g");
    window.in_mail_tab = false;
    for (const key of ["q", ":", "x", "j"]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(press(window, "c", { ctrlKey: true }).cancelled, false);
    window.in_mail_tab = true;
    assert.equal(press(window, "g").cancelled, true, "the g typed before the tab change no longer counts");
    assert.equal(window.selected, 0);
    assert.deepEqual(emitted, []);
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
        ["a key in an open menu", (window) => ((window.menu_keys = []), press(window, "o")), (window) => void (window.menu_keys = null)],
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
    window.menu_keys = ["k"];
    assert.equal(press(window, "k").cancelled, false, "an access key of the menu passes to it");
    assert.equal(press(window, "K").cancelled, false, "also in upper case");
    for (const key of ["j", "x", "m", "a"]) assert.equal(press(window, key).cancelled, true, `${key} is swallowed, no item takes it`);
    for (const key of ["Enter", "ArrowDown", "Escape", " "]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(window.selected, 0);
    assert.deepEqual(emitted, []);
});

test("a key typed into a text field inside an open menu passes", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    windows[0]!.menu_keys = [];
    assert.equal(press(windows[0]!, "j", { target: { localName: "input" } }).cancelled, false);
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
        ["an open menu", (window) => ((window.menu_keys = []), press_ctrl(window, "c"))],
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

// Thunderbird moves the focus into an add-on's popup browser once the panel shows. DesertBird's own popup takes its keys there, and any other open panel keeps the swallow, so `j` never marks junk under it.
async function popup_parent(base_url: string | undefined) {
    const window = new FakeWindow();
    const about_3pane = { threadTree: { currentIndex: 0 }, gDBView: { rowCount: 5, getSelectedMsgHdrs: () => [] } };
    const focused: { active: unknown } = { active: null };
    Object.assign(window.document, {
        getElementById: () => ({ currentTabInfo: { mode: { name: "mail3PaneTab" }, chromeBrowser: { contentWindow: about_3pane } } }),
        querySelectorAll: () => [{ localName: "panel", state: "open" }],
    });
    Object.defineProperty(window.document, "activeElement", { get: () => focused.active });
    const platform = stub_platform([window]);
    const keys_parent = await import("../src/chrome/parent_keys.ts");
    const keys = keys_parent.get_keys_api({ extension: { ...(base_url === undefined ? {} : { baseURL: base_url }), windowManager: { getWrapper: () => ({ id: 1 }) }, messageManager: { convert: () => null } } }).keys;
    const emitted: KeysInvocation[] = [];
    (keys.onInvocation as unknown as { subscribe(listener: (invocation: KeysInvocation) => void): void }).subscribe((invocation) => void ("keys" in invocation || emitted.push(invocation)));
    await keys.install({ tree: tree(), settings: {}, holdCommands: [] });
    const cancelled = (active: unknown, key = "j") => {
        focused.active = active;
        return press(window, key, { target: active }).cancelled;
    };
    const stop = () => (keys_parent.shutdown(), platform.restore());
    return { cancelled, emitted, stop };
}

const OWN_BASE = "moz-extension://desertbird-uuid/";
const browser_at = (url: string, attributes: Record<string, string> = {}, id = "") => ({ localName: "browser", id, currentURI: { spec: url }, getAttribute: (name: string) => attributes[name] ?? null });
const popup_browser_at = (url: string) => browser_at(url, { "webextension-view-type": "popup" });

test("the parent lets plain keys through to DesertBird's own popup and swallows them under another add-on's popup or the app menu", async () => {
    const { cancelled, emitted, stop } = await popup_parent(OWN_BASE);
    assert.deepEqual(["j", "k", "o"].map((key) => cancelled(popup_browser_at(`${OWN_BASE}popup/popup.html`), key)), [false, false, false]);
    assert.equal(cancelled(popup_browser_at("moz-extension://other-uuid/popup.html")), true);
    assert.equal(cancelled({ localName: "toolbarbutton" }), true);
    assert.deepEqual(emitted, []);
    stop();
});

test("a DesertBird page browser that is no popup, the loading overlay included, keeps the swallow under an open panel", async () => {
    const { cancelled, emitted, stop } = await popup_parent(OWN_BASE);
    assert.equal(cancelled(browser_at(`${OWN_BASE}overlay/overlay.html`, {}, OVERLAY_LOADING_ID)), true);
    assert.equal(cancelled(browser_at(`${OWN_BASE}help/help.html`)), true);
    assert.deepEqual(emitted, []);
    stop();
});

test("with no base URL no popup counts as DesertBird's own", async () => {
    const { cancelled, stop } = await popup_parent(undefined);
    assert.equal(cancelled(popup_browser_at("undefinedpopup/popup.html")), true);
    stop();
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

// The mount focuses the overlay's browser about 3 ms after the colon, before its page exists. The browser has the loading id until the page is ready, and an unloaded page eats no key, so the key would reach Thunderbird's own shortcuts.
const in_loading_overlay = { target: { localName: "browser", id: OVERLAY_LOADING_ID } };
const in_ready_overlay = { target: { localName: "browser", id: OVERLAY_BROWSER_ID } };

test("keys typed while the overlay browser has the focus and its page is not ready are dropped, and the hold stays", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    const dropped = ["j", "x", "j"].map((key) => press(window, key, in_loading_overlay));
    assert.deepEqual(dropped.map((result) => result.cancelled), [true, true, true]);
    assert.equal(window.selected, 0);
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["cmdline.open"]);
});

test("once the overlay page is ready, its keys reach the line and the hold ends", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    press(window, "j", in_loading_overlay);
    assert.equal(press(window, "j", in_ready_overlay).cancelled, false, "the line takes the key");
    assert.equal(window.selected, 0);
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["cmdline.open"]);
    // The hold is over: with the focus back on the list, a key runs.
    press(window, "j");
    assert.equal(window.selected, 1);
});

test("a page that is never ready is never a typing target: plain keys stay dropped while the loading id lasts, even after the hold timer ran out", () => {
    const { windows, advance, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    advance(1600);
    assert.equal(press(window, "j", in_loading_overlay).cancelled, true);
    assert.equal(press(window, "a", in_loading_overlay).cancelled, true);
    advance(5000);
    assert.equal(press(window, "x", in_loading_overlay).cancelled, true);
    assert.equal(window.selected, 0);
    // The host closes the overlay and the focus is back on the list: keys run again.
    press(window, "j");
    assert.equal(window.selected, 1);
});

test("named keys and chords pass through a loading overlay, so Escape still closes it", () => {
    const { windows, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    assert.equal(press(window, "Escape", in_loading_overlay).cancelled, false);
    assert.equal(press(window, "x", { ...in_loading_overlay, ctrlKey: true }).cancelled, false);
});

test("an overlay that closes before its page is ready leaves the hold to run out", () => {
    const { windows, advance, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    press(window, "j", in_loading_overlay);
    // The overlay closes and the list has the focus again.
    assert.equal(press(window, "j").cancelled, true);
    assert.equal(window.selected, 0);
    advance(1600);
    press(window, "j");
    assert.equal(window.selected, 1);
});

test("a second colon while the first overlay is still loading restarts the hold for the second", () => {
    const { windows, emitted, advance, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    advance(1000);
    // The focus is in the loading overlay, so the colon is a dropped plain key: it opens nothing.
    assert.equal(press(window, ":", in_loading_overlay).cancelled, true);
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["cmdline.open"]);
    // The mount replaced the first overlay and the focus went back to the list, then a colon from there opens a second one.
    advance(600);
    press(window, ":");
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["cmdline.open", "cmdline.open"]);
    advance(1400);
    assert.equal(press(window, "j", in_loading_overlay).cancelled, true, "the second hold runs from the second colon");
    assert.equal(window.selected, 0);
    press(window, "j", in_ready_overlay);
    press(window, "j");
    assert.equal(window.selected, 1);
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

test("a window blur ends the hold, which is why the host keeps the mount's own blur from reaching the runtime", () => {
    const { windows, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    press(windows[0]!, ":");
    windows[0]!.blur();
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
    if (tag) mark_steps(root);
    return { version: COMPILED_KEYMAP_VERSION as typeof COMPILED_KEYMAP_VERSION, root };
}

test("the default tree carries repeatable false on the leaves that snooze or undo, and not on delete or archive", () => {
    const { root } = default_tree(true);
    const step_of = (...keys: string[]) => keys.reduce((node, key) => node.children[key], root).steps[0];
    for (const keys of [["m", "z", "t"], ["u"]]) assert.equal(step_of(...keys).repeatable, false);
    for (const keys of [["d", "d"], ["a"], ["m", "r"]]) assert.equal(step_of(...keys).repeatable, undefined);
});

test("a dot after d d or a runs it again with its count, on the selection at the dot", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(default_tree(true));
    const window = windows[0]!;
    for (const [keys, command] of [[["3", "d", "d"], "msg.delete"], [["2", "a"], "msg.archive"]] as const) {
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
    assert.deepEqual(window.range, [2, 3], "the command ended visual mode and kept the selection, for Thunderbird to replace once the rows go");
    // Thunderbird selects the next row once the archived rows leave the list.
    window.selected = 2;
    press(window, "j");
    assert.equal(window.range, null, "visual mode is off, so j moves one row");
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [103]);
});

test("visual mode: a range runs through the anchor when it extends upward, and v again ends it and keeps the range", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 5;
    press(window, "v");
    press(window, "k");
    press(window, "k");
    assert.deepEqual(window.range, [3, 5]);
    press(window, "v");
    assert.deepEqual(window.range, [3, 5]);
    assert.equal(window.selected, 3);
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [103, 104, 105], "the mode is off and the command still acts on the kept rows");
});

test("Escape ends visual mode and keeps the range, then a second Escape drops the range to the current row", () => {
    const { windows, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 1;
    assert.equal(press(window, "Escape").cancelled, false, "Escape passes with one row selected and no mode");
    press(window, "v");
    press(window, "j");
    assert.equal(press(window, "Escape").cancelled, true);
    assert.equal(modes.at(-1), "normal");
    assert.deepEqual(window.range, [1, 2], "leaving the mode kept the range");
    assert.equal(press(window, "Escape").cancelled, true, "Escape in normal mode takes a selection of two rows");
    assert.deepEqual([window.chosen, window.cursor], [[2], 2]);
    assert.equal(press(window, "Escape").cancelled, false, "and passes again with one row left");
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

test("Space: the first Space keeps the read row, j then moves only the cursor, and Space picks each row a command then acts on", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    assert.equal(press(window, " ").cancelled, true, "Space is swallowed, or Thunderbird would select the cursor row alone later");
    assert.deepEqual([window.chosen, window.select_events], [[2], 0], "the read row stays picked");
    press(window, "j");
    press(window, "j");
    assert.deepEqual([window.chosen, window.cursor], [[2], 4], "the pick of one row survives j");
    press(window, " ");
    press(window, "k");
    press(window, " ");
    assert.deepEqual([window.chosen, window.cursor], [[2, 3, 4], 3], "the cursor stays on the toggled row");
    press(window, " ");
    assert.deepEqual([window.chosen, window.cursor], [[2, 4], 3], "a second Space takes the row out");
    press(window, " ");
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [102, 103, 104]);
    window.selected = 3;
    press(window, "j");
    assert.deepEqual(window.chosen, [4], "the command removed rows and ended the pick, so j selects again");
});

test("Space: a pick of one row ends on Escape, a click, a tab change or a blur, and j selects again", () => {
    const ends: Record<string, (window: FakeWindow) => void> = {
        Escape: (window) => assert.equal(press(window, "Escape").cancelled, true, "Escape takes a pick of one row"),
        click: (window) => void (window.selected = 5),
        "tab change": (window) => window.select_tab(),
        blur: (window) => window.blur(),
        "reading pane": (window) => void ((window.in_reading_pane = true), press(window, "a"), (window.in_reading_pane = false)),
    };
    for (const [name, end] of Object.entries(ends)) {
        const { windows, runtime } = setup();
        runtime.install(tree());
        const window = windows[0]!;
        window.selected = 2;
        press(window, " ");
        press(window, "j");
        end(window);
        window.has_focus = true;
        const cursor = window.cursor;
        press(window, "j");
        assert.deepEqual(window.chosen, [cursor + 1], name);
    }
});

test("Space: a command that leaves the rows keeps the pick, and Escape then drops it to the current row", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 1;
    press(window, " ");
    press(window, "s");
    press(window, "j");
    press(window, " ");
    press(window, "r");
    assert.deepEqual(emitted.map((invocation) => invocation.messageIds), [[101], [101, 102]]);
    press(window, "j");
    assert.equal(press(window, "Escape").cancelled, true);
    assert.deepEqual([window.chosen, window.cursor], [[3], 3]);
    assert.equal(press(window, "Escape").cancelled, false, "with the pick gone, Escape is Thunderbird's again");
});

test("Space adds a row to a range that v kept, and a second v adds a range to the kept rows", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 1;
    press(window, "v");
    press(window, "j");
    press(window, "Escape");
    press(window, "j");
    press(window, "j");
    press(window, " ");
    assert.deepEqual(window.chosen, [1, 2, 4]);
    press(window, "j");
    press(window, "j");
    press(window, "v");
    press(window, "j");
    press(window, "v");
    assert.deepEqual(window.chosen, [1, 2, 4, 6, 7]);
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [101, 102, 104, 106, 107]);
});

test("Space does nothing in the folder pane or with no current row, and passes out of the mail tab", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    window.folder = { rows: 5, selected: 1 };
    press(window, " ");
    window.folder = null;
    press(window, "j");
    assert.deepEqual(window.chosen, [3], "Space in the folder pane started no pick");
    window.cursor = -1;
    window.chosen = [];
    assert.equal(press(window, " ").cancelled, true);
    assert.deepEqual(window.chosen, []);
    window.in_mail_tab = false;
    assert.equal(press(window, " ").cancelled, false);
});

test("Space: a message inserted above the picked rows ends the pick", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    press(window, " ");
    // Another message now sits at the picked row: the list changed under the pick while row numbers stayed.
    window.key_overrides = { 2: 99 };
    press(window, "j");
    assert.deepEqual(window.chosen, [3], "the pick ended, so j selects");
});

test("Space in visual mode leaves the mode and keeps the selection as a pick, like Escape", () => {
    const { windows, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    press(window, "v");
    press(window, "j");
    assert.equal(press(window, " ").cancelled, true);
    assert.equal(modes.at(-1), "normal");
    assert.deepEqual([window.chosen, window.cursor], [[2, 3], 3], "Space took no row out and the range stayed");
    press(window, "j");
    press(window, "j");
    assert.deepEqual([window.chosen, window.cursor], [[2, 3], 5], "j moved only the cursor, so nothing undid the range");
    press(window, " ");
    assert.deepEqual(window.chosen, [2, 3, 5], "the next Space toggles in normal mode");
});

test("leaving visual mode on one row keeps it as a pick, so j moves only the cursor", () => {
    for (const leave of ["v", "Escape", " "]) {
        const { windows, runtime } = setup();
        runtime.install(tree());
        const window = windows[0]!;
        window.selected = 2;
        press(window, "v");
        press(window, leave);
        press(window, "j");
        assert.deepEqual([window.chosen, window.cursor], [[2], 3], leave);
    }
});

test("a second visual mode never unselects a row selected before it opened", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 5;
    press(window, "v");
    press(window, "k");
    press(window, "k");
    press(window, "Escape");
    press(window, "k");
    press(window, "k");
    press(window, "v");
    for (const key of ["j", "j", "j", "j", "j", "j"]) press(window, key);
    assert.deepEqual(window.chosen, [1, 2, 3, 4, 5, 6, 7]);
    for (const key of ["k", "k", "k", "k", "k", "k"]) press(window, key);
    assert.deepEqual(window.chosen, [1, 3, 4, 5], "the range shrank back to its anchor and the rows kept before stayed");
    press(window, "v");
    assert.deepEqual(window.chosen, [1, 3, 4, 5]);
});

test("Space that leaves visual mode clears `.`, so a dot after it archives nothing", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "x");
    press(window, "v");
    press(window, " ");
    press(window, ".");
    assert.equal(emitted.length, 1);
});

test("a message inserted above a selected row ends visual mode, so the old base row never selects another message", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 5;
    press(window, " ");
    press(window, "k");
    press(window, "k");
    press(window, "v");
    // New mail sorts at row 4: the picked message moves to row 6, the same key now sits there, and row 5 holds another message.
    window.chosen = [6];
    window.key_overrides = { 4: 99, 5: 4, 6: 5 };
    press(window, "j");
    assert.deepEqual(window.chosen, [4], "visual mode ended, and with the pick gone j selects the row");
});

test("a message inserted inside an upward range, below the cursor, ends visual mode", () => {
    const { windows, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 5;
    press(window, "v");
    press(window, "k");
    press(window, "k");
    // New mail sorts at row 4: Thunderbird keeps the selected messages, now at rows 3, 5 and 6, and the anchor's message moves to row 6.
    window.chosen = [3, 5, 6];
    window.key_overrides = { 4: 99, 5: 4, 6: 5 };
    press(window, "k");
    assert.equal(modes.at(-1), "normal");
    assert.deepEqual(window.chosen, [3, 5, 6], "the stale anchor selected no range, and k moved only the cursor");
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

test("the list port selects rows and makes the given row current, toggles a row and moves the cursor alone", () => {
    const toggled: number[] = [];
    const tree_fake = { selectedIndex: 0, selectedIndices: [] as number[], currentIndex: 0, toggleSelectionAtIndex: (index: number) => void toggled.push(index) };
    const port = create_list_port({ gDBView: { rowCount: 9, getSelectedMsgHdrs: () => [], getKeyAt: (index) => 50 + index }, threadTree: tree_fake }, () => 1);
    port.select_rows([7, 3, 4, 5], 3);
    assert.deepEqual(port.selected_rows(), [7, 3, 4, 5]);
    assert.equal(tree_fake.currentIndex, 3);
    port.move_cursor(6);
    assert.deepEqual([tree_fake.currentIndex, tree_fake.selectedIndices], [6, [7, 3, 4, 5]]);
    port.toggle(6);
    assert.deepEqual(toggled, [6]);
    assert.deepEqual(port.marks([2, 8]).slice(1), [52, 58]);
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

test("visual mode: removing the unselected current row ends the mode, though every selected row is unchanged", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.chosen = [1];
    window.cursor = 5;
    press(window, "v");
    // Another message takes row 5 and the cursor stays on it.
    window.key_overrides[5] = 99;
    press(window, "j");
    assert.deepEqual(window.chosen, [6], "the mode ended, so j selected the next row alone and the old anchor and row 1 are gone");
});

test("the list port focuses the list body when it moves the cursor alone", () => {
    const calls: string[] = [];
    const tree_fake = { selectedIndex: 0, selectedIndices: [] as number[], currentIndex: 0, table: { body: { focus: () => void calls.push("focus") } } };
    const port = create_list_port({ gDBView: { rowCount: 9, getSelectedMsgHdrs: () => [], getKeyAt: (index) => index }, threadTree: tree_fake }, () => 1);
    port.move_cursor(4);
    assert.deepEqual([tree_fake.currentIndex, calls], [4, ["focus"]]);
    port.select(5);
    assert.deepEqual(calls, ["focus"], "a select does not take the focus");
});

test("visual mode: rows that shift above the range drop the mode", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 5;
    press(window, "v");
    press(window, "j");
    // A message arrives at the top: Thunderbird keeps the selection on the same messages, one row lower.
    window.cursor = 7;
    window.range = [6, 7];
    press(window, "j");
    assert.deepEqual(window.range, [6, 7], "the mode ended, so j moved only the cursor and the old anchor row did not join");
    assert.equal(window.cursor, 8);
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

test("visual mode: a command that removes the rows ends the mode without touching the selection, and a key in a text field ends the mode", () => {
    const { windows, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    press(window, "v");
    press(window, "j");
    const events = window.select_events;
    press(window, "x");
    assert.equal(modes.at(-1), "normal");
    assert.equal(window.select_events, events, "the runtime left the selection for Thunderbird to replace");
    window.selected = 2;
    press(window, "v");
    press(window, "j");
    press(window, "a", { target: { localName: "input" } });
    press(window, "j");
    assert.equal(modes.at(-1), "normal", "a key that went to a text field ended the mode");
    assert.deepEqual([window.range, window.cursor], [[2, 3], 4], "with two rows kept, j moved only the cursor");
});

test("visual mode: a command that leaves the rows keeps the range, and a delete still ends it", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.selected = 2;
    press(window, "v");
    press(window, "j");
    press(window, "s");
    assert.deepEqual(emitted.at(-1)?.messageIds, [102, 103]);
    assert.deepEqual(window.range, [2, 3], "the flag command kept the range");
    press(window, "s");
    assert.deepEqual(emitted.at(-1)?.messageIds, [102, 103], "a second command acts on the same range");
    press(window, "j");
    assert.deepEqual(window.range, [2, 4], "j still extends from the anchor");
    press(window, "d");
    press(window, "d");
    assert.deepEqual(emitted.at(-1)?.messageIds, [102, 103, 104]);
    press(window, "j");
    assert.deepEqual([window.range, window.cursor], [[2, 4], 5], "delete ended visual mode, so j moved only the cursor");
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
    assert.deepEqual(window.range, [6, 8], "the range did not grow over the shifted rows");
    assert.equal(window.cursor, 5);
    press(window, "x");
    assert.deepEqual(emitted.at(-1)?.messageIds, [106, 107, 108]);
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
    assert.deepEqual(window.range, [6, 8]);
    assert.equal(window.cursor, 5);
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

test("Backspace steps back one key at depth two, and a second Backspace after the sequence empties is not cancelled", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(page_tree());
    const window = windows[0]!;
    press(window, "g");
    press(window, "p");
    assert.equal(press(window, "Backspace").cancelled, true);
    assert.deepEqual(pending.at(-1)!.keys, ["g"]);
    assert.equal(press(window, "Backspace").cancelled, true);
    assert.deepEqual(pending.at(-1)!.keys, []);
    assert.equal(press(window, "Backspace").cancelled, false);
});

test("Backspace in a half-typed sequence goes back one key, cancelled, and shows the shorter prefix", () => {
    const { windows, pending, emitted, runtime } = setup();
    runtime.install(page_tree());
    const window = windows[0]!;
    press(window, "g");
    const before = pending.length;
    assert.equal(press(window, "Backspace").cancelled, true);
    assert.deepEqual(pending.slice(before).map((event) => event.keys), [[]]);
    press(window, "g");
    assert.equal(window.selected, 0, "the first g was dropped, so one g is not `g g`");
    press(window, "g");
    assert.equal(window.selected, 0, "g g from a clean start still runs");
    assert.equal(emitted.length, 0);
});

test("Backspace with no sequence goes to Thunderbird", () => {
    const { windows, pending, runtime } = setup();
    runtime.install(page_tree());
    const window = windows[0]!;
    assert.equal(press(window, "Backspace").cancelled, false);
    assert.deepEqual(pending.map((event) => event.keys).filter((keys) => keys.length > 0), []);
});

// Resize mode. `w r` starts it, and in it h l j k and = emit `pane.resize` and every other plain key is swallowed.
const enter_resize = (window: FakeWindow) => (press(window, "w"), press(window, "r"));
const resizes = (emitted: KeysInvocation[]) => emitted.filter((event) => (event.command as string) === "pane.resize").map((event) => [event.args, event.count]);

test("w r starts resize mode, which is told once, and h l j k = emit pane.resize with the direction", () => {
    const { windows, emitted, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    assert.deepEqual(modes, ["resize"]);
    for (const key of ["h", "l", "j", "k", "="]) assert.equal(press(window, key).cancelled, true, key);
    assert.deepEqual(resizes(emitted), [[{ direction: "left" }, 1], [{ direction: "right" }, 1], [{ direction: "down" }, 1], [{ direction: "up" }, 1], [{ direction: "reset" }, 1]]);
    assert.equal(window.selected, 0, "j did not move the list");
    assert.deepEqual(modes, ["resize"], "no second report while it stays on");
});

test("a count typed in the mode applies to the next move only", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    for (const key of ["1", "2", "l", "l", "0", "h", "3", "0", "k"]) press(window, key);
    assert.deepEqual(resizes(emitted), [[{ direction: "right" }, 12], [{ direction: "right" }, 1], [{ direction: "left" }, 1], [{ direction: "up" }, 30]]);
    for (const key of ["1", "2", "3", "4", "5", "6", "7", "j"]) press(window, key);
    assert.equal(resizes(emitted).at(-1)![1], 123456, "a count stops at six digits, as in normal mode, and the seventh digit is dropped");
    for (const key of ["1", "0", "0", "0", "l"]) press(window, key);
    assert.equal(resizes(emitted).at(-1)![1], 1000, "1000 is 1000, not a wrapped count");
});

test("every other plain key is swallowed and reaches nothing: no motion, no command, no half-typed sequence", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    for (const key of ["x", "d", "g", "v", "r", "w", ":", "m", "J"]) assert.equal(press(window, key).cancelled, true, key);
    assert.equal(emitted.length, 0);
    assert.equal(window.selected, 0);
    press(window, "Escape");
    press(window, "d");
    press(window, "d");
    assert.deepEqual(emitted.map((event) => event.command), ["msg.delete"], "no stale d from the mode");
});

test("Escape and Enter end the mode, are swallowed, and the label returns to normal", () => {
    for (const key of ["Escape", "Enter"]) {
        const { windows, emitted, modes, runtime } = setup();
        runtime.install(tree());
        const window = windows[0]!;
        enter_resize(window);
        assert.equal(press(window, key).cancelled, true, key);
        assert.deepEqual(modes, ["resize", "normal"], key);
        assert.equal(press(window, "j").cancelled, true);
        assert.equal(window.selected, 1, `${key}: j moves the list again`);
        assert.deepEqual(resizes(emitted), [], key);
        assert.equal(press(window, "Escape").cancelled, false, "Escape is Thunderbird's again");
    }
});

test("a count typed before Escape does not carry into the next mode", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    press(window, "5");
    press(window, "Escape");
    enter_resize(window);
    press(window, "l");
    assert.deepEqual(resizes(emitted), [[{ direction: "right" }, 1]]);
});

test("w r while in the mode does nothing more: it is one swallowed w and r, and the mode is told once", () => {
    const { windows, emitted, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    enter_resize(window);
    assert.deepEqual(modes, ["resize"]);
    assert.deepEqual(emitted, []);
    press(window, "Escape");
    assert.deepEqual(modes, ["resize", "normal"]);
    assert.equal(press(window, "Escape").cancelled, false, "one Escape ended it");
});

test("a tab change, a window blur and a closed window end the mode, and the label returns to normal", () => {
    const ends: [string, (window: FakeWindow) => void][] = [
        ["tab change", (window) => window.select_tab()],
        ["window blur", (window) => window.blur()],
    ];
    for (const [name, end] of ends) {
        const fixture = setup();
        fixture.runtime.install(tree());
        const window = fixture.windows[0]!;
        enter_resize(window);
        end(window);
        assert.deepEqual(fixture.modes, ["resize", "normal"], name);
        press(window, "l");
        assert.deepEqual(resizes(fixture.emitted), [], name);
    }
    const closing = setup();
    closing.runtime.install(tree());
    enter_resize(closing.windows[0]!);
    closing.unload(closing.windows[0]!);
    assert.deepEqual(closing.modes, ["resize", "normal"], "the closed window is told normal, so no state is left");
    const reopened = new FakeWindow();
    closing.windows.push(reopened);
    closing.load(reopened);
    press(reopened, "l");
    assert.deepEqual(resizes(closing.emitted), [], "the mode died with its window");
    assert.deepEqual(closing.modes, ["resize", "normal"]);
});

test("a text field, an open menu and a key in another window end the mode, and the key then runs as normal", () => {
    const text = setup();
    text.runtime.install(tree());
    enter_resize(text.windows[0]!);
    text.windows[0]!.text_field = true;
    assert.equal(press(text.windows[0]!, "l", { target: { localName: "input" } }).cancelled, false, "the key stays with the field");
    assert.deepEqual([text.modes, resizes(text.emitted)], [["resize", "normal"], []]);

    const menu = setup();
    menu.runtime.install(tree());
    enter_resize(menu.windows[0]!);
    menu.windows[0]!.menu_keys = [];
    press(menu.windows[0]!, "l");
    assert.deepEqual([menu.modes, resizes(menu.emitted)], [["resize", "normal"], []]);

    const other = setup();
    other.runtime.install(tree());
    const second = new FakeWindow();
    other.windows.push(second);
    other.load(second);
    enter_resize(other.windows[0]!);
    press(second, "l");
    assert.deepEqual(other.modes, ["resize", "normal"]);
    assert.deepEqual(other.mode_windows, [7, 7]);
    assert.deepEqual(resizes(other.emitted), []);
});

test("a chord runs as in normal mode and the mode stays, so the mode follows the focus to another pane", () => {
    const { windows, emitted, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    assert.equal(press(window, "ArrowDown").cancelled, false, "a named key goes to Thunderbird");
    assert.equal(press(window, "l", { ctrlKey: true }).cancelled, false);
    assert.deepEqual(modes, ["resize"]);
    press(window, "l");
    assert.deepEqual(resizes(emitted), [[{ direction: "right" }, 1]]);
});

test("the mode works with the focus in the message body, where the body script would take the key", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    window.in_reading_pane = true;
    window.body_script_live = true;
    assert.equal(press(window, "l").cancelled, true);
    assert.deepEqual(resizes(emitted), [[{ direction: "right" }, 1]]);
});

test("visual mode ends when resize mode starts, and the label reports resize then normal", () => {
    const { windows, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "v");
    press(window, "j");
    enter_resize(window);
    assert.deepEqual(modes, ["visual", "resize"]);
    press(window, "Escape");
    assert.deepEqual(modes, ["visual", "resize", "normal"]);
    assert.deepEqual(window.range, [0, 1], "the range stays");
});

test("shutdown ends the mode", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree());
    enter_resize(windows[0]!);
    runtime.shutdown();
    runtime.install(tree());
    press(windows[0]!, "l");
    assert.deepEqual(resizes(emitted), []);
});

test("a chord prefix typed in the mode does not complete after Escape or Enter, and its pending report is cleared", () => {
    for (const key of ["Escape", "Enter"]) {
        const { windows, emitted, pending, runtime } = setup();
        runtime.install(tree());
        const window = windows[0]!;
        enter_resize(window);
        press(window, "b", { ctrlKey: true });
        assert.deepEqual(pending.at(-1)!.keys, ["<C-b>"], "the chord waits for its second key");
        press(window, key);
        assert.deepEqual(pending.at(-1)!.keys, [], `${key} clears the pending report`);
        press(window, "y");
        assert.equal(emitted.length, 0, `${key}: the y after the mode does not complete <C-b> y`);
    }
});

test("a text field inside the reading pane ends the mode, while the body script alone does not", () => {
    const { windows, emitted, modes, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    enter_resize(window);
    window.in_reading_pane = true;
    window.body_script_live = true;
    press(window, "l");
    assert.deepEqual(modes, ["resize"], "the body script is no text field");
    window.text_field = true;
    assert.equal(press(window, "l").cancelled, false, "the key stays with the field");
    assert.deepEqual(modes, ["resize", "normal"]);
    assert.deepEqual(resizes(emitted), [[{ direction: "right" }, 1]]);
});

test("a plain key in another window ends the mode even while that window's overlay is loading", () => {
    const loading = setup();
    loading.runtime.install(tree());
    const second = new FakeWindow();
    loading.windows.push(second);
    loading.load(second);
    enter_resize(loading.windows[0]!);
    second.overlay_loading = true;
    press(second, "j");
    assert.deepEqual(loading.modes, ["resize", "normal"]);
});

test("a key in another window whose front tab is not the mail tab ends the mode", () => {
    const { windows, modes, mode_windows, load, runtime } = setup();
    runtime.install(tree());
    const second = new FakeWindow();
    second.in_mail_tab = false;
    windows.push(second);
    load(second);
    enter_resize(windows[0]!);
    press(second, "j");
    assert.deepEqual(modes, ["resize", "normal"]);
    assert.deepEqual(mode_windows, [7, 7], "the end goes to the window that heard the start");
});

test("a mode that starts in another window clears the old window's mode first", () => {
    const { windows, modes, mode_windows, load, runtime } = setup();
    runtime.install(tree());
    const second = new FakeWindow();
    second.view = windows[0]!.view;
    windows.push(second);
    load(second);
    press(windows[0]!, "v");
    assert.deepEqual([modes, mode_windows], [["visual"], [7]]);
    enter_resize(second);
    assert.deepEqual([modes, mode_windows], [["visual", "normal", "resize"], [7, 7, 8]], "window 7 is cleared, window 8 shows resize");
    press(second, "Escape");
    assert.deepEqual([modes.at(-1), mode_windows.at(-1)], ["normal", 8]);
});

test("f held the plain keys, and once its labels are done a second f emits a second hint.window", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree(), ["hint.window"]);
    const window = windows[0]!;
    press(window, "f");
    assert.equal(press(window, "f").cancelled, true, "the hold swallows a key typed before the labels end");
    window.hints_done++;
    press(window, "f");
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["hint.window", "hint.window"]);
});

test("a labels-done mark from before the hold started does not end it", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree(), ["hint.window"]);
    const window = windows[0]!;
    window.hints_done = 3;
    press(window, "f");
    press(window, "f");
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["hint.window"]);
});

test("a labels-done mark bumped during a command line hold does not end it", () => {
    const { windows, emitted, runtime } = setup();
    runtime.install(tree(), ["cmdline.open"]);
    const window = windows[0]!;
    press(window, ":");
    window.hints_done++;
    assert.equal(press(window, "j").cancelled, true, "the hold still swallows the key");
    assert.deepEqual(emitted.map((invocation) => invocation.command), ["cmdline.open"]);
});
