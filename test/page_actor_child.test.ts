import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { ActorState } from "../src/chrome/page_actor_parent.ts";

// The actor system gives the child its base class as a global. The stand-in records what the child sends and runs its timers on demand.
class FakeActorChild {
    sent: [string, unknown][] = [];
    queries: string[] = [];
    query_answer: Promise<unknown> = new Promise(() => {});
    timers: (() => void)[] = [];
    send_throws = false;
    document: { activeElement: unknown; designMode?: string; scrollingElement?: unknown; querySelectorAll?(selector: string): unknown[]; defaultView?: unknown } = { activeElement: { localName: "body" } };
    contentWindow = { setTimeout: (callback: () => void) => void this.timers.push(callback) };
    sendAsyncMessage(name: string, data?: unknown) {
        if (this.send_throws) throw new Error("the parent is gone");
        this.sent.push([name, data]);
    }
    sendQuery(name: string) {
        this.queries.push(name);
        return this.query_answer;
    }
}

type Child = FakeActorChild & { actorCreated(): void; apply(state: ActorState): void; handleEvent(event: unknown): void; receiveMessage(message: { name: string; data?: unknown }): void; on: boolean; insert: boolean };
let ChildClass: new () => Child;
let deepest_focus: (document: { activeElement: unknown }) => unknown;

before(async () => {
    (globalThis as Record<string, unknown>)["JSWindowActorChild"] = FakeActorChild;
    const module = await import("../src/chrome/page_actor_child.ts");
    ChildClass = module.DesertBirdPageChild as unknown as typeof ChildClass;
    deepest_focus = module.deepest_focus as typeof deepest_focus;
});

// A small page tree as the parent pushes it: `g g`, `g ?`, `t 0`, `m` followed by any key, `i` into insert mode.
const ON: ActorState = {
    on: true,
    insert: false,
    page: { j: "run", G: "run", g: { g: "run", "?": "run" }, t: { "0": "run" }, "<C-d>": "run", i: "insert", m: { "": "run" } },
    typing: { "<A-j>": "run", "<Escape>": "normal", "<C-[>": "normal" },
};

function child_with(state: ActorState = ON, focus: unknown = { localName: "body" }): Child {
    const child = new ChildClass();
    child.apply(state);
    child.document.activeElement = focus;
    return child;
}

function keydown(key: string, options: Record<string, unknown> = {}) {
    const result = { type: "keydown", key, code: "", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, defaultPrevented: false, cancelled: false, stopped: false, preventDefault() { result.cancelled = true; result.defaultPrevented = true; }, stopPropagation() { result.stopped = true; }, ...options };
    return result;
}

const keys_sent = (child: Child) => child.sent.filter(([name]) => name === "DesertBird:Key").map(([, data]) => data as Record<string, unknown>);

test("a child says hello when it is made and takes no key until the parent answers", () => {
    const child = new ChildClass();
    child.actorCreated();
    assert.deepEqual(child.queries, ["DesertBird:Hello"]);
    const event = keydown("j");
    child.handleEvent(event);
    assert.equal(event.cancelled, false);
    assert.deepEqual(child.sent, []);
});

test("a hello that fails leaves the child off", async () => {
    const child = new ChildClass();
    child.query_answer = Promise.reject(new Error("no parent"));
    child.actorCreated();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(child.on, false);
});

test("the hello answer turns the child on", async () => {
    const child = new ChildClass();
    child.query_answer = Promise.resolve(ON);
    child.actorCreated();
    await new Promise((resolve) => setImmediate(resolve));
    const event = keydown("j");
    child.handleEvent(event);
    assert.equal(event.cancelled, true);
});

test("outside a field, a key of the page set is cancelled and sent, and any other key stays the page's", () => {
    const child = child_with();
    const bound = keydown("j");
    const unbound = keydown("x");
    const chord = keydown("d", { ctrlKey: true });
    for (const event of [bound, unbound, chord]) child.handleEvent(event);
    assert.deepEqual([bound.cancelled && bound.stopped, unbound.cancelled, chord.cancelled], [true, false, true]);
    assert.deepEqual(keys_sent(child).map((key) => [key["key"], key["field"]]), [["j", false], ["d", false]]);
});

