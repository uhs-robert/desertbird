import assert from "node:assert/strict";
import { test } from "node:test";
import { start_compose_keys } from "../src/content/compose_edit_key.ts";
import type { ComposeKeyEvent } from "../src/content/compose_edit_key.ts";

function setup() {
    const sent: unknown[] = [];
    let key_listener: ((event: ComposeKeyEvent) => void) | undefined;
    let capture = false;
    const types: string[] = [];
    start_compose_keys({ addEventListener: (type, added, use_capture) => void (types.push(type), (key_listener = added), (capture = use_capture)) }, { sendMessage: async (message) => void sent.push(message) });
    const press = (key: string, modifiers: Partial<ComposeKeyEvent> = {}) => {
        const event = { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, cancelled: false, stopped: false, preventDefault() { this.cancelled = true; }, stopPropagation() { this.stopped = true; }, ...modifiers };
        key_listener!(event);
        return event;
    };
    return { sent, press, capture: () => capture, types };
}

const untouched = (event: { cancelled: boolean; stopped: boolean }) => !event.cancelled && !event.stopped;
const taken = (event: { cancelled: boolean; stopped: boolean }) => event.cancelled && event.stopped;

test("Ctrl+E is taken and asks the background to edit, in the capture phase, with Caps Lock too", () => {
    const { sent, press, capture } = setup();
    assert.equal(capture(), true);
    assert.ok(taken(press("e", { ctrlKey: true })));
    assert.ok(taken(press("E", { ctrlKey: true })));
    assert.deepEqual(sent, [{ type: "compose.edit" }, { type: "compose.edit" }]);
});

test("a held Ctrl+E asks once and still keeps the repeats from the editor", () => {
    const { sent, press } = setup();
    press("e", { ctrlKey: true });
    assert.ok(taken(press("e", { ctrlKey: true, repeat: true })));
    assert.equal(sent.length, 1);
});

test("the script holds no mode: Escape, letters, i and the other chords pass untouched and ask nothing", () => {
    const { sent, press, types } = setup();
    for (const key of ["Escape", "e", "s", "i", "q", "Enter", "Tab"]) assert.ok(untouched(press(key)), key);
    for (const modifiers of [{ ctrlKey: true, shiftKey: true }, { altKey: true }, { metaKey: true }]) assert.ok(untouched(press("e", modifiers)), JSON.stringify(modifiers));
    assert.ok(untouched(press("s", { ctrlKey: true })));
    assert.deepEqual(sent, []);
    // No focus or blur listener: the label and the mode live in the chrome runtime.
    assert.deepEqual(types, ["keydown"]);
});

test("a Ctrl+E during an IME composition passes and asks nothing", () => {
    const { sent, press } = setup();
    assert.ok(untouched(press("e", { ctrlKey: true, isComposing: true })));
    assert.deepEqual(sent, []);
});
