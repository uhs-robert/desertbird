import assert from "node:assert/strict";
import { test } from "node:test";
import { create_page_runtime } from "../src/chrome/page_runtime.ts";
import type { ChildKey, PageDeps } from "../src/chrome/page_runtime.ts";
import type { KeydownEvent, KeyTarget, WindowListener } from "../src/chrome/runtime.ts";
import type { Situation } from "../src/chrome/readable_focus.ts";
import { compile_tab_keymap, compile_typing_keymap, page_message_tree } from "../src/background/commands/tab_keymaps.ts";
import { COMPILED_KEYMAP_VERSION } from "../src/shared/protocol.ts";
import type { KeysEvent, KeysInvocation, KeysPending } from "../src/shared/protocol.ts";

class FakeWindow {
    key_listeners = new Set<(event: KeydownEvent) => void>();
    bubble_listeners = new Set<(event: KeydownEvent) => void>();
    /** Stands in for Thunderbird's own handlers, which run between the capture and the bubble listeners of the runtime. */
    thunderbird_uses: ((event: KeydownEvent) => boolean) | null = null;
    blurs = 0;
    insert_window_ids: number[] = [];
    tab_listeners = new Set<() => void>();
    blur_listeners = new Set<() => void>();
    situation: Situation = "page";
    overlay_loading = false;
    /** Whether the page actor's child of the front tab takes the keys. */
    child_takes = false;
    pushed_insert: boolean[] = [];
    /** The target the runtime listens on, a stand-in for the window root. */
    root: KeyTarget = {
        addEventListener: (_type, listener, capture) => void (capture ? this.key_listeners : this.bubble_listeners).add(listener),
        removeEventListener: (_type, listener, capture) => void (capture ? this.key_listeners : this.bubble_listeners).delete(listener),
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
    if (window.thunderbird_uses?.(event)) event.defaultPrevented = true;
    if (!result.stopped) for (const listener of [...window.bubble_listeners]) listener(event);
    return result;
}

const tree_of = (result: ReturnType<typeof compile_tab_keymap>) => ({ version: COMPILED_KEYMAP_VERSION, root: JSON.parse(JSON.stringify(result.compiled.modes.normal)) as unknown });
const tree = (user?: Parameters<typeof compile_tab_keymap>[1]) => ({ page: tree_of(compile_tab_keymap("page", user)), message: page_message_tree(tree_of(compile_tab_keymap("message", user)) as never), typing: tree_of(compile_typing_keymap(user)) });

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
        blur_focused: (window) => void window.blurs++,
        child: () => ({
            takes_keys: (window) => (window as FakeWindow).child_takes,
            set_insert: (window, on) => void (window as FakeWindow).pushed_insert.push(on),
            scroll: () => false,
            blur: () => false,
        }),
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
    for (const key of ["x", "d", "o", "s"]) assert.equal(press(window, key).cancelled, false, key);
    assert.equal(press(window, "c", { ctrlKey: true }).cancelled, false);
    assert.equal(press(window, "x", { ctrlKey: true }).cancelled, false);
    press(window, "g");
    assert.equal(press(window, "x").cancelled, false, "g then an unbound key");
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


const reports = (events: KeysEvent[]) => events.filter((event) => "keys" in event).map((event) => (event as KeysPending).keys.join("") + ((event as KeysPending).root ? "!" : ""));

test("g ? asks for the root of the page tree, with no end before it, and the next key reports its end once", () => {
    const { windows, runtime, invocations, events, pending } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "g");
    press(window, "?");
    assert.deepEqual(invocations(), []);
    assert.deepEqual(reports(events), ["g", "!"]);
    assert.deepEqual([pending().at(-1)?.source, pending().at(-1)?.root], ["page", true]);
    press(window, "j");
    press(window, "j");
    assert.deepEqual(reports(events), ["g", "!", ""]);
    assert.equal(pending().at(-1)?.windowId, 7);
});

test("a key that extends the prefix sends no end event, and Escape after a prefix sends one", () => {
    const { windows, runtime, events } = setup();
    runtime.install(tree({ zab: { id: "page.scroll_down" } }));
    const window = windows[0]!;
    press(window, "z");
    press(window, "a");
    assert.deepEqual(reports(events), ["z", "za"]);
    press(window, "b");
    assert.deepEqual(reports(events), ["z", "za", ""]);
    press(window, "z");
    press(window, "Escape");
    assert.deepEqual(reports(events), ["z", "za", "", "z", ""]);
});

