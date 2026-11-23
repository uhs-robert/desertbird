import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPILED_KEYMAP_VERSION } from "../vendor/desertfox/prefix_tree.ts";
import { mark_steps } from "../src/background/config/keymap.ts";
import { compile_tab_keymap } from "../src/background/commands/tab_keymaps.ts";
import { registry } from "../src/background/commands/index.ts";
import { COMPOSE_CHROME_IDS, compose_token } from "../src/chrome/compose_runtime.ts";
import type { ComposeKeyEvent } from "../src/chrome/compose_runtime.ts";
import { get_composewin_api, shutdown } from "../src/chrome/parent_composewin.ts";
import type { KeysEvent } from "../src/shared/protocol.ts";
import { stub_platform } from "./chrome_stubs.ts";
import type { PlatformStub } from "./chrome_stubs.ts";

// The compose tree the background installs, compiled from the real defaults.
function compose_tree(user: Parameters<typeof compile_tab_keymap>[1] = {}) {
    const root = JSON.parse(JSON.stringify(compile_tab_keymap("compose", user).compiled.modes.normal));
    mark_steps(root);
    return { version: COMPILED_KEYMAP_VERSION, root };
}

type Listener = (event: ComposeKeyEvent) => void;

interface FakeElement {
    id: string;
    localName: string;
    popupOpen?: boolean;
    popup?: { state: string };
    in_pill?: boolean;
    closest?(selector: string): unknown;
}

// A compose window as the parent sees it: a window root that holds the key listeners, the focused element, the status bar, the Thunderbird globals for the jumps and the commands, and a timer queue the test runs by hand.
function compose_window(id: number) {
    const listeners = new Set<Listener>();
    const element = (element_id: string, localName: string): FakeElement => ({ id: element_id, localName, closest(selector: string) { return selector === "mail-address-pill" && this.in_pill ? {} : null; } });
    const fields = { to: element("toAddrInput", "input"), cc: element("ccAddrInput", "input"), bcc: element("bccAddrInput", "input"), subject: element("msgSubject", "input"), body: element("messageEditor", "editor"), from: element("msgIdentity", "menulist") };
    const bar_children: { id: string; textContent: string; style: { cssText: string }; remove(): void }[] = [];
    const status_bar = { append: (node: (typeof bar_children)[number]) => void bar_children.push(node) };
    const document = {
        activeElement: fields.body as FakeElement | null,
        documentElement: { getAttribute: () => "msgcompose" },
        getElementById: (wanted: string) => (wanted === "status-bar" ? status_bar : wanted === "msgSubject" ? { focus: () => void (document.activeElement = fields.subject) } : (bar_children.find((child) => child.id === wanted) ?? null)),
        createElementNS: () => {
            const node = { id: "", textContent: "", style: { cssText: "" }, remove: () => void bar_children.splice(bar_children.indexOf(node), 1) };
            return node;
        },
    };
    const commands: string[] = [];
    const timers: (() => void)[] = [];
    const revealed: string[] = [];
    const window = {
        id,
        windowRoot: { addEventListener: (_type: string, listener: Listener) => void listeners.add(listener), removeEventListener: (_type: string, listener: Listener) => void listeners.delete(listener) },
        document,
        focusMsgBody: () => void (document.activeElement = fields.body),
        showAndFocusAddressRow(row_id: string) {
            revealed.push(row_id);
            document.activeElement = { addressRowTo: fields.to, addressRowCc: fields.cc, addressRowBcc: fields.bcc }[row_id]!;
        },
        goDoCommand: (command: string) => void commands.push(command),
        setTimeout: (callback: () => void) => void timers.push(callback),
    };
    const press = (key: string, modifiers: Partial<ComposeKeyEvent> = {}) => {
        const event = { key, code: "", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, target: null, cancelled: false, preventDefault() { this.cancelled = true; }, stopPropagation() {}, ...modifiers };
        for (const listener of [...listeners]) listener(event);
        return event;
    };
    const run_timers = () => timers.splice(0).forEach((callback) => callback());
    const label = () => bar_children.find((child) => child.id === "desertbird-compose-mode")?.textContent ?? null;
    const focus = (name: keyof typeof fields) => void (document.activeElement = fields[name]);
    return { window, fields, press, run_timers, label, focus, commands, timers, revealed, listener_count: () => listeners.size, label_count: () => bar_children.length };
}

