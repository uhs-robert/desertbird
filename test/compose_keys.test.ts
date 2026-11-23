import assert from "node:assert/strict";
import { test } from "node:test";
import { start_compose_keys } from "../src/content/compose_edit_key.ts";
import type { ComposeKeyEvent, ComposeStorage } from "../src/content/compose_edit_key.ts";
import { create_mode_label } from "../src/content/compose_mode_label.ts";
import type { LabelDocument, LabelState } from "../src/content/compose_mode_label.ts";
import { mark_steps } from "../src/background/config/keymap.ts";
import { compile_tab_keymap } from "../src/background/commands/tab_keymaps.ts";
import { KEYMAP_STORAGE_KEY } from "../src/shared/protocol.ts";

// The tree the background stores for a compose window, compiled from the real defaults.
function stored_record(user: Parameters<typeof compile_tab_keymap>[1] = {}) {
    const root = JSON.parse(JSON.stringify(compile_tab_keymap("compose", user).compiled.modes.normal));
    mark_steps(root);
    return { compose_tree: { version: 1, root } };
}

async function setup(has_focus = true, record: unknown = stored_record()) {
    const sent: unknown[] = [];
    const modes: LabelState[] = [];
    let key_listener: ((event: ComposeKeyEvent) => void) | undefined;
    const plain_listeners: Record<string, () => void> = {};
    let capture = false;
    let storage_listener: Parameters<ComposeStorage["onChanged"]["addListener"]>[0] | undefined;
    const storage: ComposeStorage = {
        get: async (key) => ({ [key]: record }),
        onChanged: { addListener: (added) => void (storage_listener = added) },
    };
    await start_compose_keys(
        {
            addEventListener: ((type: string, added: (event: ComposeKeyEvent) => void, use_capture: boolean) => {
                if (type === "keydown") void ((key_listener = added), (capture = use_capture));
                else plain_listeners[type] = added as () => void;
            }) as never,
        },
        { sendMessage: async (message) => void sent.push(message) },
        (mode) => void modes.push(mode),
        has_focus,
        storage,
    );
    const press = (key: string, modifiers: Partial<ComposeKeyEvent> = {}) => {
        const event = { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, cancelled: false, stopped: false, preventDefault() { this.cancelled = true; }, stopPropagation() { this.stopped = true; }, ...modifiers };
        key_listener!(event);
        return event;
    };
    const change_record = (value: unknown, area = "local") => storage_listener!({ [KEYMAP_STORAGE_KEY]: { newValue: value } }, area);
    return { sent, modes, press, change_record, capture: () => capture, focus: () => plain_listeners.focus!(), blur: () => plain_listeners.blur!() };
}

const untouched = (event: { cancelled: boolean; stopped: boolean }) => !event.cancelled && !event.stopped;
const taken = (event: { cancelled: boolean; stopped: boolean }) => event.cancelled && event.stopped;
const invoke = (command: string, args: Record<string, unknown> = {}) => ({ type: "body.invoke", command, args, count: 1 });
const last = (modes: LabelState[]) => modes.at(-1);

test("Ctrl+E is taken and asks the background to edit, in the capture phase, in either mode", async () => {
    const { sent, press, capture, modes } = await setup();
    assert.equal(capture(), true);
    assert.ok(taken(press("e", { ctrlKey: true })));
    press("Escape");
    assert.ok(taken(press("E", { ctrlKey: true })));
    assert.deepEqual(sent, [{ type: "compose.edit" }, { type: "compose.edit" }]);
    assert.equal(last(modes), "normal");
});

test("a held Ctrl+E asks once and still keeps the repeats from the editor", async () => {
    const { sent, press } = await setup();
    press("e", { ctrlKey: true });
    assert.ok(taken(press("e", { ctrlKey: true, repeat: true })));
    assert.equal(sent.length, 1);
});

test("every window opens in insert mode, with the label hidden while the body has no focus", async () => {
    assert.deepEqual((await setup(true)).modes, ["insert"]);
    assert.deepEqual((await setup(false)).modes, ["hidden"]);
});

test("insert mode never swallows a typed character", async () => {
    const { sent, press, modes } = await setup();
    const typed = ["a", "e", "s", "i", "z", "?", "I", "O", " ", "é", "ß", "ü", "1", "/", ":", "q", "Dead", "Process", "Enter", "Backspace", "Delete", "Tab", "ArrowLeft"];
    for (const key of typed) assert.ok(untouched(press(key, { shiftKey: key !== key.toLowerCase() })), key);
    // AltGr arrives as Ctrl and Alt together on some systems and types a character.
    assert.ok(untouched(press("@", { ctrlKey: true, altKey: true })));
    assert.ok(untouched(press("e", { ctrlKey: true, altKey: true })));
    assert.deepEqual(sent, []);
    assert.deepEqual(modes, ["insert"]);
});

