import assert from "node:assert/strict";
import { test } from "node:test";
import { create_hint_session, type HintLabelNode, type HintWindow } from "../src/content/body_hints.ts";

interface FakeElement {
    name: string;
    box: { top: number; left: number; width: number; height: number };
    style: { display: string; visibility: string; opacity: string };
    covered: boolean;
    tag: string;
    acted: string[];
    getBoundingClientRect(): FakeElement["box"];
    contains(other: unknown): boolean;
    href?: string;
    textContent?: string;
    focus(): void;
    matches(selector: string): boolean;
}

function fake_element(name: string, overrides: Partial<Pick<FakeElement, "box" | "style" | "covered" | "tag" | "href" | "textContent">> = {}): FakeElement {
    const element: FakeElement = {
        name,
        box: { top: 10, left: 10, width: 50, height: 20 },
        style: { display: "inline", visibility: "visible", opacity: "1" },
        covered: false,
        tag: "a",
        acted: [],
        ...overrides,
        getBoundingClientRect: () => element.box,
        contains: (other) => other === element,
        focus: () => element.acted.push("focus"),
        // The real selector, so a tag added to or dropped from the openable list changes a result here.
        matches: (selector) => selector.split(",").some((part) => part.trim().replace(/\[.*$/, "") === element.tag),
    };
    return element;
}

function fake_node(): HintLabelNode & { removed: boolean } {
    const node = {
        textContent: null as string | null,
        style: { cssText: "" },
        removed: false,
        remove: () => {
            node.removed = true;
        },
        append: () => {},
        attachShadow: () => ({ append: () => {} }),
    };
    return node;
}

function fake_window(elements: FakeElement[]): { window: HintWindow; appended: (HintLabelNode & { removed: boolean })[] } {
    const appended: (HintLabelNode & { removed: boolean })[] = [];
    const window: HintWindow = {
        innerHeight: 600,
        innerWidth: 800,
        getComputedStyle: (element) => (element as unknown as FakeElement).style,
        document: {
            querySelectorAll: () => elements as never,
            // The element on top at its centre: a covered element reports a different one.
            elementFromPoint: (x, y) => elements.find((element) => !element.covered && x >= element.box.left && x <= element.box.left + element.box.width && y >= element.box.top && y <= element.box.top + element.box.height) ?? null,
            createElement: () => fake_node(),
            documentElement: { append: (child) => appended.push(child as never) },
        },
    };
    return { window, appended };
}

const opened: number[] = [];
const copied: string[] = [];
const typed = (letter: string) => ({ kind: "typed", letter }) as const;

test("begin labels only the elements a mouse would hit", () => {
    const shown = fake_element("shown");
    const hidden = fake_element("hidden", { style: { display: "inline", visibility: "hidden", opacity: "1" } });
    const faded = fake_element("faded", { style: { display: "inline", visibility: "visible", opacity: "0" } });
    const none = fake_element("none", { style: { display: "none", visibility: "visible", opacity: "1" } });
    const flat = fake_element("flat", { box: { top: 10, left: 10, width: 0, height: 20 } });
    const below = fake_element("below", { box: { top: 700, left: 10, width: 50, height: 20 } });
    const covered = fake_element("covered", { covered: true });
    const { window } = fake_window([shown, hidden, faded, none, flat, below, covered]);
    const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
    assert.equal(session.begin(), 1);
    assert.equal(session.active(), true);
});

test("begin stays inactive and adds nothing when no element qualifies", () => {
    const { window, appended } = fake_window([fake_element("hidden", { style: { display: "none", visibility: "visible", opacity: "1" } })]);
    const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
    assert.equal(session.begin(), 0);
    assert.equal(session.active(), false);
    assert.equal(appended.length, 0);
});

test("a picked button gets the focus and the Enter", () => {
    opened.length = 0;
    const button = fake_element("button", { tag: "button" });
    const { window } = fake_window([button]);
    const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
    session.begin();
    session.feed(typed("a"));
    assert.deepEqual(button.acted, ["focus"]);
    assert.equal(opened.length, 1);
});

test("a picked form control gets the focus and no Enter", () => {
    opened.length = 0;
    const field = fake_element("field", { tag: "input" });
    const { window } = fake_window([field]);
    const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
    session.begin();
    session.feed(typed("a"));
    assert.deepEqual(field.acted, ["focus"]);
    assert.deepEqual(opened, []);
});

test("a typed label acts on its element once and ends the session", () => {
    opened.length = 0;
    const first = fake_element("first");
    const second = fake_element("second", { box: { top: 50, left: 10, width: 50, height: 20 } });
    const { window, appended } = fake_window([first, second]);
    const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
    session.begin();
    session.feed(typed("s"));
    assert.deepEqual(first.acted, []);
    assert.deepEqual(second.acted, ["focus"]);
    assert.equal(opened.length, 1, "a link asks for the Enter once");
    assert.equal(session.active(), false);
    assert.equal(appended[0]!.removed, true);
});

test("a letter that no label starts, and cancel, end the session with no pick", () => {
    for (const key of [typed("z"), { kind: "cancel" } as const]) {
        const only = fake_element("only");
        const { window, appended } = fake_window([only]);
        const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
        session.begin();
        session.feed(key);
        assert.equal(session.active(), false);
        assert.deepEqual(only.acted, []);
        assert.equal(appended[0]!.removed, true);
    }
});

test("with many targets a label takes several letters and a partial label keeps the session open", () => {
    const elements = Array.from({ length: 12 }, (_, index) => fake_element(`link${index}`, { box: { top: 5 + index * 25, left: 10, width: 50, height: 20 } }));
    const { window } = fake_window(elements);
    const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
    assert.equal(session.begin(), 12);
    session.feed(typed("a"));
    assert.equal(session.active(), true);
    assert.ok(elements.every((element) => element.acted.length === 0));
    session.feed(typed("a"));
    assert.equal(session.active(), false);
    assert.equal(elements[0]!.acted.length, 1);
});

test("cancel removes the labels and a second begin starts fresh", () => {
    const only = fake_element("only");
    const { window, appended } = fake_window([only]);
    const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
    session.begin();
    session.cancel();
    assert.equal(session.active(), false);
    assert.equal(appended[0]!.removed, true);
    session.begin();
    session.feed(typed("a"));
    assert.deepEqual(only.acted, ["focus"]);
});

test("the label carries the colors the background published as literal declarations, so no mail custom property reaches it", () => {
    const styles: string[] = [];
    const { window } = fake_window([fake_element("link")]);
    const create = window.document.createElement;
    window.document.createElement = (name) => {
        const node = create(name);
        node.attachShadow = () => ({ append: (...children) => void children.forEach((child) => styles.push(child.style.cssText)) });
        return node;
    };
    create_hint_session(window, () => {}, () => "background: #123456 !important;", () => {}).begin();
    assert.equal(styles.length, 1);
    assert.match(styles[0]!, /background: #123456 !important;/);
    assert.doesNotMatch(styles[0]!, /var\(/);
});

test("focus, activate and yank pick the action: focus only, focus and open, copy", () => {
    for (const [action, acted, opens, copies] of [["focus", ["focus"], 0, []], ["activate", ["focus"], 1, []], ["yank", [], 0, ["https://example.org/x"]]] as const) {
        opened.length = 0;
        copied.length = 0;
        const link = fake_element("link", { href: "https://example.org/x" });
        const { window, appended } = fake_window([link]);
        const session = create_hint_session(window, () => opened.push(1), () => "", (text) => copied.push(text));
        assert.equal(session.begin(action), 1);
        assert.equal(session.active(), true);
        assert.equal(appended.length, 1, action);
        session.feed(typed("a"));
        assert.deepEqual(link.acted, acted, action);
        assert.equal(opened.length, opens, action);
        assert.deepEqual(copied, copies, action);
        assert.equal(session.active(), false);
    }
});

test("a yank copies the address, else the trimmed text, and labels no element with neither", () => {
    copied.length = 0;
    const link = fake_element("link", { href: "https://example.org/x", textContent: "ignored" });
    const button = fake_element("button", { tag: "button", textContent: "  Reply  ", box: { top: 100, left: 10, width: 50, height: 20 } });
    const empty = fake_element("empty", { tag: "button", textContent: "   ", box: { top: 200, left: 10, width: 50, height: 20 } });
    const { window } = fake_window([empty, link, button]);
    const session = create_hint_session(window, () => {}, () => "", (text) => copied.push(text));
    assert.equal(session.begin("yank"), 2);
    session.feed(typed("s"));
    assert.deepEqual(copied, ["Reply"]);
    assert.equal(session.begin("yank"), 2);
    session.feed(typed("a"));
    assert.deepEqual(copied, ["Reply", "https://example.org/x"]);
});