test("the sent key carries the key fields and two flags only", () => {
    const child = child_with();
    child.handleEvent(keydown("j", { target: { secret: "page text" } }));
    assert.deepEqual(Object.keys(keys_sent(child)[0]!).sort(), ["altKey", "code", "ctrlKey", "field", "key", "metaKey", "prevented", "shiftKey"]);
});

test("the field check follows DesertFox: text inputs, textarea, contenteditable, select, design mode, and not a check box or a button", () => {
    const cases: [unknown, boolean][] = [
        [{ localName: "input", type: "text" }, true],
        [{ localName: "input", type: "search" }, true],
        [{ localName: "input", type: "checkbox" }, false],
        [{ localName: "input", type: "button" }, false],
        [{ localName: "textarea" }, true],
        [{ localName: "select" }, true],
        [{ localName: "div", isContentEditable: true }, true],
        [{ localName: "button" }, false],
        [{ localName: "body" }, false],
    ];
    for (const [focus, field] of cases) {
        const child = child_with(ON, focus);
        const event = keydown("j");
        child.handleEvent(event);
        assert.equal(event.cancelled, !field, JSON.stringify(focus));
    }
    const designed = child_with();
    designed.document.designMode = "on";
    const event = keydown("j");
    designed.handleEvent(event);
    assert.equal(event.cancelled, false, "design mode");
});

test("the focus is followed into shadow roots and same-process frames", () => {
    const input = { localName: "input", type: "text" };
    const host = { localName: "my-editor", shadowRoot: { activeElement: input } };
    const frame = { localName: "iframe", contentDocument: { activeElement: host } };
    assert.equal(deepest_focus({ activeElement: frame }), input);
    const child = child_with(ON, frame);
    const event = keydown("j");
    child.handleEvent(event);
    assert.equal(event.cancelled, false);
});

test("in a field only the typing set is taken: Alt+j is cancelled and sent, a plain key is text", () => {
    const child = child_with(ON, { localName: "textarea" });
    const plain = keydown("j");
    const alt = keydown("j", { altKey: true });
    child.handleEvent(plain);
    child.handleEvent(alt);
    assert.deepEqual([plain.cancelled, alt.cancelled], [false, true]);
    assert.deepEqual(keys_sent(child).map((key) => [key["key"], key["field"]]), [["j", true]]);
});

test("in insert mode a plain key is dropped at once, before the focus is read, and a chord of the typing set still runs", () => {
    const child = child_with({ ...ON, insert: true });
    let focus_reads = 0;
    Object.defineProperty(child.document, "activeElement", { get: () => (focus_reads++, null) });
    const plain = keydown("j");
    child.handleEvent(plain);
    assert.equal(plain.cancelled, false);
    assert.equal(focus_reads, 0);
    assert.deepEqual(child.sent, []);
    const alt = keydown("j", { altKey: true });
    child.handleEvent(alt);
    assert.equal(alt.cancelled, true);
});

test("a pushed state replaces the copy at once: insert on, then the keymap changes", () => {
    const child = child_with();
    child.receiveMessage({ name: "DesertBird:State", data: { ...ON, insert: true } });
    const in_insert = keydown("j");
    child.handleEvent(in_insert);
    assert.equal(in_insert.cancelled, false);
    child.receiveMessage({ name: "DesertBird:State", data: { ...ON, page: { x: "run" } } });
    const old_key = keydown("j");
    const new_key = keydown("x");
    child.handleEvent(old_key);
    child.handleEvent(new_key);
    assert.deepEqual([old_key.cancelled, new_key.cancelled], [false, true]);
    child.receiveMessage({ name: "DesertBird:State", data: { ...ON, on: false } });
    const off = keydown("x");
    child.handleEvent(off);
    assert.equal(off.cancelled, false);
});

test("Escape stays the page's and is sent once the page's handlers ran, with whether one used it", () => {
    const child = child_with(ON, { localName: "input", type: "text" });
    const escape = keydown("Escape");
    child.handleEvent(escape);
    assert.equal(escape.cancelled, false);
    assert.deepEqual(child.sent, [], "nothing is sent during the dispatch");
    escape.defaultPrevented = true;
    for (const timer of child.timers) timer();
    assert.deepEqual(keys_sent(child).map((key) => [key["key"], key["field"], key["prevented"]]), [["Escape", true, true]]);
});

