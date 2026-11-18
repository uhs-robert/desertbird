import assert from "node:assert/strict";
import { test } from "node:test";
import { start_compose_keys } from "../src/content/compose_edit_key.ts";
import type { ComposeKeyEvent } from "../src/content/compose_edit_key.ts";
import { create_mode_label } from "../src/content/compose_mode_label.ts";
import type { ComposeMode, LabelDocument } from "../src/content/compose_mode_label.ts";

function setup(has_focus = true) {
    const sent: unknown[] = [];
    const modes: ComposeMode[] = [];
    let key_listener: ((event: ComposeKeyEvent) => void) | undefined;
    const plain_listeners: Record<string, () => void> = {};
    let capture = false;
    start_compose_keys(
        {
            addEventListener: ((type: string, added: (event: ComposeKeyEvent) => void, use_capture: boolean) => {
                if (type === "keydown") void ((key_listener = added), (capture = use_capture));
                else plain_listeners[type] = added as () => void;
            }) as never,
        },
        { sendMessage: async (message) => void sent.push(message) },
        (mode) => void modes.push(mode),
        has_focus,
    );
    const press = (key: string, modifiers: Partial<ComposeKeyEvent> = {}) => {
        const event = { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, cancelled: false, stopped: false, preventDefault() { this.cancelled = true; }, stopPropagation() { this.stopped = true; }, ...modifiers };
        key_listener!(event);
        return event;
    };
    return { sent, modes, press, capture: () => capture, focus: () => plain_listeners.focus!(), blur: () => plain_listeners.blur!() };
}

const untouched = (event: { cancelled: boolean; stopped: boolean }) => !event.cancelled && !event.stopped;

test("Ctrl+E is taken and asks the background to edit, in the capture phase", () => {
    const { sent, press, capture } = setup();
    const event = press("e", { ctrlKey: true });
    assert.equal(capture(), true);
    assert.ok(event.cancelled && event.stopped);
    assert.deepEqual(sent, [{ type: "compose.edit" }]);
});

test("Ctrl+E with Caps Lock on counts", () => {
    const { sent, press } = setup();
    press("E", { ctrlKey: true });
    assert.equal(sent.length, 1);
});

test("other keys and other chords pass to the editor", () => {
    const { sent, press } = setup();
    const passed = [press("e"), press("E", { shiftKey: true }), press("E", { ctrlKey: true, shiftKey: true }), press("e", { ctrlKey: true, altKey: true }), press("e", { ctrlKey: true, metaKey: true }), press("f", { ctrlKey: true }), press("e", { ctrlKey: true, isComposing: true })];
    for (const event of passed) assert.ok(!event.cancelled && !event.stopped, event.key);
    assert.deepEqual(sent, []);
});

test("a held Ctrl+E asks once and still keeps the repeats from the editor", () => {
    const { sent, press } = setup();
    press("e", { ctrlKey: true });
    const repeat = press("e", { ctrlKey: true, repeat: true });
    assert.ok(repeat.cancelled);
    assert.equal(sent.length, 1);
});

test("the label starts as insert with focus in the body and as normal without", () => {
    assert.deepEqual(setup(true).modes, ["insert"]);
    assert.deepEqual(setup(false).modes, ["normal"]);
});

test("focus out of the body shows normal and focus back shows insert", () => {
    const { modes, blur, focus } = setup();
    blur();
    focus();
    assert.deepEqual(modes, ["insert", "normal", "insert"]);
});

test("in insert mode `e` and every other plain key pass to the editor", () => {
    const { sent, press } = setup();
    for (const key of ["e", "E", "o", "x", "Enter", "Tab"]) assert.ok(untouched(press(key)), key);
    assert.deepEqual(sent, []);
});

test("Ctrl+O is taken in insert mode and makes the next key a normal-mode key", () => {
    const { modes, press } = setup();
    const event = press("o", { ctrlKey: true });
    assert.ok(event.cancelled && event.stopped);
    assert.deepEqual(modes, ["insert", "normal"]);
});

