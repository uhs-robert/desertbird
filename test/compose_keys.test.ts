import assert from "node:assert/strict";
import { test } from "node:test";
import { start_compose_keys } from "../src/content/compose_edit_key.ts";
import type { ComposeKeyEvent } from "../src/content/compose_edit_key.ts";

function setup() {
    const sent: unknown[] = [];
    let listener: ((event: ComposeKeyEvent) => void) | undefined;
    let capture = false;
    start_compose_keys({ addEventListener: (_type, added, use_capture) => void ((listener = added), (capture = use_capture)) }, { sendMessage: async (message) => void sent.push(message) });
    const press = (key: string, modifiers: Partial<ComposeKeyEvent> = {}) => {
        const event = { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, cancelled: false, stopped: false, preventDefault() { this.cancelled = true; }, stopPropagation() { this.stopped = true; }, ...modifiers };
        listener!(event);
        return event;
    };
    return { sent, press, capture: () => capture };
}

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
