import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPILED_KEYMAP_VERSION } from "../vendor/desertfox/prefix_tree.ts";
import { start_body_script } from "../src/content/body_keys.ts";
import type { BodyKeyEvent, BodyRuntime, BodyStorage, BodyWindow } from "../src/content/body_keys.ts";
import { compile_tab_keymap, message_background_commands } from "../src/background/commands/tab_keymaps.ts";
import { compile_effective_keymap } from "../src/background/config/keymap.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE, KEYMAP_STORAGE_KEY, MESSAGE_SCROLL_STEP_PX, SETTINGS_STORAGE_KEY } from "../src/shared/protocol.ts";
import type { HintAction } from "../src/shared/protocol.ts";

const VIEWPORT = 600;
const PAGE_HEIGHT = 5000;

/** A link or button of the stub document. `focuses` counts the focus calls it got. `style` is what the computed style gives. */
class StubElement {
    focuses = 0;
    clicks = 0;
    box: { top: number; left: number; width: number; height: number };
    style = { display: "inline", visibility: "visible", opacity: "1" };
    constructor(box = { top: 10, left: 10, width: 50, height: 12 }, style: Partial<StubElement["style"]> = {}) {
        this.box = box;
        Object.assign(this.style, style);
    }
    getBoundingClientRect() {
        return this.box;
    }
    contains(other: unknown) {
        return other === this;
    }
    focus() {
        this.focuses++;
    }
    click() {
        this.clicks++;
    }
    matches() {
        return true;
    }
}

class StubNode {
    textContent: string | null = null;
    style = { cssText: "" };
    children: StubNode[] = [];
    removed = false;
    shadow_mode: string | null = null;
    attachShadow(init: { mode: "closed" }) {
        this.shadow_mode = init.mode;
        return this;
    }
    append(...children: StubNode[]) {
        this.children.push(...children);
    }
    remove() {
        this.removed = true;
    }
}

/** The text of the stub message, for `find`: the matches are the indexes of the pattern, and the position is the match last selected. */
class StubWindow implements BodyWindow {
    elements: StubElement[] = [];
    appended: StubNode[] = [];
    text = "";
    at = -1;
    finds: string[] = [];
    selection_cleared = 0;
    focused = 0;
    innerWidth = 800;
    find(pattern: string, case_sensitive: boolean, backwards: boolean, wrap: boolean): boolean {
        this.finds.push(`${pattern} ${case_sensitive ? "cs" : "ci"} ${backwards ? "back" : "fwd"} ${wrap ? "wrap" : "nowrap"}`);
        const text = case_sensitive ? this.text : this.text.toLowerCase();
        const needle = case_sensitive ? pattern : pattern.toLowerCase();
        const starts: number[] = [];
        for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) starts.push(index);
        if (starts.length === 0) return false;
        const after = backwards ? starts.filter((start) => start < this.at) : starts.filter((start) => start > this.at);
        const pool = after.length > 0 ? after : wrap ? starts : [];
        if (pool.length === 0) return false;
        this.at = backwards ? pool[pool.length - 1]! : pool[0]!;
        return true;
    }
    getSelection() {
        return {
            removeAllRanges: () => {
                this.selection_cleared++;
                this.at = -1;
            },
            selectAllChildren: () => void 0,
            collapseToEnd: () => void (this.at = this.text.length),
        };
    }
    focus() {
        this.focused++;
    }

    listeners: ((event: BodyKeyEvent) => void)[] = [];
    scrolls: string[] = [];
    attributes = new Map<string, string>();
    innerHeight = VIEWPORT;
    document = {
        querySelectorAll: (_selector: string) => this.elements,
        elementFromPoint: (x: number, y: number) => this.elementFromPoint(x, y),
        createElement: (_name: string) => new StubNode(),
        body: {},
        documentElement: {
            append: (child: StubNode) => void this.appended.push(child),
            scrollHeight: PAGE_HEIGHT,
            setAttribute: (name: string, value: string) => void this.attributes.set(name, value),
            removeAttribute: (name: string) => void this.attributes.delete(name),
        },
    };
    other_listeners: Record<string, (() => void)[]> = {};
    addEventListener(type: string, listener: (event: BodyKeyEvent) => void) {
        if (type === "keydown") this.listeners.push(listener);
        else (this.other_listeners[type] ??= []).push(listener as () => void);
    }
    fire(type: string) {
        for (const listener of this.other_listeners[type] ?? []) listener();
    }
    getComputedStyle(element: StubElement) {
        return element.style;
    }
    // The last element drawn at the point that a mouse can hit: `visibility: hidden` is not hit, `opacity: 0` is.
    elementFromPoint(x: number, y: number) {
        return [...this.elements].reverse().find((element) => element.style.visibility === "visible" && x >= element.box.left && x <= element.box.left + element.box.width && y >= element.box.top && y <= element.box.top + element.box.height) ?? null;
    }
    removeEventListener() {}
    scrollBy(options: { top?: number; left?: number }) {
        this.scrolls.push(options.left === undefined ? `by ${options.top}` : `by left ${options.left}`);
    }
    scrollTo(options: { top: number }) {
        this.scrolls.push(`to ${options.top}`);
    }
    press(key: string, options: Partial<BodyKeyEvent> = {}): { cancelled: boolean; stopped: boolean } {
        const result = { cancelled: false, stopped: false };
        const event: BodyKeyEvent = {
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
        for (const listener of this.listeners) listener(event);
        return result;
    }
}