test("`e` after Ctrl+O asks the background to edit, takes the key and returns to insert", () => {
    const { sent, modes, press } = setup();
    press("o", { ctrlKey: true });
    const event = press("e");
    assert.ok(event.cancelled && event.stopped);
    assert.deepEqual(sent, [{ type: "compose.edit" }]);
    assert.deepEqual(modes, ["insert", "normal", "insert"]);
    assert.ok(untouched(press("e")), "the one-shot is spent");
    assert.equal(sent.length, 1);
});

test("any other key after Ctrl+O passes unchanged and returns to insert", () => {
    const { sent, modes, press } = setup();
    press("o", { ctrlKey: true });
    assert.ok(untouched(press("x")));
    assert.deepEqual(modes, ["insert", "normal", "insert"]);
    assert.ok(untouched(press("e")));
    assert.deepEqual(sent, []);
});

test("a lone modifier does not spend the one-shot", () => {
    const { sent, modes, press } = setup();
    press("o", { ctrlKey: true });
    for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock"]) assert.ok(untouched(press(key, { shiftKey: key === "Shift" })), key);
    assert.deepEqual(modes, ["insert", "normal"]);
    press("e");
    assert.equal(sent.length, 1);
});

test("`E` with Shift or `e` with a modifier is another key, with Caps Lock it counts", () => {
    const { sent, press } = setup();
    for (const modifiers of [{ shiftKey: true }, { altKey: true }, { metaKey: true }]) {
        press("o", { ctrlKey: true });
        assert.ok(untouched(press("E", modifiers)));
    }
    assert.deepEqual(sent, []);
    press("o", { ctrlKey: true });
    press("E");
    assert.equal(sent.length, 1);
});

test("Escape in the body shows normal and passes to Thunderbird, and `e` then edits", () => {
    const { sent, modes, press } = setup();
    assert.ok(untouched(press("Escape")));
    assert.deepEqual(modes, ["insert", "normal"]);
    press("e");
    assert.equal(sent.length, 1);
});

test("a second Escape returns to insert and passes", () => {
    const { modes, press } = setup();
    press("Escape");
    assert.ok(untouched(press("Escape")));
    assert.deepEqual(modes, ["insert", "normal", "insert"]);
});

test("focus back into the body ends a pending normal mode", () => {
    const { sent, press, focus } = setup();
    press("o", { ctrlKey: true });
    focus();
    assert.ok(untouched(press("e")));
    assert.deepEqual(sent, []);
});

test("a held `e` after Ctrl+O asks once and keeps the repeats from the body", () => {
    const { sent, press } = setup();
    press("o", { ctrlKey: true });
    press("e");
    assert.ok(press("e", { repeat: true }).cancelled);
    assert.ok(press("e", { repeat: true }).cancelled);
    assert.equal(sent.length, 1);
    assert.ok(untouched(press("e")), "a fresh press types again");
});

test("a held Ctrl+O sets normal once and a composing key changes nothing", () => {
    const { modes, press } = setup();
    press("o", { ctrlKey: true });
    assert.ok(press("o", { ctrlKey: true, repeat: true }).cancelled);
    assert.deepEqual(modes, ["insert", "normal"]);
    assert.ok(untouched(press("e", { isComposing: true })));
    assert.deepEqual(modes, ["insert", "normal"]);
});

test("Ctrl+E still edits in either mode", () => {
    const { sent, press } = setup();
    press("o", { ctrlKey: true });
    press("e", { ctrlKey: true });
    assert.equal(sent.length, 1);
});

test("the label is a style sheet on the document and adds no node", () => {
    const sheet = { css: "", replaceSync(css: string) { this.css = css; } };
    const document: LabelDocument = { adoptedStyleSheets: [] };
    const show = create_mode_label(document, () => sheet);
    assert.deepEqual(document.adoptedStyleSheets, [sheet]);
    show("insert");
    assert.match(sheet.css, /^html::after\{content:"-- INSERT --"/);
    assert.match(sheet.css, /pointer-events:none/);
    show("normal");
    assert.match(sheet.css, /content:"-- NORMAL --"/);
});