test("a tab change drops the armed end, so the next key in the new tab reports none", () => {
    const { windows, runtime, events } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "g");
    window.tab_listeners.forEach((listener) => listener());
    press(window, "j");
    assert.deepEqual(reports(events), ["g"]);
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

const modes = (events: KeysEvent[]) => events.filter((event) => event.command === "mode").map((event) => (event as { mode: string }).mode);

test("Escape in a text field is left to Thunderbird first and blurs in the bubble phase, once", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "field";
    const result = press(window, "Escape");
    assert.deepEqual(result, { cancelled: false, stopped: false });
    assert.equal(window.blurs, 1);
    assert.deepEqual(invocations(), []);
});

test("Escape that Thunderbird used (quick filter clear, inline edit cancel) does not blur", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "field";
    window.thunderbird_uses = (event) => event.key === "Escape";
    press(window, "Escape");
    assert.equal(window.blurs, 0);
    window.thunderbird_uses = null;
    press(window, "Escape");
    assert.equal(window.blurs, 1, "the next Escape is not held back");
});

test("Ctrl+[ leaves a field as Escape does", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "field";
    press(window, "[", { ctrlKey: true });
    assert.equal(window.blurs, 1);
    window.thunderbird_uses = () => true;
    press(window, "[", { ctrlKey: true });
    assert.equal(window.blurs, 1);
});

test("Escape outside a field and outside insert mode passes untouched and blurs nothing", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    assert.deepEqual(press(window, "Escape"), { cancelled: false, stopped: false });
    assert.equal(window.blurs, 0);
    assert.deepEqual(invocations(), []);
});

test("Alt+j and Alt+k in a field switch tab once each and stop the key, so no second handler runs", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "field";
    assert.deepEqual(press(window, "j", { altKey: true }), { cancelled: true, stopped: true });
    assert.deepEqual(press(window, "k", { altKey: true }), { cancelled: true, stopped: true });
    assert.deepEqual(invocations().map((event) => [event.command, event.windowId, event.messageIds]), [["tab.next", 7, []], ["tab.prev", 7, []]]);
    assert.equal(window.blurs, 0);
});

test("a plain key and any other chord typed in a field pass, and they end a half-typed sequence", () => {
    const { windows, runtime, invocations, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "field";
    for (const options of [{}, { ctrlKey: true }, { altKey: true }] as const) assert.equal(press(window, "q", options).cancelled, false);
    for (const key of ["j", "g", "i"]) assert.equal(press(window, key).cancelled, false, key);
    assert.deepEqual([invocations(), scrolls], [[], []]);
    window.situation = "page";
    press(window, "g");
    window.situation = "field";
    press(window, "x");
    window.situation = "page";
    press(window, "g");
    assert.deepEqual(scrolls, [], "g, a field key, then g is not gg");
});

test("the typing keys never run for the overlay's browser or a live message body, which are typing and no field", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "typing";
    assert.equal(press(window, "j", { altKey: true }).cancelled, false);
    press(window, "Escape");
    assert.equal(window.blurs, 0);
    assert.deepEqual(invocations(), []);
});

test("an open menu comes first: Escape and Alt+j in a field of a popup are the popup's", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "pass";
    press(window, "Escape");
    press(window, "j", { altKey: true });
    assert.equal(window.blurs, 0);
    assert.deepEqual(invocations(), []);
});

test("i starts insert mode: the label hears it, plain keys pass to the page, and Escape ends it and blurs", () => {
    const { windows, runtime, events, invocations, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    assert.equal(press(window, "i").cancelled, true);
    assert.deepEqual(modes(events), ["insert"]);
    for (const key of ["q", "j", "g", "i"]) assert.equal(press(window, key).cancelled, false, key);
    assert.deepEqual([invocations(), scrolls], [[], []]);
    assert.equal(press(window, "j", { altKey: true }).cancelled, true, "Alt+j still switches tab");
    assert.equal(invocations().length, 1);
    press(window, "Escape");
    assert.deepEqual(modes(events), ["insert", "normal"]);
    assert.equal(window.blurs, 0, "no text field had the focus, so the focused element (a remote browser, say) keeps it");
    press(window, "j");
    assert.deepEqual(scrolls, [["page.scroll_down", undefined]]);
});

test("Escape in insert mode blurs only when the key was typed in a text field", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "i");
    window.situation = "field";
    press(window, "Escape");
    assert.equal(window.blurs, 1);
    press(window, "i");
    window.situation = "remote";
    press(window, "Escape");
    assert.equal(window.blurs, 1);
});