type FakeCompose = ReturnType<typeof compose_window>;

async function setup(open: FakeCompose[] = [compose_window(1)], { tree = compose_tree(), allow_send = false } = {}) {
    const platform = stub_platform(open.map((each) => each.window));
    const emitted: KeysEvent[] = [];
    const context = { extension: { windowManager: { getWrapper: (window: { id: number }) => ({ id: window.id }) }, messageManager: { convert: () => null } } };
    const api = get_composewin_api(context as never).composewin;
    (api.onInvocation as unknown as { subscribe(listener: (event: KeysEvent) => void): void }).subscribe((event) => void emitted.push(event));
    await api.install({ composeTree: tree as never, allowSend: allow_send });
    const listener = () => platform.window_listeners.get("desertbird@uhs-robert/composewin");
    return { api, platform, emitted, listener, done: () => (shutdown(), platform.restore()) };
}

const taken = (event: { cancelled: boolean }) => event.cancelled;
const passed = (event: { cancelled: boolean }) => !event.cancelled;

test("the windows open at the install are hooked once each, in insert mode, and the window listener reporting them again adds no listener", async () => {
    const a = compose_window(1);
    const b = compose_window(2);
    const { listener, platform, done } = await setup([a, b]);
    try {
        assert.equal(platform.register_calls, 1);
        assert.deepEqual(listener()?.chromeURLs, ["chrome://messenger/content/messengercompose/messengercompose.xhtml"]);
        listener()!.onLoadWindow(a.window);
        assert.deepEqual([a.listener_count(), b.listener_count()], [1, 1]);
        assert.deepEqual([a.label(), b.label(), a.label_count()], ["-- INSERT --", "-- INSERT --", 1]);
        assert.ok(passed(a.press("x")));
    } finally {
        done();
    }
});

test("a second install replaces the tree and adds no window listener and no key listener", async () => {
    const a = compose_window(1);
    const { api, platform, emitted, done } = await setup([a]);
    try {
        await api.install({ composeTree: compose_tree({ w: { id: "compose.save" } }) as never, allowSend: false });
        assert.equal(platform.register_calls, 1);
        assert.equal(a.listener_count(), 1);
        a.press("Escape");
        a.press("w");
        assert.deepEqual(emitted.map((event) => event.command), ["compose.save"]);
    } finally {
        done();
    }
});

test("a window opened later is hooked on load and unhooked on unload, which removes its listener and its label", async () => {
    const { listener, done } = await setup([]);
    try {
        const late = compose_window(5);
        listener()!.onLoadWindow(late.window);
        assert.equal(late.listener_count(), 1);
        late.press("Escape");
        assert.equal(late.label(), "-- NORMAL --");
        listener()!.onUnloadWindow(late.window);
        assert.deepEqual([late.listener_count(), late.label()], [0, null]);
    } finally {
        done();
    }
});

test("shutdown (disable, update) removes every key listener, every label and the window listener, and a key after it passes", async () => {
    const a = compose_window(1);
    const b = compose_window(2);
    const { platform, listener, done } = await setup([a, b]);
    a.press("Escape");
    shutdown();
    try {
        assert.deepEqual([a.listener_count(), b.listener_count(), a.label_count(), b.label_count()], [0, 0, 0, 0]);
        assert.equal(listener(), undefined);
        assert.ok(passed(a.press("x")));
        assert.equal(platform.register_calls, 1);
    } finally {
        done();
    }
});

test("an install after shutdown (re-enable) hooks the open windows again, once each, and every window starts in insert mode", async () => {
    const a = compose_window(1);
    const first = await setup([a]);
    a.press("Escape");
    first.done();
    const second = await setup([a]);
    try {
        assert.equal(second.platform.register_calls, 1);
        assert.deepEqual([a.listener_count(), a.label_count(), a.label()], [1, 1, "-- INSERT --"]);
        assert.ok(passed(a.press("x")));
    } finally {
        second.done();
    }
});