test("Escape in insert mode enters normal mode and is taken, and `i` returns to insert and is taken", async () => {
    const { press, modes } = await setup();
    assert.ok(taken(press("Escape")));
    assert.equal(last(modes), "normal");
    assert.ok(taken(press("i")));
    assert.equal(last(modes), "insert");
    assert.ok(untouched(press("i")));
});

test("in normal mode a character key and the editing keys never reach the draft, bound or not", async () => {
    const { sent, press } = await setup();
    press("Escape");
    for (const key of ["a", "x", "Z", " ", "1", "é", "ß", "Enter", "Backspace", "Delete", "/", "@"]) assert.ok(taken(press(key)), key);
    assert.deepEqual(sent, []);
});

test("in normal mode the caret and focus keys pass", async () => {
    const { press } = await setup();
    press("Escape");
    for (const key of ["ArrowUp", "ArrowLeft", "Home", "PageDown", "F6", "Shift", "CapsLock"]) assert.ok(untouched(press(key)), key);
});

test("in normal mode Tab and Shift+Tab never reach the draft, and in insert mode they pass", async () => {
    const { press } = await setup();
    assert.ok(untouched(press("Tab")));
    press("Escape");
    assert.ok(taken(press("Tab")));
    assert.ok(taken(press("Tab", { shiftKey: true })));
    press("i");
    assert.ok(untouched(press("Tab", { shiftKey: true })));
});

test("chords pass untouched in normal mode", async () => {
    const { sent, press } = await setup();
    press("Escape");
    for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }]) for (const key of ["Enter", "s", "i", "z", "w", "?"]) assert.ok(untouched(press(key, modifiers)), `${key} ${JSON.stringify(modifiers)}`);
    assert.deepEqual(sent, []);
});

test("the default keys ask the background once each: e edits, s saves, ? opens help", async () => {
    const { sent, press } = await setup();
    press("Escape");
    for (const key of ["e", "s", "?"]) assert.ok(taken(press(key, { shiftKey: key === "?" })), key);
    assert.deepEqual(sent, [invoke("compose.edit_external"), invoke("compose.save"), invoke("help.open")]);
});

test("a bound key held down asks once and the repeats are taken", async () => {
    const { sent, press } = await setup();
    press("Escape");
    press("s");
    assert.ok(taken(press("s", { repeat: true })));
    assert.equal(sent.length, 1);
});

test("a zoom sequence runs on its last key, and a key that continues no sequence runs nothing and is taken", async () => {
    const { sent, press } = await setup();
    press("Escape");
    assert.ok(taken(press("z")));
    assert.deepEqual(sent, []);
    assert.ok(taken(press("i")));
    assert.deepEqual(sent, [invoke("zoom.by", { delta: 0.1 })]);
    press("z");
    assert.ok(taken(press("x")));
    // The pending key ended with the unbound one, so `s` is a plain key again.
    press("s");
    assert.deepEqual(sent.slice(1), [invoke("compose.save")]);
});

test("`i` in the middle of a sequence is a key of that sequence and does not enter insert mode", async () => {
    const { modes, press } = await setup();
    press("Escape");
    press("z");
    press("i");
    assert.equal(last(modes), "normal");
});

test("Escape in normal mode ends a half-typed sequence and stays in normal mode", async () => {
    const { sent, modes, press } = await setup();
    press("Escape");
    press("z");
    assert.ok(taken(press("Escape")));
    press("i");
    assert.equal(last(modes), "insert");
    assert.deepEqual(sent, []);
});

test("a key with no keymap record yet is held back and runs nothing, and the record that arrives binds it", async () => {
    const { sent, press, change_record } = await setup(true, null);
    press("Escape");
    assert.ok(taken(press("s")));
    assert.deepEqual(sent, []);
    change_record(stored_record());
    press("s");
    assert.deepEqual(sent, [invoke("compose.save")]);
});

test("a record of another shape or another storage area changes nothing, and a user binding replaces the default", async () => {
    const { sent, press, change_record } = await setup();
    change_record({ compose_tree: null }, "sync");
    press("Escape");
    press("s");
    assert.equal(sent.length, 1);
    change_record(stored_record({ x: { id: "compose.save" } }));
    press("x");
    assert.deepEqual(sent.at(-1), invoke("compose.save"));
    change_record("not a record");
    sent.length = 0;
    assert.ok(taken(press("s")));
    assert.deepEqual(sent, []);
});