test("a key typed in a field ends a half-typed sequence of the message tree too, so g, the find bar, then g is not gg", () => {
    const { windows, runtime, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "message";
    press(window, "g");
    window.situation = "field";
    press(window, "x");
    window.situation = "message";
    press(window, "g");
    assert.deepEqual(scrolls, []);
    press(window, "g");
    assert.equal(scrolls.length, 1, "a fresh g g still runs");
});

test("Escape that Thunderbird used keeps insert mode on", () => {
    const { windows, runtime, events } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "i");
    window.thunderbird_uses = () => true;
    press(window, "Escape");
    assert.deepEqual(modes(events), ["insert"]);
    assert.equal(press(window, "q").cancelled, false);
});

test("insert mode ends on a tab change and on a window blur, and says so", () => {
    const { windows, runtime, events, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "i");
    window.tab_listeners.forEach((listener) => listener());
    assert.deepEqual(modes(events), ["insert", "normal"]);
    press(window, "j");
    assert.equal(scrolls.length, 1);
    press(window, "i");
    window.blur_listeners.forEach((listener) => listener());
    assert.deepEqual(modes(events), ["insert", "normal", "insert", "normal"]);
    window.tab_listeners.forEach((listener) => listener());
    assert.equal(modes(events).length, 4, "no second report when insert is already off");
});

test("insert mode is per window: it neither reaches the other window nor ends with its Escape", () => {
    const { windows, runtime, events, scrolls } = setup(2);
    runtime.install(tree());
    const [first, second] = [windows[0]!, windows[1]!];
    press(first, "i");
    assert.equal(press(second, "j").cancelled, true, "the second window still scrolls");
    assert.equal(scrolls.length, 1);
    press(second, "Escape");
    assert.deepEqual(modes(events), ["insert"]);
    assert.equal(press(first, "q").cancelled, false, "the first window is still in insert mode");
    second.tab_listeners.forEach((listener) => listener());
    assert.equal(press(first, "q").cancelled, false);
    press(first, "Escape");
    assert.deepEqual(events.filter((event) => event.command === "mode").map((event) => [(event as { mode: string }).mode, event.windowId]), [["insert", 7], ["normal", 7]]);
});

test("a window that closes and a shutdown drop insert mode, so a window that opens later starts clean", () => {
    const { windows, runtime, events, unload, load } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    press(window, "i");
    unload(window);
    assert.deepEqual(modes(events), ["insert", "normal"]);
    load(window);
    assert.equal(press(window, "j").cancelled, true);
    press(window, "i");
    runtime.shutdown();
    runtime.install(tree());
    assert.equal(press(window, "j").cancelled, true, "a fresh runtime has no insert flag");
});

test("i in a remote page, a message tab or a menu is not insert mode", () => {
    const { windows, runtime, events } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "remote";
    assert.equal(press(window, "i").cancelled, false);
    window.situation = "pass";
    press(window, "i");
    window.situation = "typing";
    press(window, "i");
    assert.deepEqual(modes(events), []);
});

test("Escape, Ctrl+[ and the Alt keys follow a user binding of the layer", () => {
    const { windows, runtime, invocations } = setup();
    runtime.install(tree({ "<A-l>": { id: "tab.next" }, "<Escape>": null }));
    const window = windows[0]!;
    window.situation = "field";
    press(window, "l", { altKey: true });
    press(window, "Escape");
    assert.equal(invocations().length, 1);
    assert.equal(window.blurs, 0, "Escape was unbound");
    press(window, "[", { ctrlKey: true });
    assert.equal(window.blurs, 1);
});

/** A key as the page actor's parent hands it on: the child already cancelled it, so the event cancels nothing. */
function child_key(key: string, options: Partial<ChildKey> = {}): ChildKey {
    return { key, code: "", ctrlKey: false, altKey: false, metaKey: false, shiftKey: key.length === 1 && key !== key.toLowerCase(), field: false, target: null, preventDefault() {}, stopPropagation() {}, ...options };
}

