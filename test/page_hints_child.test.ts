import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { HintsChild, HintsRequest } from "../src/chrome/page_hints_child.ts";

const SCHEME = { fill: "#112233", text: "#ffffff" };
const copied: string[] = [];
let start: (child: HintsChild, request: HintsRequest) => number;
let end_pick: () => void;

before(async () => {
    const globals = globalThis as Record<string, unknown>;
    globals["Cc"] = { "@mozilla.org/widget/clipboardhelper;1": { getService: () => ({ copyString: (text: string) => void copied.push(text) }) } };
    globals["Ci"] = { nsIClipboardHelper: {} };
    start = (await import("../src/chrome/page_hints_child.ts")).start;
    end_pick = (await import("../src/chrome/hint_pick.ts")).end_pick;
});

afterEach(() => {
    end_pick();
    copied.length = 0;
});

interface FakeControl {
    id: string;
    href?: string | undefined;
    textContent: string;
    clicked: number;
    focused: number;
}

/** A web page as the child's `contentWindow` shows it: controls on screen, a root element that takes the label container, and the listeners the hint module adds. */
function fake_page(controls: FakeControl[]) {
    const listeners = new Map<string, Set<(event: { type: string; target: unknown }) => void>>();
    const containers: { removed: boolean }[] = [];
    const elements = controls.map((control) => ({
        ...control,
        getBoundingClientRect: () => ({ top: 10, left: 10, width: 20, height: 10 }),
        contains: () => true,
        // The scan keeps what matches the page selector, which starts with the button rule. The field rule list has no button.
        matches: (selector: string) => selector.startsWith("button") || (selector.includes("input") && control.id === "field" && !selector.includes("a[href]")),
        closest: () => null,
        click: () => void control.clicked++,
        focus: () => void control.focused++,
    }));
    const make = (tag: string) => {
        const node = { textContent: null, style: { cssText: "" }, removed: false, remove: () => void (node.removed = true), append() {}, attachShadow: () => ({ append() {} }) };
        if (tag === "div") containers.push(node);
        return node;
    };
    const page = {
        innerHeight: 600,
        innerWidth: 800,
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
        document: { querySelectorAll: () => elements, elementFromPoint: () => null, createElement: make, documentElement: { append() {} } },
        addEventListener: (type: string, listener: (event: { type: string; target: unknown }) => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
        removeEventListener: (type: string, listener: (event: { type: string; target: unknown }) => void) => void listeners.get(type)?.delete(listener),
    };
    const fire = (type: string, target: unknown = page) => [...(listeners.get(type) ?? [])].forEach((listener) => listener({ type, target }));
    const listening = () => [...listeners.entries()].filter(([, set]) => set.size > 0).map(([type]) => type);
    return { page, containers, fire, listening };
}

const control = (id: string, text = "", href?: string): FakeControl => ({ id, textContent: text, href, clicked: 0, focused: 0 });

function key(key: string) {
    const event = { key, ctrlKey: false, altKey: false, metaKey: false, cancelled: false, stopped: false, preventDefault: () => void (event.cancelled = true), stopPropagation: () => void (event.stopped = true) };
    return event;
}

test("start labels the controls on screen, hands the child the key reader, and a typed label clicks its target and ends the labels", () => {
    const button = control("button", "Button");
    const link = control("link", "Link", "https://example.org/a");
    const { page, containers, listening } = fake_page([button, link]);
    const child: HintsChild = { contentWindow: page, pick: null };
    assert.equal(start(child, { scheme: SCHEME, action: "activate" }), 2);
    assert.equal(containers.length, 1);
    assert.deepEqual(listening().sort(), ["blur", "pagehide", "pointerdown", "scroll"]);
    const typed = key("s");
    child.pick!.key(typed);
    assert.ok(typed.cancelled && typed.stopped, "the page never sees the label key");
    assert.equal(link.clicked, 1);
    assert.equal(child.pick, null, "the child takes keys for the page again");
    assert.ok(containers[0]!.removed);
    assert.deepEqual(listening(), []);
});

test("start labels from the letters the parent sends, and a typed digit of that alphabet picks", () => {
    const first = control("button", "First");
    const second = control("link", "Second", "https://example.org/b");
    const { page } = fake_page([first, second]);
    const child: HintsChild = { contentWindow: page, pick: null };
    assert.equal(start(child, { scheme: SCHEME, action: "activate", letters: "j1" }), 2);
    child.pick!.key(key("1"));
    assert.equal(second.clicked, 1, "the second label is 1");
    assert.equal(first.clicked, 0);
});

test("a key no label starts ends the labels and acts on nothing", () => {
    const button = control("button", "Button");
    const { page, containers } = fake_page([button]);
    const child: HintsChild = { contentWindow: page, pick: null };
    start(child, { scheme: SCHEME, action: "activate" });
    const typed = key("x");
    child.pick!.key(typed);
    assert.ok(typed.cancelled, "the ending key is cancelled too");
    assert.equal(button.clicked, 0);
    assert.equal(child.pick, null);
    assert.ok(containers[0]!.removed);
});

test("the focus action focuses, and the yank copies the link address in the page's process", () => {
    const field = control("field");
    const link = control("link", "Link", "https://example.org/a");
    const { page } = fake_page([field, link]);
    const child: HintsChild = { contentWindow: page, pick: null };
    assert.equal(start(child, { scheme: SCHEME, action: "focus" }), 2);
    child.pick!.key(key("a"));
    assert.equal(field.focused, 1);
    // A yank skips the field, which has no text, so the link is a.
    assert.equal(start(child, { scheme: SCHEME, action: "yank" }), 1);
    child.pick!.key(key("a"));
    assert.deepEqual(copied, ["https://example.org/a"]);
    assert.equal(link.clicked, 0);
});

for (const type of ["pagehide", "scroll", "pointerdown", "blur"]) {
    test(`a ${type} in the page ends the labels`, () => {
        const { page, containers, fire, listening } = fake_page([control("button", "Button")]);
        const child: HintsChild = { contentWindow: page, pick: null };
        start(child, { scheme: SCHEME, action: "activate" });
        fire(type);
        assert.equal(child.pick, null);
        assert.ok(containers[0]!.removed);
        assert.deepEqual(listening(), []);
    });
}

test("a blur of an element inside the page keeps the labels, since the focus stays in the page", () => {
    const { page, containers, fire } = fake_page([control("button", "Button")]);
    const child: HintsChild = { contentWindow: page, pick: null };
    start(child, { scheme: SCHEME, action: "activate" });
    fire("blur", { id: "field" });
    assert.notEqual(child.pick, null);
    assert.equal(containers[0]!.removed, false);
});

test("the child's end, which a state push from the parent calls, ends the labels", () => {
    const { page, containers } = fake_page([control("button", "Button")]);
    const child: HintsChild = { contentWindow: page, pick: null };
    start(child, { scheme: SCHEME, action: "activate" });
    child.pick!.end();
    assert.equal(child.pick, null);
    assert.ok(containers[0]!.removed);
});

test("a second start, in this page or another of the process, ends the first, so only the newest child holds a key reader", () => {
    const first = fake_page([control("button", "Button")]);
    const second = fake_page([control("button", "Button")]);
    const first_child: HintsChild = { contentWindow: first.page, pick: null };
    const second_child: HintsChild = { contentWindow: second.page, pick: null };
    start(first_child, { scheme: SCHEME, action: "activate" });
    start(second_child, { scheme: SCHEME, action: "activate" });
    assert.equal(first_child.pick, null);
    assert.ok(first.containers[0]!.removed);
    assert.deepEqual(first.listening(), []);
    assert.notEqual(second_child.pick, null);
    // A late end for the first page reaches nothing, since its child no longer holds the pick.
    (first_child.pick as HintsChild["pick"])?.end();
    assert.notEqual(second_child.pick, null);
});

test("a page with nothing on screen gets no labels and no key reader", () => {
    const { page, containers } = fake_page([]);
    const child: HintsChild = { contentWindow: page, pick: null };
    assert.equal(start(child, { scheme: SCHEME, action: "activate" }), 0);
    assert.equal(child.pick, null);
    assert.equal(containers.length, 0);
});