/** Presses keys in order and returns, per key, whether the child cancelled it and whether it sent it. */
function type_keys(child: Child, keys: [string, Record<string, unknown>?][]) {
    return keys.map(([key, options]) => {
        const before = keys_sent(child).length;
        const event = keydown(key, options);
        child.handleEvent(event);
        return [key, event.cancelled, keys_sent(child).length > before];
    });
}

test("only the first keys of the page tree are taken at the root: a key that appears only after a prefix (YouTube m's neighbors 0, ?) stays the page's", () => {
    const child = child_with();
    assert.deepEqual(type_keys(child, [["?"], ["0"], ["x"], ["j"]]), [["?", false, false], ["0", false, false], ["x", false, false], ["j", true, true]]);
});

test("after a prefix the child takes the branch's keys, and g g reaches the parent as two taken keys", () => {
    const child = child_with();
    assert.deepEqual(type_keys(child, [["g"], ["?"], ["t"], ["0"], ["g"], ["g"]]), [["g", true, true], ["?", true, true], ["t", true, true], ["0", true, true], ["g", true, true], ["g", true, true]]);
});

test("g then an unbound x is sent uncancelled, so the parent ends the sequence and its key list, and the page still gets x", () => {
    const child = child_with();
    assert.deepEqual(type_keys(child, [["g"], ["x"], ["g"], ["x"]]), [["g", true, true], ["x", false, true], ["g", true, true], ["x", false, true]]);
    // The walk is back at the root: a lone x is the page's and is not sent.
    assert.deepEqual(type_keys(child, [["x"]]), [["x", false, false]]);
});

test("a key that breaks a prefix and binds at the root is taken as a first key, as the matcher retries it", () => {
    const child = child_with();
    assert.deepEqual(type_keys(child, [["g"], ["j"], ["g"], ["g"]]), [["g", true, true], ["j", true, true], ["g", true, true], ["g", true, true]]);
});

test("a count is taken: 1 to 9 start it, 0 continues it whatever the bindings, and an unbound key after it ends it", () => {
    const child = child_with({ ...ON, page: { j: "run" } });
    assert.deepEqual(type_keys(child, [["1"], ["0"], ["j"]]), [["1", true, true], ["0", true, true], ["j", true, true]]);
    assert.deepEqual(type_keys(child, [["0"]]), [["0", false, false]], "0 alone starts no count");
    assert.deepEqual(type_keys(child, [["5"], ["x"]]), [["5", true, true], ["x", false, true]]);
});

test("Backspace in a half-typed sequence is taken and drops the last key, and without one it stays the page's", () => {
    const child = child_with();
    assert.deepEqual(type_keys(child, [["Backspace"]]), [["Backspace", false, false]]);
    assert.deepEqual(type_keys(child, [["g"], ["Backspace"], ["j"]]), [["g", true, true], ["Backspace", true, true], ["j", true, true]]);
    assert.deepEqual(type_keys(child, [["x"]]), [["x", false, false]], "the Backspace left the walk at the root");
});

test("a branch that captures any key takes the next printable key", () => {
    const child = child_with();
    assert.deepEqual(type_keys(child, [["m"], ["q"], ["q"]]), [["m", true, true], ["q", true, true], ["q", false, false]]);
});

test("i enters insert mode in the child at once, so a fast key after it reaches the page before the parent's push", () => {
    const child = child_with();
    assert.deepEqual(type_keys(child, [["i"], ["j"]]), [["i", true, true], ["j", false, false]]);
    assert.equal(child.insert, true);
});

test("Escape the page did not use leaves insert mode in the child, so a fast key after it is taken again; a used Escape keeps insert mode", () => {
    const child = child_with({ ...ON, insert: true });
    const used = keydown("Escape");
    child.handleEvent(used);
    used.defaultPrevented = true;
    for (const timer of child.timers.splice(0)) timer();
    assert.equal(child.insert, true);
    child.handleEvent(keydown("Escape"));
    for (const timer of child.timers.splice(0)) timer();
    assert.equal(child.insert, false);
    assert.deepEqual(type_keys(child, [["j"]]), [["j", true, true]]);
    const bracket = child_with({ ...ON, insert: true });
    assert.deepEqual(type_keys(bracket, [["[", { ctrlKey: true }], ["j"]]), [["[", true, true], ["j", true, true]], "Ctrl+[ leaves at once");
});

