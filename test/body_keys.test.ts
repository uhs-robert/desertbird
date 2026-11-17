import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPILED_KEYMAP_VERSION } from "../vendor/desertfox/prefix_tree.ts";
import { LINE_STEP_PX, start_body_script } from "../src/content/body_keys.ts";
import type { BodyKeyEvent, BodyStorage, BodyWindow } from "../src/content/body_keys.ts";
import { compile_message_keymap } from "../src/background/commands/index.ts";
import { BODY_SCRIPT_LIVE_ATTRIBUTE, KEYMAP_STORAGE_KEY } from "../src/shared/protocol.ts";

const VIEWPORT = 600;
const PAGE_HEIGHT = 5000;

/** A stand-in for the message document: it records the scrolls and holds the root element attributes. */
class StubWindow implements BodyWindow {
    listeners: ((event: BodyKeyEvent) => void)[] = [];
    scrolls: string[] = [];
    attributes = new Map<string, string>();
    innerHeight = VIEWPORT;
    document = {
        documentElement: {
            scrollHeight: PAGE_HEIGHT,
            setAttribute: (name: string, value: string) => void this.attributes.set(name, value),
            removeAttribute: (name: string) => void this.attributes.delete(name),
        },
    };
    addEventListener(_type: "keydown", listener: (event: BodyKeyEvent) => void) {
        this.listeners.push(listener);
    }
    removeEventListener() {}
    scrollBy(options: { top: number }) {
        this.scrolls.push(`by ${options.top}`);
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

function stub_storage(stored: Record<string, unknown>) {
    const change_listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
    const storage: BodyStorage = {
        get: async (key) => (key in stored ? { [key]: stored[key] } : {}),
        onChanged: { addListener: (listener) => void change_listeners.push(listener) },
    };
    return { storage, change: (value: unknown, area = "local") => change_listeners.forEach((listener) => listener({ [KEYMAP_STORAGE_KEY]: { newValue: value } }, area)) };
}

/** The record the background stores, with the message tree compiled from the real default keys. */
function record() {
    const root = JSON.parse(JSON.stringify(compile_message_keymap().compiled.modes.normal)) as unknown;
    return { message_tree: { version: COMPILED_KEYMAP_VERSION, root } };
}

async function started(stored: Record<string, unknown> = { [KEYMAP_STORAGE_KEY]: record() }) {
    const window = new StubWindow();
    const { storage, change } = stub_storage(stored);
    await start_body_script(window, storage);
    return { window, change };
}

test("j and k scroll by a fixed line step and are cancelled", async () => {
    const { window } = await started();
    assert.deepEqual(window.press("j"), { cancelled: true, stopped: true });
    window.press("k");
    assert.deepEqual(window.scrolls, [`by ${LINE_STEP_PX}`, `by ${-LINE_STEP_PX}`]);
});

test("a count multiplies the line step", async () => {
    const { window } = await started();
    window.press("5");
    window.press("j");
    window.press("1");
    window.press("2");
    window.press("k");
    assert.deepEqual(window.scrolls, [`by ${5 * LINE_STEP_PX}`, `by ${-12 * LINE_STEP_PX}`]);
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
    assert.deepEqual(window.scrolls, [`by ${LINE_STEP_PX}`]);
});

test("an unbound plain key is swallowed so Thunderbird's single-key shortcuts do not fire, and runs nothing", async () => {
    const { window } = await started();
    for (const key of ["a", "r", "#", "x"]) assert.deepEqual(window.press(key), { cancelled: true, stopped: true }, key);
    assert.deepEqual(window.scrolls, []);
});

test("named keys and unbound chords pass, a bound chord is cancelled", async () => {
    const { window } = await started();
    for (const key of ["Enter", "ArrowDown", "Tab", " ", "PageDown"]) assert.equal(window.press(key).cancelled, false, key);
    assert.equal(window.press("c", { ctrlKey: true }).cancelled, false);
    assert.equal(window.press("j", { ctrlKey: true }).cancelled, false);
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
    assert.ok(!ids(compile_message_keymap().compiled.modes.normal).includes("motion."));
});