test("two windows keep separate modes, and closing one leaves the other's mode", async () => {
    const a = compose_window(1);
    const b = compose_window(2);
    const { listener, done } = await setup([a, b]);
    try {
        assert.ok(taken(a.press("Escape")));
        assert.ok(taken(a.press("x")));
        assert.ok(passed(b.press("x")));
        assert.deepEqual([a.label(), b.label()], ["-- NORMAL --", "-- INSERT --"]);
        b.press("Escape");
        a.press("i");
        assert.deepEqual([a.label(), b.label()], ["-- INSERT --", "-- NORMAL --"]);
        listener()!.onUnloadWindow(a.window);
        assert.ok(taken(b.press("x")));
        assert.equal(b.label(), "-- NORMAL --");
    } finally {
        done();
    }
});

test("a sequence typed half in one window and finished in another runs nothing", async () => {
    const a = compose_window(1);
    const b = compose_window(2);
    const { emitted, done } = await setup([a, b]);
    try {
        a.press("Escape");
        b.press("Escape");
        a.press("z");
        b.press("i");
        assert.deepEqual(emitted, []);
        assert.equal(b.label(), "-- INSERT --");
    } finally {
        done();
    }
});

test("one mode for the body and the fields: Escape in the body holds back letters in To and Subject, and i in a field types again everywhere", async () => {
    const a = compose_window(1);
    const { done } = await setup([a]);
    try {
        assert.ok(taken(a.press("Escape")));
        for (const field of ["to", "subject", "cc", "bcc", "body"] as const) {
            a.focus(field);
            assert.ok(taken(a.press("x")), field);
        }
        a.focus("subject");
        assert.ok(taken(a.press("i")));
        for (const field of ["to", "body"] as const) {
            a.focus(field);
            assert.ok(passed(a.press("x")), field);
        }
        a.focus("to");
        assert.ok(taken(a.press("Escape")));
        a.focus("body");
        assert.ok(taken(a.press("x")));
    } finally {
        done();
    }
});

test("From, the attachment list and every other place pass every key, Escape and the window keys too", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        a.press("Escape");
        a.focus("from");
        for (const key of ["x", "q", "Escape", "Enter", "i"]) assert.ok(passed(a.press(key)), key);
        a.window.document.activeElement = null;
        assert.ok(passed(a.press("q")));
        a.run_timers();
        assert.deepEqual([a.commands, emitted], [[], []]);
        a.focus("body");
        assert.equal(a.label(), "-- NORMAL --");
    } finally {
        done();
    }
});

test("in normal mode the body holds back every typing key, Tab and Shift+Tab included, and passes the caret, focus and unbound chords", async () => {
    const a = compose_window(1);
    const { done } = await setup([a]);
    try {
        a.press("Escape");
        for (const key of ["x", "7", ">", " ", "Enter", "Backspace", "Delete", "Tab"]) assert.ok(taken(a.press(key)), key);
        assert.ok(taken(a.press("Tab", { shiftKey: true })));
        assert.ok(taken(a.press("Enter", { shiftKey: true })));
        assert.ok(taken(a.press("X", { shiftKey: true })));
        for (const key of ["ArrowDown", "ArrowLeft", "Home", "F6", "PageDown"]) assert.ok(passed(a.press(key)), key);
        for (const [key, modifiers] of [["Enter", { ctrlKey: true }], ["s", { ctrlKey: true }], ["Tab", { ctrlKey: true }], ["c", { ctrlKey: true, shiftKey: true }], ["e", { ctrlKey: true }], ["v", { ctrlKey: true }]] as const) assert.ok(passed(a.press(key, modifiers)), key);
    } finally {
        done();
    }
});

test("in normal mode a field holds back letters, Enter and Backspace, and passes Tab and Shift+Tab, so a typed address still becomes a pill", async () => {
    const a = compose_window(1);
    const { done } = await setup([a]);
    try {
        a.press("Escape");
        for (const field of ["to", "subject"] as const) {
            a.focus(field);
            for (const key of ["x", " ", "Enter", "Backspace", "Delete"]) assert.ok(taken(a.press(key)), `${field} ${key}`);
            assert.ok(passed(a.press("Tab")), field);
            assert.ok(passed(a.press("Tab", { shiftKey: true })), field);
        }
    } finally {
        done();
    }
});

test("insert mode passes every key but Escape, in the body and in the fields", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        for (const field of ["body", "to", "subject"] as const) {
            a.focus(field);
            for (const key of ["q", "g", "t", "s", "e", "?", " ", "Enter", "Tab"]) assert.ok(passed(a.press(key)), `${field} ${key}`);
        }
        a.run_timers();
        assert.deepEqual([a.commands, emitted], [[], []]);
    } finally {
        done();
    }
});