/** The runtime of the stub: it records what the script sends and keeps the listener the script adds. */
function stub_runtime() {
    const sent: unknown[] = [];
    const reports: string[][] = [];
    const trees: unknown[] = [];
    let listener: ((message: unknown) => Promise<{ found: boolean }> | undefined) | undefined;
    const runtime: BodyRuntime = {
        sendMessage: async (message) => void (message.type === "body.pending" ? (reports.push(message.keys), trees.push(message.tree)) : sent.push(message)),
        onMessage: { addListener: (added) => void (listener = added) },
    };
    return { runtime, sent, reports, trees, receive: (message: unknown) => listener?.(message) };
}

function stub_storage(stored: Record<string, unknown>) {
    const change_listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
    const storage: BodyStorage = {
        get: async (keys) => Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, stored[key]])),
        onChanged: { addListener: (listener) => void change_listeners.push(listener) },
    };
    return { storage, change: (value: unknown, area = "local", key = KEYMAP_STORAGE_KEY) => change_listeners.forEach((listener) => listener({ [key]: { newValue: value } }, area)) };
}

/** The record the background stores, with the message tree compiled from the real default keys. */
function record() {
    const root = JSON.parse(JSON.stringify(compile_tab_keymap("message").compiled.modes.normal)) as unknown;
    return { message_tree: { version: COMPILED_KEYMAP_VERSION, root } };
}

async function started(stored: Record<string, unknown> = { [KEYMAP_STORAGE_KEY]: record() }, own_page = false, parent_pick?: (action: HintAction | undefined) => Promise<number>) {
    const window = new StubWindow();
    const { storage, change } = stub_storage(stored);
    const { runtime, sent, reports, receive } = stub_runtime();
    await (own_page ? start_body_script(window, storage, runtime, (element) => element.click()) : start_body_script(window, storage, runtime, undefined, "message_tree", parent_pick));
    return { window, change, sent, reports, receive };
}