test("in insert mode a focused link is no field: Escape goes to the parent with field false", () => {
    const child = child_with({ ...ON, insert: true }, { localName: "a" });
    child.handleEvent(keydown("Escape"));
    for (const timer of child.timers) timer();
    assert.deepEqual(keys_sent(child).map((key) => [key["key"], key["field"]]), [["Escape", false]]);
});

test("a pushed state starts the walk over", () => {
    const child = child_with();
    type_keys(child, [["g"]]);
    child.receiveMessage({ name: "DesertBird:State", data: ON });
    assert.deepEqual(type_keys(child, [["?"]]), [["?", false, false]]);
});

test("Escape is not sent when no tree binds it", () => {
    const child = child_with({ ...ON, typing: { "<A-j>": "run" } });
    child.handleEvent(keydown("Escape"));
    assert.deepEqual(child.timers, []);
});

test("a key typed while an input method composes is the page's", () => {
    const child = child_with();
    const event = keydown("j", { isComposing: true });
    child.handleEvent(event);
    assert.equal(event.cancelled, false);
});

test("a page back from the back-forward cache asks again, and a first show does not", () => {
    const child = child_with();
    child.handleEvent({ type: "pageshow", persisted: false });
    assert.deepEqual(child.queries, []);
    child.handleEvent({ type: "pageshow", persisted: true });
    assert.deepEqual(child.queries, ["DesertBird:Hello"]);
});

test("a send to a parent that is gone turns the child off, so it stops taking keys", () => {
    const child = child_with();
    child.send_throws = true;
    child.handleEvent(keydown("j"));
    assert.equal(child.on, false);
    const next = keydown("j");
    child.handleEvent(next);
    assert.equal(next.cancelled, false);
});

test("Blur blurs the deepest focused element, and Scroll runs only an id of the fixed table", () => {
    let blurred = 0;
    const input = { localName: "input", type: "text", blur: () => void blurred++ };
    const child = child_with(ON, { localName: "my-editor", shadowRoot: { activeElement: input } });
    child.receiveMessage({ name: "DesertBird:Blur" });
    assert.equal(blurred, 1);
    const moves: unknown[] = [];
    const root = { scrollHeight: 5000, clientHeight: 500, scrollBy: (options: unknown) => void moves.push(options), scrollTo: (options: unknown) => void moves.push(options) };
    const page = child_with(ON, { localName: "body" });
    page.document.scrollingElement = root;
    page.receiveMessage({ name: "DesertBird:Scroll", data: { id: "page.scroll_down", count: 3 } });
    page.receiveMessage({ name: "DesertBird:Scroll", data: { id: "eval", count: 1 } });
    page.receiveMessage({ name: "DesertBird:Scroll", data: { id: 42 } });
    assert.deepEqual(moves, [{ top: 120, behavior: "instant" }]);
});

test("a count stops at the matcher's six digits: a seventh 0 breaks it and reaches the page", () => {
    const child = child_with({ ...ON, page: { j: "run" } });
    assert.deepEqual(type_keys(child, [["1"], ["2"], ["3"], ["4"], ["5"], ["6"]]).map(([, cancelled]) => cancelled), [true, true, true, true, true, true]);
    assert.deepEqual(type_keys(child, [["0"]]), [["0", false, true]]);
    assert.deepEqual(type_keys(child, [["7"], ["j"]]), [["7", true, true], ["j", true, true]], "a seventh digit 1 to 9 starts a new count, as the matcher retries it");
});

test("a bound sequence that starts with a digit is a prefix and no count", () => {
    const child = child_with({ ...ON, page: { "0": { x: "run" }, j: "run" } });
    assert.deepEqual(type_keys(child, [["0"], ["x"]]), [["0", true, true], ["x", true, true]]);
    assert.deepEqual(type_keys(child, [["5"], ["0"], ["x"]]).map(([, cancelled]) => cancelled), [true, true, false]);
});

test("a key typed in a field ends a half-typed sequence: the child says hello, so the parent ends its own, and sends no text", () => {
    const child = child_with();
    type_keys(child, [["g"]]);
    child.document.activeElement = { localName: "input", type: "text" };
    const before = keys_sent(child).length;
    child.handleEvent(keydown("x"));
    assert.deepEqual(child.queries, ["DesertBird:Hello"]);
    assert.equal(keys_sent(child).length, before, "the typed letter is not sent");
    child.document.activeElement = { localName: "body" };
    assert.deepEqual(type_keys(child, [["?"]]), [["?", false, false]], "the walk is back at the root");
});