test("mode lifecycle: focus leaving the body hides the label and focus back shows the mode it had", async () => {
    const { sent, modes, press, blur, focus } = await setup();
    press("Escape");
    blur();
    assert.equal(last(modes), "hidden");
    focus();
    assert.equal(last(modes), "normal");
    assert.ok(taken(press("a")));
    press("i");
    blur();
    focus();
    assert.equal(last(modes), "insert");
    assert.ok(untouched(press("s")));
    assert.deepEqual(sent, []);
});

test("mode lifecycle: focus leaving and returning drops a half-typed sequence", async () => {
    const { sent, press, blur, focus } = await setup();
    press("Escape");
    press("z");
    blur();
    focus();
    press("Escape");
    press("i");
    assert.deepEqual(sent, []);
});

test("mode lifecycle: s and Ctrl+S in normal mode keep it, with the focus bounce of a save, so the next plain key is cancelled and not typed", async () => {
    const { sent, modes, press, blur, focus } = await setup();
    press("Escape");
    press("s");
    blur();
    focus();
    assert.equal(last(modes), "normal");
    assert.ok(taken(press("a")));
    // Ctrl+S is Thunderbird's own save, which passes untouched and bounces the focus the same way.
    assert.ok(untouched(press("s", { ctrlKey: true })));
    blur();
    focus();
    assert.equal(last(modes), "normal");
    assert.ok(taken(press("a")));
    assert.deepEqual(sent, [invoke("compose.save")]);
});

test("mode lifecycle: the external edit changes no mode", async () => {
    const { modes, press } = await setup();
    press("Escape");
    press("e");
    assert.equal(last(modes), "normal");
});

test("mode lifecycle: a reply or forward window opens in insert before its body has focus, shows INSERT on the focus and types", async () => {
    // The window opens and the editor takes the focus a moment later. Keys before it are the user's typing and nothing is swallowed.
    const { modes, press, focus } = await setup(false);
    assert.deepEqual(modes, ["hidden"]);
    focus();
    assert.equal(last(modes), "insert");
    for (const key of [">", " ", "e", "s", "i", "z"]) assert.ok(untouched(press(key)), key);
    assert.deepEqual(modes, ["hidden", "insert"]);
});

test("an IME composition is never touched: Escape and letters during it change no mode and run nothing", async () => {
    const { sent, modes, press } = await setup();
    for (const key of ["Escape", "Process", "a", "Enter"]) assert.ok(untouched(press(key, { isComposing: true })), key);
    assert.deepEqual(modes, ["insert"]);
    press("Escape");
    for (const key of ["s", "Escape", "i", "Enter"]) assert.ok(untouched(press(key, { isComposing: true })), key);
    assert.equal(last(modes), "normal");
    assert.deepEqual(sent, []);
});

test("the spell-check popup takes its own Escape and shows no key to the script, so the mode is as it was", async () => {
    // The popup is chrome, and a key typed in it never reaches the content script: the script sees no event at all, and a blur and focus pair is the most it can see.
    const { modes, press, blur, focus } = await setup();
    press("a");
    blur();
    focus();
    assert.deepEqual(modes, ["insert", "hidden", "insert"]);
    assert.ok(untouched(press("a")));
});

test("no key of the compose tree reaches a close or a discard", async () => {
    const forbidden = new Set(["tab.close", "window.close", "cmdline.open", "msg.delete", "msg.archive"]);
    const ids = (node: unknown): string[] => {
        const { children, steps } = node as { children?: Record<string, unknown>; steps?: { invocation: { id: string } }[] };
        return [...(steps ?? []).map((step) => step.invocation.id), ...Object.values(children ?? {}).flatMap(ids)];
    };
    const user = { q: { id: "tab.close" }, "x x": { id: "msg.delete" }, y: { id: "cmdline.open" }, w: [{ id: "compose.save" }, { id: "tab.close" }] };
    for (const record of [stored_record(), stored_record(user as never)]) assert.deepEqual(ids(record.compose_tree.root).filter((id) => forbidden.has(id)), []);
    const { sent, press } = await setup(true, stored_record(user as never));
    press("Escape");
    for (const key of ["q", "x", "y", "w", "c", "d"]) press(key);
    assert.deepEqual(sent.filter((message) => forbidden.has((message as { command: string }).command)), []);
});

test("the label is a style sheet on the document and adds no node", async () => {
    const sheet = { css: "", replaceSync(css: string) { this.css = css; } };
    const document: LabelDocument = { adoptedStyleSheets: [] };
    const show = create_mode_label(document, () => sheet);
    assert.deepEqual(document.adoptedStyleSheets, [sheet]);
    show("insert");
    assert.match(sheet.css, /^html::after\{content:"-- INSERT --"/);
    assert.match(sheet.css, /pointer-events:none/);
    show("normal");
    assert.match(sheet.css, /content:"-- NORMAL --"/);
    show("hidden");
    assert.equal(sheet.css, "");
});