/** The answer of the parent's pick, or of the default that sends every pick back to the body, arrives after the key. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("j and k scroll by a fixed line step and are cancelled", async () => {
    const { window } = await started();
    assert.deepEqual(window.press("j"), { cancelled: true, stopped: true });
    window.press("k");
    assert.deepEqual(window.scrolls, [`by ${MESSAGE_SCROLL_STEP_PX}`, `by ${-MESSAGE_SCROLL_STEP_PX}`]);
});

test("a count multiplies the line step", async () => {
    const { window } = await started();
    window.press("5");
    window.press("j");
    window.press("1");
    window.press("2");
    window.press("k");
    assert.deepEqual(window.scrolls, [`by ${5 * MESSAGE_SCROLL_STEP_PX}`, `by ${-12 * MESSAGE_SCROLL_STEP_PX}`]);
});

test("Ctrl+f and Ctrl+b scroll a page, and h and l scroll 50 pixels sideways, with a count", async () => {
    const { window } = await started();
    assert.equal(window.press("f", { ctrlKey: true }).cancelled, true);
    window.press("b", { ctrlKey: true });
    window.press("h");
    window.press("3");
    window.press("l");
    assert.deepEqual(window.scrolls, [`by ${VIEWPORT}`, `by ${-VIEWPORT}`, "by left -50", "by left 150"]);
});

test("Ctrl+d and Ctrl+u scroll half a page, with a count", async () => {
    const { window } = await started();
    assert.equal(window.press("d", { ctrlKey: true }).cancelled, true);
    window.press("u", { ctrlKey: true });
    window.press("2");
    window.press("d", { ctrlKey: true });
    assert.deepEqual(window.scrolls, [`by ${VIEWPORT / 2}`, `by ${-VIEWPORT / 2}`, `by ${VIEWPORT}`]);
});

test("g g goes to the top and G to the bottom", async () => {
    const { window } = await started();
    window.press("g");
    assert.deepEqual(window.scrolls, []);
    window.press("g");
    window.press("G");
    assert.deepEqual(window.scrolls, ["to 0", `to ${PAGE_HEIGHT}`]);
});

test("Escape ends a half-typed sequence and a count, and is not cancelled", async () => {
    const { window } = await started();
    window.press("g");
    assert.equal(window.press("Escape").cancelled, false);
    window.press("g");
    window.press("3");
    window.press("Escape");
    window.press("j");
    assert.deepEqual(window.scrolls, [`by ${MESSAGE_SCROLL_STEP_PX}`]);
});

test("an unbound plain key is swallowed so Thunderbird's single-key shortcuts do not fire, and runs nothing", async () => {
    const { window } = await started();
    for (const key of ["a", "#", "z", "i"]) assert.deepEqual(window.press(key), { cancelled: true, stopped: true }, key);
    assert.deepEqual(window.scrolls, []);
});

test("named keys and unbound chords pass, a bound chord is cancelled", async () => {
    const { window } = await started();
    for (const key of ["Enter", "ArrowDown", "Tab", " ", "PageDown"]) assert.equal(window.press(key).cancelled, false, key);
    assert.equal(window.press("c", { ctrlKey: true }).cancelled, false);
    assert.equal(window.press("n", { ctrlKey: true }).cancelled, false);
    assert.deepEqual(window.scrolls, []);
});

test("a key in a text field passes and ends a half-typed sequence", async () => {
    const { window } = await started();
    window.press("g");
    assert.equal(window.press("j", { target: { localName: "input" } }).cancelled, false);
    window.press("g");
    assert.deepEqual(window.scrolls, []);
});

test("the live marker is set once the tree is in and removed when the record goes", async () => {
    const { window, change } = await started();
    assert.equal(window.attributes.has(BODY_SCRIPT_LIVE_ATTRIBUTE), true);
    change(undefined);
    assert.equal(window.attributes.has(BODY_SCRIPT_LIVE_ATTRIBUTE), false);
    assert.equal(window.press("j").cancelled, false, "with no tree no key is touched");
    change(record());
    assert.equal(window.attributes.has(BODY_SCRIPT_LIVE_ATTRIBUTE), true);
    assert.equal(window.press("j").cancelled, true);
});

test("with no stored record the script touches no key and sets no marker until the background writes one", async () => {
    const { window, change } = await started({});
    assert.equal(window.attributes.size, 0);
    assert.equal(window.press("j").cancelled, false);
    change(record());
    assert.equal(window.press("j").cancelled, true);
});

test("a record of another keymap version leaves the keys alone and no marker", async () => {
    const stale = { message_tree: { version: COMPILED_KEYMAP_VERSION + 1, root: { kind: "branch", children: {} } } };
    const original_error = console.error;
    console.error = () => {};
    try {
        const { window } = await started({ [KEYMAP_STORAGE_KEY]: stale });
        assert.equal(window.attributes.size, 0);
        assert.equal(window.press("j").cancelled, false);
    } finally {
        console.error = original_error;
    }
});

test("a change in another storage area is ignored", async () => {
    const { window, change } = await started({});
    change(record(), "sync");
    assert.equal(window.press("j").cancelled, false);
});

test("the message keys are not in the mail tab keymap, and the other way round", async () => {
    const { compile_default_keymap } = await import("../src/background/commands/index.ts");
    const ids = (root: unknown) => JSON.stringify(root);
    assert.ok(!ids(compile_default_keymap().compiled.modes.normal).includes("message.scroll"));
    assert.ok(!ids(compile_tab_keymap("message").compiled.modes.normal).includes("motion."));
});

test("the scroll step follows the stored setting, and a value that is not a positive number gives the default", async () => {
    const { window, change } = await started({ [KEYMAP_STORAGE_KEY]: record(), [SETTINGS_STORAGE_KEY]: { message_scroll_step_px: 25 } });
    window.press("j");
    change({ message_scroll_step_px: 70 }, "local", SETTINGS_STORAGE_KEY);
    window.press("j");
    change({ message_scroll_step_px: -3 }, "local", SETTINGS_STORAGE_KEY);
    window.press("j");
    change({ message_scroll_step_px: "wide" }, "local", SETTINGS_STORAGE_KEY);
    window.press("j");
    change(undefined, "local", SETTINGS_STORAGE_KEY);
    window.press("j");
    assert.deepEqual(window.scrolls, ["by 25", "by 70", `by ${MESSAGE_SCROLL_STEP_PX}`, `by ${MESSAGE_SCROLL_STEP_PX}`, `by ${MESSAGE_SCROLL_STEP_PX}`]);
});

test("the setting row defaults to the scroll step the body script falls back to", async () => {
    const { SETTING_DEFAULTS } = await import("../src/background/config/settings.ts");
    const { SETTINGS_KEY } = await import("../src/background/config/store.ts");
    assert.equal(SETTING_DEFAULTS.message_scroll_step_px, MESSAGE_SCROLL_STEP_PX);
    assert.equal(SETTINGS_KEY, SETTINGS_STORAGE_KEY);
});

test("the find request selects the first match from the top, with smart case, and focuses the message", async () => {
    const { window, receive } = await started();
    window.text = "alpha beta Alpha gamma alpha";
    window.at = 12;
    assert.deepEqual(await receive({ type: "body.find", pattern: "alpha" }), { found: true });
    assert.deepEqual(window.finds, ["alpha ci fwd nowrap"]);
    assert.equal(window.at, 0, "the find starts from the top, not from the old selection");
    assert.equal(window.focused, 1);
    assert.deepEqual(await receive({ type: "body.find", pattern: "Alpha" }), { found: true });
    assert.equal(window.finds[1], "Alpha cs fwd nowrap");
    assert.equal(window.at, 11);
    assert.deepEqual(await receive({ type: "body.find", pattern: "zzz" }), { found: false });
});

test("n and N step forward and back through the matches and wrap at both ends", async () => {
    const { window, receive } = await started();
    window.text = "ab ab ab";
    await receive({ type: "body.find", pattern: "ab" });
    assert.equal(window.at, 0);
    assert.equal(window.press("n").cancelled, true);
    assert.equal(window.at, 3);
    window.press("n");
    assert.equal(window.at, 6);
    window.press("n");
    assert.equal(window.at, 0, "n wraps from the last match to the first");
    window.press("N");
    assert.equal(window.at, 6, "N wraps from the first match to the last");
    window.press("N");
    assert.equal(window.at, 3);
});

test("n and N do nothing before a first find, and a request that is not a find is not answered", async () => {
    const { window, receive } = await started();
    window.text = "ab";
    assert.equal(window.press("n").cancelled, true);
    assert.deepEqual(window.finds, []);
    assert.equal(receive({ type: "other" }), undefined);
    assert.equal(receive({ type: "body.find", pattern: 4 }), undefined);
});

test("slash sends the command line command to the background with the find text, and runs nothing here", async () => {
    const { window, sent } = await started();
    assert.equal(window.press("/").cancelled, true);
    assert.deepEqual(sent, [{ type: "body.invoke", command: "cmdline.open", args: { text: "find " }, count: 1 }]);
    assert.deepEqual(window.scrolls, []);
});

const invoked = (command: string, args: Record<string, unknown> = {}) => ({ type: "body.invoke", command, args, count: 1 });

test("the mail keys send their command to the background, are cancelled and scroll nothing", async () => {
    const cases: [string[], unknown][] = [
        [["r"], invoked("msg.reply", { to: "sender" })],
        [["a"], invoked("msg.archive")],
        [["d", "d"], invoked("msg.delete")],
        [["y", "y"], invoked("msg.yank", { field: "content" })],
        [["q"], invoked("tab.close")],
    ];
    for (const [keys, expected] of cases) {
        const { window, sent } = await started();
        for (const key of keys) assert.equal(window.press(key).cancelled, true, keys.join());
        assert.deepEqual(sent, [expected], keys.join());
        assert.deepEqual(window.scrolls, []);
    }
    const { window, sent } = await started();
    for (const [key, options] of [["J", {}], ["K", {}], ["j", { altKey: true }], ["k", { altKey: true }]] as const) assert.equal(window.press(key, options).cancelled, true, key);
    for (const key of ["t", "n", "t", "p"]) window.press(key);
    assert.deepEqual(sent, [invoked("tab.next"), invoked("tab.prev"), invoked("tab.next"), invoked("tab.prev"), invoked("tab.next"), invoked("tab.prev")]);
    assert.equal(window.press("j", { ctrlKey: true }).cancelled, false, "Ctrl+J has no key now, so Thunderbird gets it");
});

test("keys that need the thread list send nothing from a message", async () => {
    const { window, sent } = await started();
    for (const keys of [["z", "z"], ["]", "u"], ["F", "t"], ["w", "m"]]) for (const key of keys) window.press(key);
    assert.deepEqual(sent, []);
});

// The message tree lacks these prefixes, or has `z` only for the zoom keys, so their second key used to run on its own. Since `u` and `a` are bound in it, that key would undo or archive.
test("a list prefix swallows its next key in a message, so u and a after it run nothing", async () => {
    const { window, sent } = await started();
    for (const prefix of ["]", "[", "F", "s", "z", "w", "M", "'"]) for (const key of ["u", "a"]) {
        const before = sent.length;
        window.press(prefix);
        window.press(key);
        assert.equal(sent.length, before, `${prefix} ${key}`);
    }
    assert.deepEqual(sent, []);
    window.press("z");
    window.press("i");
    assert.deepEqual(sent, [invoked("zoom.by", { delta: 0.1 })]);
    window.press("u");
    assert.deepEqual(sent, [invoked("zoom.by", { delta: 0.1 }), invoked("msg.undo")]);
});

// A mail sequence that the message tree lacks must complete and run nothing. Broken partway, the matcher retries the rest from the root, where `a` archives and `; y` copies a link.
test("a mail sequence typed in a message runs nothing, also under a prefix the message tree has", async () => {
    const { window, sent } = await started();
    window.elements = [Object.assign(new StubElement(), { href: "https://example.org/x" })];
    // `y ] a`: a stray `y` must not stop `] a` from being a list sequence.
    for (const keys of [[";", ";", "y"], ["]", "a"], ["F", "a"], ["s", "a"], ["2", "w", "a"], ["y", "]", "a"]]) {
        for (const key of keys) window.press(key);
        assert.deepEqual(sent.splice(0), [], keys.join(" "));
        assert.deepEqual(window.appended, [], `${keys.join(" ")} shows no labels`);
    }
    for (const key of ["g", "t", "u"]) window.press(key);
    assert.deepEqual(sent.splice(0), [invoked("msg.undo")], "g t completes, so u stays free");
    for (const key of ["g", "p", "a"]) window.press(key);
    assert.deepEqual(sent, [{ type: "body.invoke", command: "app.open_page", args: { page: "addons" }, count: 1 }], "g p a opens a tab, which any tab can do");
});

// The background passes the mail tree with the user's keys, so a user's list sequence ends in a message too.
test("a user's mail sequence typed in a message runs nothing", async () => {
    const user = { wu: { id: "filter.set", args: { state: "unread" } } };
    const root = JSON.parse(JSON.stringify(compile_tab_keymap("message", user, compile_effective_keymap({ normal: user }).compiled.modes.normal).compiled.modes.normal)) as unknown;
    const { window, sent } = await started({ [KEYMAP_STORAGE_KEY]: { message_tree: { version: COMPILED_KEYMAP_VERSION, root } } });
    for (const key of ["w", "u"]) window.press(key);
    assert.deepEqual(sent, []);
});

test("a half-typed d does not survive the window losing the focus", async () => {
    const { window, sent } = await started();
    window.press("d");
    window.fire("blur");
    window.press("d");
    assert.deepEqual(sent, []);
    window.press("d");
    assert.deepEqual(sent, [invoked("msg.delete")]);
});

test("f labels the links on screen and the typed label focuses the link and asks for the Enter", async () => {
    const { window, sent } = await started();
    const links = [new StubElement(), new StubElement({ top: 40, left: 10, width: 50, height: 12 }), new StubElement({ top: 9000, left: 0, width: 50, height: 12 }), new StubElement({ top: 20, left: 0, width: 0, height: 0 })];
    window.elements = links;
    assert.deepEqual(window.press("f"), { cancelled: true, stopped: true });
    await settle();
    const labels = window.appended[0]!.children.map((node) => node.textContent);
    assert.deepEqual(labels, ["A", "S"], "only the two links that are visible on screen get a label");
    assert.deepEqual(window.press("s"), { cancelled: true, stopped: true });
    assert.deepEqual(links.map((link) => link.focuses), [0, 1, 0, 0]);
    assert.deepEqual(sent, [{ type: "body.open_link" }], "the pick asks the background for a trusted Enter");
    assert.deepEqual(links.map((link) => link.clicks), [0, 0, 0, 0], "a message link is never clicked by script");
    assert.equal(window.appended[0]!.removed, true, "the labels go away after the pick");
    assert.equal(window.press("j").cancelled, true);
    assert.deepEqual(window.scrolls, [`by ${MESSAGE_SCROLL_STEP_PX}`], "the keys work again after the pick");
});

test("a label of two letters needs both, a wrong letter or a key that is not a letter cancels, and Shift alone does nothing", async () => {
    const { window } = await started();
    const links = Array.from({ length: 12 }, (_, index) => new StubElement({ top: index * 20, left: 0, width: 50, height: 12 }));
    window.elements = links;
    window.press("f");
    await settle();
    assert.equal(window.appended[0]!.children.length, 12);
    window.press("a");
    assert.equal(links.every((link) => link.focuses === 0), true, "one letter of two picks nothing");
    window.press("Shift");
    window.press("s", { shiftKey: true, key: "S" });
    assert.deepEqual(links.map((link) => link.focuses), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "a capital letter counts as the lower case one");
    window.press("f");
    await settle();
    window.press("1");
    assert.equal(window.appended[1]!.removed, true, "a key that is not a letter cancels");
    window.press("f");
    await settle();
    window.press("q");
    assert.equal(window.appended[2]!.removed, true, "a letter that starts no label cancels");
    assert.equal(links.reduce((total, link) => total + link.focuses, 0), 1);
});

test("Escape cancels the labels and is cancelled itself, and f with nothing to label starts no mode", async () => {
    const { window } = await started();
    window.elements = [new StubElement()];
    window.press("f");
    await settle();
    assert.deepEqual(window.press("Escape"), { cancelled: true, stopped: true });
    assert.equal(window.appended[0]!.removed, true);
    assert.equal(window.press("Escape").cancelled, false, "outside hint mode Escape goes on to Thunderbird");
    window.elements = [];
    window.press("f");
    await settle();
    assert.equal(window.press("j").cancelled, true);
    assert.deepEqual(window.scrolls, [`by ${MESSAGE_SCROLL_STEP_PX}`], "j scrolls, so no hint mode swallowed it");
});

test("on an own page the pick clicks the element by script and asks the background for nothing", async () => {
    const { window, sent } = await started(undefined, true);
    const button = new StubElement();
    window.elements = [button];
    window.press("f");
    await settle();
    window.press("a");
    assert.deepEqual([button.focuses, button.clicks], [1, 1]);
    assert.deepEqual(sent, []);
});

test("with the parent's pick, f asks it for one label set and draws nothing in the body", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: 1000 });
    const asked: (HintAction | undefined)[] = [];
    const { window } = await started(undefined, false, async (action) => (asked.push(action), 3));
    window.elements = [new StubElement()];
    window.press("f");
    await settle();
    context.mock.timers.tick(1500);
    window.press(";");
    window.press("y");
    await settle();
    assert.deepEqual(asked, [undefined, "yank"], "f leaves the default to the validator, ; y names the yank");
    assert.equal(window.appended.length, 0, "the parent draws the labels");
});

test("keys typed between f and the parent's labels run nothing: f c c in one burst opens no compose", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: 1000 });
    let answer: (count: number) => void = () => {};
    const { window, sent } = await started(undefined, false, () => new Promise((resolve) => (answer = resolve)));
    window.press("f");
    assert.deepEqual(window.press("c"), { cancelled: true, stopped: true });
    window.press("c");
    window.press("j");
    assert.deepEqual(sent.filter((message) => (message as { type?: string }).type === "body.invoke"), [], "no command ran");
    assert.deepEqual(window.scrolls, []);
    answer(5);
    await settle();
    // The parent's labels own the keys before it answers, so a key that reaches the body after the answer came after the labels ended.
    window.press("j");
    window.press("c");
    assert.deepEqual(window.scrolls, [`by ${MESSAGE_SCROLL_STEP_PX}`], "the keys work again once the parent answered, long before 1.5 s");
    assert.deepEqual(sent.filter((message) => (message as { type?: string }).type === "body.invoke"), [invoked("msg.new")]);
});

test("with no answer from the parent the hold ends after 1.5 s", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: 1000 });
    const { window } = await started(undefined, false, () => new Promise(() => {}));
    window.press("f");
    window.press("j");
    assert.equal(window.press("Escape").cancelled, false, "the hold keeps only plain keys back");
    context.mock.timers.tick(1500);
    window.press("j");
    assert.deepEqual(window.scrolls, [`by ${MESSAGE_SCROLL_STEP_PX}`]);
});

test("a scroll right after f drops the pending pick but keeps the hold, so c c before the labels runs nothing", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: 1000 });
    const { window, sent } = await started(undefined, false, () => new Promise(() => {}));
    window.press("f");
    window.fire("scroll");
    window.press("c");
    window.press("c");
    assert.deepEqual(sent.filter((message) => (message as { type?: string }).type === "body.invoke"), []);
});

test("a pick cancelled before the parent answers draws no labels on a late -1 or failure", async () => {
    for (const cancel of ["scroll", "blur", "pointerdown", "Escape", "keymap gone", "keymap changed"] as const) {
        for (const fails of [false, true]) {
            let answer: (count: number) => void = () => {};
            let fail: (error: Error) => void = () => {};
            const { window, change } = await started(undefined, false, () => new Promise((resolve, reject) => ((answer = resolve), (fail = reject))));
            window.elements = [new StubElement()];
            window.press("f");
            if (cancel === "keymap gone") change(undefined);
            else if (cancel === "keymap changed") change(record());
            else if (cancel === "Escape") window.press("Escape");
            else window.fire(cancel);
            if (fails) fail(new Error("no hints"));
            else answer(-1);
            await settle();
            assert.equal(window.appended.length, 0, `${cancel}, ${fails ? "a failure" : "-1"}`);
        }
    }
});

test("the parent's answer 0 (the focus left the body on the way) draws nothing here, and -1 or a failure labels the body itself", async () => {
    for (const [name, parent_pick, labelled] of [
        ["0", async () => 0, false],
        ["-1", async () => -1, true],
        ["a failure", async () => Promise.reject(new Error("no hints")), true],
    ] as const) {
        const { window } = await started(undefined, false, parent_pick);
        window.elements = [new StubElement()];
        window.press("f");
        await settle();
        assert.equal(window.appended.length, labelled ? 1 : 0, name);
        if (!labelled) continue;
        // The labels take the next key at once: the hold ended with the answer.
        window.press("a");
        assert.equal(window.elements[0]!.focuses, 1, name);
    }
});

test("after a pick the picked link has the focus and Enter is not cancelled, since no message key binds it", async () => {
    const { window } = await started();
    window.elements = [new StubElement()];
    window.press("f");
    await settle();
    window.press("a");
    assert.equal(window.elements[0]!.focuses, 1, "the picked link has the focus");
    assert.deepEqual(window.press("Enter"), { cancelled: false, stopped: false });
});

test("a hidden, faded, stacked, disabled-by-selector or off-screen link gets no label", async () => {
    const { window } = await started();
    const box = { top: 100, left: 10, width: 80, height: 14 };
    const bank = new StubElement(box);
    const hidden = new StubElement({ ...box }, { visibility: "hidden" });
    const faded = new StubElement({ top: 200, left: 10, width: 80, height: 14 }, { opacity: "0" });
    const gone = new StubElement({ top: 300, left: 10, width: 80, height: 14 }, { display: "none" });
    const covered = new StubElement({ top: 400, left: 10, width: 80, height: 14 });
    const cover = new StubElement({ top: 400, left: 10, width: 80, height: 14 });
    window.elements = [bank, hidden, faded, gone, covered, cover];
    window.press("f");
    await settle();
    const labelled = window.appended[0]!.children.length;
    assert.equal(labelled, 2, "the bank link (a hidden link above it does not hide it) and the top one of the two stacked links");
    window.press("a");
    window.press("s");
    assert.deepEqual([bank, hidden, faded, gone, covered, cover].map((link) => link.focuses), [1, 0, 0, 0, 0, 0], "the first label is the bank link");
});

test("the labels sit in a closed shadow root of a container with its own important style", async () => {
    const { window } = await started();
    window.elements = [new StubElement()];
    window.press("f");
    await settle();
    const container = window.appended[0]!;
    assert.equal(container.shadow_mode, "closed");
    assert.match(container.style.cssText, /position: fixed !important/);
    assert.match(container.style.cssText, /display: block !important/);
    assert.match(container.style.cssText, /opacity: 1 !important/);
    assert.equal(container.children.length, 1);
});

test("the labels end on scroll, blur, pointerdown and when the keymap record goes", async () => {
    for (const type of ["scroll", "blur", "pointerdown"]) {
        const { window } = await started();
        window.elements = [new StubElement()];
        window.press("f");
        await settle();
        window.fire(type);
        assert.equal(window.appended[0]!.removed, true, type);
        assert.equal(window.press("a").cancelled, true, "a is swallowed as a plain key and picks nothing");
        assert.equal(window.elements[0]!.focuses, 0, type);
    }
    const { window, change } = await started();
    window.elements = [new StubElement()];
    window.press("f");
    await settle();
    change(undefined);
    assert.equal(window.appended[0]!.removed, true);
    assert.equal(window.press("a").cancelled, false, "with no tree no key is touched");
});

test("with the labels up and the keymap record gone, a key still reaches the labels first", async () => {
    const { window } = await started();
    window.elements = [new StubElement(), new StubElement({ top: 40, left: 10, width: 50, height: 12 })];
    window.press("f");
    await settle();
    assert.deepEqual(window.press("Escape"), { cancelled: true, stopped: true });
});

test("the scroll step setting rejects 0 and anything below 1, and the body script reads the same rule", async () => {
    const { setting_problem } = await import("../src/background/config/settings.ts");
    assert.equal(setting_problem("message_scroll_step_px", 0) !== undefined, true);
    assert.equal(setting_problem("message_scroll_step_px", 0.5) !== undefined, true);
    assert.equal(setting_problem("message_scroll_step_px", 1), undefined);
    assert.equal(setting_problem("toast_ms", 0), undefined, "other number settings still take 0");
    const { window, change } = await started({ [KEYMAP_STORAGE_KEY]: record() });
    change({ message_scroll_step_px: 0 }, "local", SETTINGS_STORAGE_KEY);
    window.press("j");
    change({ message_scroll_step_px: 0.5 }, "local", SETTINGS_STORAGE_KEY);
    window.press("j");
    assert.deepEqual(window.scrolls, [`by ${MESSAGE_SCROLL_STEP_PX}`, `by ${MESSAGE_SCROLL_STEP_PX}`]);
});

const message_tree_json = (user: Parameters<typeof compile_tab_keymap>[1]) => JSON.stringify(compile_tab_keymap("message", user).compiled.modes.normal);

test("a user key for a message command works in a message, and a user key for any other command stays out", () => {
    const tree = message_tree_json({ X: { id: "msg.archive" }, Y: { id: "motion.down" }, Z: { id: "repeat.last" } });
    assert.match(tree, /"X"/);
    assert.doesNotMatch(tree, /"Y"|"Z"/);
});

test("a user key never carries tab.close_mail in a message", () => {
    assert.doesNotMatch(message_tree_json({ X: { id: "tab.close_mail" } }), /tab\.close_mail|"X"/);
});

test("a user key on a message default key takes its place", () => {
    const tree = message_tree_json({ j: { id: "msg.archive" } });
    assert.doesNotMatch(tree, /message\.scroll_down/);
    assert.match(tree, /message\.scroll_up/);
});

test("a user key that extends a message key compiles, and only drops that key", () => {
    const result = compile_tab_keymap("message", { gfz: { id: "msg.archive" } });
    assert.deepEqual(result.warnings, ['normal: dropped default keys that your keys extend: "gf" by gfz']);
    assert.match(JSON.stringify(result.compiled.modes.normal), /"z"/);
});

test("a null user binding removes a message key whatever its spelling, and one for a key the message lacks changes nothing", () => {
    const without_j = message_tree_json({ j: null });
    assert.doesNotMatch(without_j, /message\.scroll_down/);
    assert.match(without_j, /message\.scroll_up/);
    const next_keys = (json: string) => json.match(/tab\.next/g)?.length ?? 0;
    assert.equal(next_keys(message_tree_json({ "<A-J>": null })), next_keys(message_tree_json({})) - 1);
    assert.equal(message_tree_json({ Q: null }), message_tree_json({}));
});

test("a user key with the command and args of a list-only default stays out of a message, whatever the args order", () => {
    const tree = message_tree_json({ X: { id: "cmdline.open", args: { text: "sort " } }, Y: { id: "cmdline.open", args: { text: "find " } } });
    assert.doesNotMatch(tree, /"X"/);
    assert.match(tree, /"Y"/);
    assert.doesNotMatch(message_tree_json({ X: { args: { text: "sort " }, id: "cmdline.open" } }), /"X"/);
});

test("the background accepts a body request for message commands and never for the list or the close chord", () => {
    const allowed = message_background_commands();
    for (const id of ["msg.move", "msg.archive", "tab.switch"]) assert.ok(allowed.has(id), id);
    for (const id of ["tab.close_mail", "folder.read_all", "repeat.last", "motion.down"]) assert.ok(!allowed.has(id), id);
});

test("a half-typed sequence reports its prefix, and each way it ends reports an empty prefix", async () => {
    const { window, reports } = await started();
    window.press("j");
    assert.deepEqual(reports, [], "a plain key with no sequence sends nothing");
    window.press("g");
    assert.deepEqual(reports, [["g"]]);
    window.press("g");
    assert.deepEqual(reports, [["g"], []], "a match ends it");
    window.press("g");
    window.press("Escape");
    window.press("g");
    window.fire("blur");
    window.press("g");
    window.press("j", { target: { localName: "input" } });
    window.press("g");
    window.press("x");
    assert.deepEqual(reports, [["g"], [], ["g"], [], ["g"], [], ["g"], [], ["g"], []]);
});

test("a new tree ends the reported sequence", async () => {
    const { window, reports, change } = await started();
    window.press("g");
    change(record());
    assert.deepEqual(reports, [["g"], []]);
});

test("Backspace steps back one key at depth two, and a second Backspace after the sequence empties is not cancelled", async () => {
    const { window, reports } = await started();
    window.press("g");
    window.press("p");
    assert.equal(window.press("Backspace").cancelled, true);
    assert.deepEqual(reports.at(-1), ["g"]);
    assert.equal(window.press("Backspace").cancelled, true);
    assert.deepEqual(reports.at(-1), []);
    assert.equal(window.press("Backspace").cancelled, false);
});

test("Backspace in a half-typed sequence goes back one key and reports the shorter prefix", async () => {
    const { window, reports } = await started();
    window.press("g");
    const back = window.press("Backspace");
    assert.equal(back.cancelled, true);
    assert.deepEqual(reports, [["g"], []]);
    window.press("g");
    assert.deepEqual(reports, [["g"], [], ["g"]], "one g after the dropped one starts a new sequence");
});

test("Backspace with no sequence is not cancelled", async () => {
    const { window, reports } = await started();
    assert.equal(window.press("Backspace").cancelled, false);
    assert.deepEqual(reports, []);
});

test("an own page names its tree in the pending report and a message document does not", async () => {
    const own_record = { own_tree: record().message_tree };
    for (const [tree_field, stored, expected] of [["own_tree", own_record, "own"], ["message_tree", record(), undefined]] as const) {
        const window = new StubWindow();
        const { storage } = stub_storage({ [KEYMAP_STORAGE_KEY]: stored });
        const { runtime, trees } = stub_runtime();
        await start_body_script(window, storage, runtime, (element) => element.click(), tree_field);
        window.press("g");
        assert.deepEqual(trees, [expected]);
    }
});

test("a message window document reads the window tree and names it in the pending report: J steps the message, : and / open the command line, and m s runs", async () => {
    const window_root = JSON.parse(JSON.stringify(compile_tab_keymap("window").compiled.modes.normal)) as unknown;
    const window = new StubWindow();
    const { storage } = stub_storage({ [KEYMAP_STORAGE_KEY]: { ...record(), window_tree: { version: COMPILED_KEYMAP_VERSION, root: window_root } } });
    const { runtime, sent, trees } = stub_runtime();
    await start_body_script(window, storage, runtime, undefined, "window_tree");
    assert.equal(window.press("J").cancelled, true);
    window.press(":");
    window.press("/");
    window.press("m");
    window.press("s");
    assert.deepEqual(sent.map((message) => (message as { command?: string }).command), ["step.message", "cmdline.open", "cmdline.open", "msg.flag"]);
    assert.deepEqual(trees, ["window", "window"]);
});

test("the message script entry starts on the message keys while the background cannot answer body.tree, and switches to the window keys once it answers", async () => {
    const window_root = JSON.parse(JSON.stringify(compile_tab_keymap("window").compiled.modes.normal)) as unknown;
    const window = new StubWindow();
    const { storage } = stub_storage({ [KEYMAP_STORAGE_KEY]: { ...record(), window_tree: { version: COMPILED_KEYMAP_VERSION, root: window_root } } });
    const sent: unknown[] = [];
    let tree_answers = 0;
    // The first question finds no background, as in a message window that opens while the add-on starts.
    const runtime: BodyRuntime = {
        sendMessage: async (message) => (message.type === "body.tree" ? (tree_answers++ === 0 ? Promise.reject(new Error("Receiving end does not exist")) : "window_tree") : void sent.push(message)),
        onMessage: { addListener() {} },
    };
    Object.assign(globalThis, { window, browser: { storage: { local: storage, onChanged: storage.onChanged }, runtime } });
    await import("../src/content/message_display.ts");
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.press("J");
    assert.deepEqual(sent.map((message) => (message as { command?: string }).command), ["tab.next"], "the message keys run until the background answers");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    window.press("J");
    window.press("c");
    assert.deepEqual(sent.map((message) => (message as { command?: string }).command), ["tab.next", "step.message", "msg.new"], "the window keys run once it answers");
});