test("a key of the page actor's child runs as the front tab's own: j scrolls, q closes, gg spans two keys", () => {
    const { windows, runtime, scrolls, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "remote";
    runtime.on_child_key(window, child_key("j"));
    runtime.on_child_key(window, child_key("g"));
    runtime.on_child_key(window, child_key("g"));
    runtime.on_child_key(window, child_key("q"));
    assert.deepEqual(scrolls.map(([id]) => id), ["page.scroll_down", "page.top"]);
    assert.deepEqual(invocations().map((event) => event.command), ["tab.close"]);
});

test("the chrome leaves a page whose child takes the keys alone: no cancel and no reset between the child's keys", () => {
    const { windows, runtime, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "remote";
    window.child_takes = true;
    // The chrome sees each key before the child's message arrives.
    assert.equal(press(window, "g").cancelled, false);
    runtime.on_child_key(window, child_key("g"));
    assert.equal(press(window, "g").cancelled, false);
    runtime.on_child_key(window, child_key("g"));
    assert.equal(press(window, "w", { ctrlKey: true }).cancelled, false, "a chord the keymap binds is the child's too");
    assert.deepEqual(scrolls.map(([id]) => id), ["page.top"]);
});

test("a remote page whose child does not take the keys (a frame, a page the actor does not match) keeps the close-only rule", () => {
    const { windows, runtime, scrolls, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "remote";
    assert.equal(press(window, "j").cancelled, false);
    assert.equal(press(window, "d", { ctrlKey: true }).cancelled, false);
    press(window, "q", { altKey: true });
    assert.deepEqual(scrolls, []);
    assert.deepEqual(invocations().map((event) => event.command), ["tab.close"]);
});

test("in a field of the page, only the typing keys run from the child", () => {
    const { windows, runtime, scrolls, invocations } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    runtime.on_child_key(window, child_key("j", { field: true }));
    runtime.on_child_key(window, child_key("j", { field: true, altKey: true }));
    assert.deepEqual(scrolls, []);
    assert.deepEqual(invocations().map((event) => event.command), ["tab.next"]);
});

test("Escape from the child blurs the page's field only when the page did not use it", () => {
    const { windows, runtime } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    runtime.on_child_key(window, child_key("Escape", { field: true, defaultPrevented: true }));
    assert.equal(window.blurs, 0);
    runtime.on_child_key(window, child_key("Escape", { field: true }));
    assert.equal(window.blurs, 1);
    runtime.on_child_key(window, child_key("Escape"));
    assert.equal(window.blurs, 1, "outside a field and outside insert mode Escape blurs nothing");
});

test("i from the child starts insert mode and pushes it to the children, and Escape ends it and pushes again", () => {
    const { windows, runtime, events, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    runtime.on_child_key(window, child_key("i"));
    assert.deepEqual(window.pushed_insert, [true]);
    // A stale child that still sends j finds insert mode on: the key runs no scroll.
    runtime.on_child_key(window, child_key("j"));
    assert.deepEqual(scrolls, []);
    runtime.on_child_key(window, child_key("Escape"));
    assert.deepEqual(window.pushed_insert, [true, false]);
    assert.deepEqual(modes(events), ["insert", "normal"]);
    assert.equal(window.blurs, 0, "no field had the focus");
});

test("a new page in the front tab ends insert mode, and a tab change pushes the end to the children", () => {
    const { windows, runtime, events } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    runtime.on_child_key(window, child_key("i"));
    runtime.on_child_key(window, null);
    assert.deepEqual(modes(events), ["insert", "normal"]);
    runtime.on_child_key(window, null);
    assert.deepEqual(window.pushed_insert, [true, false], "no push when insert mode is already off");
    runtime.on_child_key(window, child_key("i"));
    for (const listener of window.tab_listeners) listener();
    assert.deepEqual(window.pushed_insert, [true, false, true, false]);
});

test("a key of the child is dropped while the chrome passes every key (hint labels, an open menu)", () => {
    const { windows, runtime, scrolls } = setup();
    runtime.install(tree());
    const window = windows[0]!;
    window.situation = "pass";
    runtime.on_child_key(window, child_key("j"));
    assert.deepEqual(scrolls, []);
});

test("a key of the child for a window the runtime never hooked, or after shutdown, does nothing and throws nothing", () => {
    const { runtime, scrolls } = setup();
    const stranger = new FakeWindow();
    runtime.on_child_key(stranger, child_key("j"));
    runtime.install(tree());
    runtime.shutdown();
    runtime.on_child_key(stranger, child_key("j"));
    runtime.on_child_key(stranger, child_key("Escape"));
    assert.deepEqual(scrolls, []);
});