test("Escape with an address popup open passes, so the popup closes, and the next Escape enters normal mode", async () => {
    const a = compose_window(1);
    const { done } = await setup([a]);
    try {
        a.focus("to");
        a.fields.to.popupOpen = true;
        assert.ok(passed(a.press("Escape")));
        assert.equal(a.label(), "-- INSERT --");
        a.fields.to.popupOpen = false;
        a.fields.to.popup = { state: "open" };
        assert.ok(passed(a.press("Escape")));
        a.fields.to.popup = { state: "closed" };
        assert.ok(taken(a.press("Escape")));
        assert.equal(a.label(), "-- NORMAL --");
    } finally {
        done();
    }
});

test("Escape in a pill being edited passes, so the pill goes back to its address, and the mode stays", async () => {
    const a = compose_window(1);
    const { done } = await setup([a]);
    try {
        a.window.document.activeElement = { id: "", localName: "input", in_pill: true, closest: a.fields.to.closest } as FakeElement;
        assert.ok(passed(a.press("Escape")));
        assert.equal(a.label(), "-- INSERT --");
    } finally {
        done();
    }
});

test("Escape in normal mode passes, so Thunderbird still closes the find bar or a notification, and ends a half-typed sequence", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        a.press("Escape");
        a.press("z");
        assert.ok(passed(a.press("Escape")));
        a.press("m");
        assert.deepEqual(emitted, []);
        assert.equal(a.label(), "-- NORMAL --");
    } finally {
        done();
    }
});

test("an IME composition is never touched: Escape and letters during it change no mode and run nothing", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        for (const key of ["Escape", "Process", "a"]) assert.ok(passed(a.press(key, { isComposing: true })), key);
        assert.equal(a.label(), "-- INSERT --");
        a.press("Escape");
        for (const key of ["q", "i", "Enter"]) assert.ok(passed(a.press(key, { isComposing: true })), key);
        a.run_timers();
        assert.deepEqual([a.label(), a.commands, emitted], ["-- NORMAL --", [], []]);
    } finally {
        done();
    }
});

test("the field jumps move the focus, and g c and g b reveal their row; the mode stays normal", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        a.press("Escape");
        const jumps = [["t", "toAddrInput"], ["c", "ccAddrInput"], ["b", "bccAddrInput"], ["s", "msgSubject"], ["m", "messageEditor"]] as const;
        for (const [key, id] of jumps) {
            assert.ok(taken(a.press("g")));
            assert.ok(taken(a.press(key)));
            assert.equal(a.window.document.activeElement?.id, id, key);
        }
        assert.deepEqual(a.revealed, ["addressRowTo", "addressRowCc", "addressRowBcc"]);
        assert.deepEqual(emitted, []);
        assert.equal(a.label(), "-- NORMAL --");
    } finally {
        done();
    }
});

test("i inside a half-typed sequence is a key of the sequence and does not enter insert mode", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        a.press("Escape");
        a.press("z");
        assert.ok(taken(a.press("i")));
        assert.deepEqual(emitted.map((event) => [event.command, "args" in event ? event.args : null]), [["zoom.by", { delta: 0.1 }]]);
        assert.equal(a.label(), "-- NORMAL --");
    } finally {
        done();
    }
});

test("q runs Thunderbird's close from a timer, never inside the key, so its save prompt cannot hold the key handler; a held q asks once", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        a.press("Escape");
        assert.ok(taken(a.press("q")));
        assert.ok(taken(a.press("q", { repeat: true })));
        assert.deepEqual(a.commands, []);
        assert.equal(a.timers.length, 1);
        a.run_timers();
        assert.deepEqual(a.commands, ["cmd_close"]);
        assert.deepEqual(emitted, []);
    } finally {
        done();
    }
});

test("the send key runs nothing while compose_send is off, its default, and is still held back", async () => {
    const a = compose_window(1);
    const { emitted, done } = await setup([a]);
    try {
        a.press("Escape");
        a.press("g");
        assert.ok(taken(a.press("S", { shiftKey: true })));
        a.run_timers();
        assert.deepEqual([a.commands, emitted], [[], []]);
    } finally {
        done();
    }
});

test("with compose_send on, g S runs Thunderbird's send with its checks, from a timer", async () => {
    const a = compose_window(1);
    const { api, done } = await setup([a], { allow_send: true });
    try {
        a.press("Escape");
        a.press("g");
        a.press("S", { shiftKey: true });
        assert.deepEqual(a.commands, []);
        a.run_timers();
        assert.deepEqual(a.commands, ["cmd_sendWithCheck"]);
        // Turning the setting off reinstalls with the flag off, and the key sends nothing again.
        await api.install({ composeTree: compose_tree() as never, allowSend: false });
        a.press("g");
        a.press("S", { shiftKey: true });
        a.run_timers();
        assert.deepEqual(a.commands, ["cmd_sendWithCheck"]);
    } finally {
        done();
    }
});

test("the background keys leave as invocations with the window id and no messages: s saves, e edits, ? opens help, z i zooms", async () => {
    const a = compose_window(7);
    const { emitted, done } = await setup([a]);
    try {
        a.press("Escape");
        for (const key of ["s", "e", "?", "z", "i"]) a.press(key);
        assert.deepEqual(emitted, [
            { command: "compose.save", args: {}, count: 1, windowId: 7, messageIds: [] },
            { command: "compose.edit_external", args: {}, count: 1, windowId: 7, messageIds: [] },
            { command: "help.open", args: {}, count: 1, windowId: 7, messageIds: [] },
            { command: "zoom.by", args: { delta: 0.1 }, count: 1, windowId: 7, messageIds: [] },
        ]);
    } finally {
        done();
    }
});

test("the body script and the chrome hook never both act on a key: the hook takes a body key at the window root, and Ctrl+E always passes to the script", async () => {
    // The window root sees a key before the body editor's window, where the compose script listens (measured). A key the hook takes stops there.
    const a = compose_window(1);
    const { done } = await setup([a]);
    try {
        for (const mode_key of [null, "Escape"]) {
            if (mode_key) a.press(mode_key);
            const ctrl_e = a.press("e", { ctrlKey: true });
            assert.ok(passed(ctrl_e), `Ctrl+E with ${mode_key ?? "insert"}`);
        }
        const letter = a.press("e");
        assert.ok(taken(letter));
    } finally {
        done();
    }
});

test("a user binding on a Ctrl+Shift chord matches the lower-case key Thunderbird reports with Shift held, and on Caps Lock too", async () => {
    assert.equal(compose_token({ key: "t", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as ComposeKeyEvent), "<CS-t>");
    assert.equal(compose_token({ key: "T", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as ComposeKeyEvent), "<CS-t>");
    assert.equal(compose_token({ key: "!", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as ComposeKeyEvent), "<C-!>");
    assert.equal(compose_token({ key: "Enter", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false } as ComposeKeyEvent), null);
    const a = compose_window(1);
    const { emitted, done } = await setup([a], { tree: compose_tree({ "<C-S-y>": { id: "compose.save" } }) });
    try {
        a.press("Escape");
        assert.ok(taken(a.press("y", { ctrlKey: true, shiftKey: true })));
        assert.deepEqual(emitted.map((event) => event.command), ["compose.save"]);
    } finally {
        done();
    }
});

test("a tree of another version fails the install and hooks nothing", async () => {
    const a = compose_window(1);
    const platform = stub_platform([a.window]);
    try {
        const api = get_composewin_api({ extension: { windowManager: { getWrapper: () => null }, messageManager: { convert: () => null } } } as never).composewin;
        await assert.rejects(api.install({ composeTree: { version: 1, root: { kind: "branch", children: {} } } as never, allowSend: false }), /composewin.install: keymap version 1/);
        assert.equal(a.listener_count(), 0);
    } finally {
        shutdown();
        platform.restore();
    }
});

test("every chrome command of the compose group is one the runtime runs", () => {
    const chrome_compose = registry.list().filter((command) => command.runs_in === "chrome" && command.id.startsWith("compose.")).map((command) => command.id).sort();
    assert.deepEqual(chrome_compose, [...COMPOSE_CHROME_IDS].sort());
});

test("shutdown with no install, and twice, is harmless", () => {
    const platform: PlatformStub = stub_platform([]);
    try {
        shutdown();
        shutdown();
        assert.equal(platform.window_listeners.size, 0);
    } finally {
        platform.restore();
    }
});
