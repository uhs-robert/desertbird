import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { end_pick, start_pick } from "../src/chrome/hint_pick.ts";
import { as_event_keys } from "../src/shared/hint_hold.ts";
import type { PickHost, PickKeyEvent, PickTarget } from "../src/chrome/hint_pick.ts";
import type { HintLabelNode, HintWindow } from "../src/shared/hint_view.ts";

interface FakeNode extends HintLabelNode {
    removed: boolean;
}

const SCHEME = { fill: "#112233", text: "#ffffff" };

function fake_window(name: string): { window: HintWindow; containers: FakeNode[]; spans: FakeNode[] } {
    const containers: FakeNode[] = [];
    const spans: FakeNode[] = [];
    const make = (tag: string): FakeNode => {
        const node: FakeNode = { textContent: null, style: { cssText: "" }, removed: false, remove: () => void (node.removed = true), append: () => {}, attachShadow: () => ({ append: (...children) => void (children as FakeNode[]).forEach((child) => spans.push(child)) }) };
        if (tag === "div") containers.push(node);
        return node;
    };
    const window = { name, innerHeight: 600, innerWidth: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }), document: { querySelectorAll: () => [], elementFromPoint: () => null, createElement: make, documentElement: { append: () => {} } } };
    return { window: window as unknown as HintWindow, containers, spans };
}

function fake_host() {
    const state = { key: null as null | ((event: PickKeyEvent) => void), disturb: null as null | (() => void), stopped: [] as string[], copied: [] as string[], holds: [] as number[], now: 1000 };
    const host: PickHost = {
        copy: (text) => void state.copied.push(text),
        on_key: (listener) => ((state.key = listener), { hold: (ends_at) => void state.holds.push(ends_at), stop: () => void state.stopped.push("keys") }),
        now: () => state.now,
        on_disturb: (listener) => ((state.disturb = listener), () => void state.stopped.push("disturb")),
    };
    const press = (key: string, chord: Partial<PickKeyEvent> = {}) => {
        const seen = { prevented: false, stopped: false };
        state.key!({ key, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => void (seen.prevented = true), stopPropagation: () => void (seen.stopped = true), ...chord });
        return seen;
    };
    return { host, state, press };
}

function targets_in(window: HintWindow, count: number, acted: string[], prefix = "t", text = (index: number) => `text${index}`): PickTarget[] {
    return Array.from({ length: count }, (_, index) => ({ window, element: { getBoundingClientRect: () => ({ top: index * 20, left: 5, width: 30, height: 10 }) } as never, act: () => void acted.push(`${prefix}${index}`), focus: () => void acted.push(`focus ${prefix}${index}`), text: text(index) }));
}

afterEach(() => end_pick());

test("with no target nothing starts and no key is taken", () => {
    const { host, state } = fake_host();
    assert.equal(start_pick(host, [], SCHEME), 0);
    assert.equal(state.key, null);
});

test("each document draws the labels of its own targets, in the colors given, and the labels are unique across documents", () => {
    const { host } = fake_host();
    const first = fake_window("first");
    const second = fake_window("second");
    const acted: string[] = [];
    assert.equal(start_pick(host, [...targets_in(first.window, 2, acted), ...targets_in(second.window, 3, acted)], SCHEME), 5);
    assert.equal(first.containers.length, 1);
    assert.equal(second.containers.length, 1);
    assert.deepEqual(first.spans.map((span) => span.textContent), ["A", "S"]);
    assert.deepEqual(second.spans.map((span) => span.textContent), ["D", "F", "G"]);
    assert.match(first.spans[0]!.style.cssText, /background: #112233 !important; color: #ffffff !important/);
});

test("a typed label acts on its target once, then the labels and the key listener go", () => {
    const { host, state, press } = fake_host();
    const { window, containers } = fake_window("only");
    const acted: string[] = [];
    start_pick(host, targets_in(window, 12, acted), SCHEME);
    assert.equal(press("a").prevented, true, "the key never reaches a command");
    assert.deepEqual(acted, []);
    press("D");
    assert.deepEqual(acted, ["t2"], "2 letter labels: aa, as, ad, ...");
    assert.equal(containers[0]!.removed, true);
    assert.deepEqual(state.stopped.sort(), ["disturb", "keys"]);
});

test("a typed letter removes the labels that no longer match", () => {
    const { host, press } = fake_host();
    const { window, spans } = fake_window("only");
    start_pick(host, targets_in(window, 12, []), SCHEME);
    press("s");
    // Twelve targets take two letters: nine labels start with `a`, three with `s`.
    assert.equal(spans.filter((span) => span.removed).length, 9);
    assert.equal(spans.filter((span) => !span.removed).length, 3);
});

test("a typed character no label continues with is a typo: it ends the labels and keeps the keys. A chord and named keys cancel. A lone modifier does neither", () => {
    for (const [key, chord, kind] of [["z", {}, "typo"], [" ", {}, "typo"], ["1", {}, "typo"], [";", {}, "typo"], ["Escape", {}, "cancel"], ["Tab", {}, "cancel"], ["a", { ctrlKey: true }, "cancel"], ["Shift", {}, "none"]] as const) {
        const { host, state, press } = fake_host();
        const { window, containers } = fake_window("only");
        const acted: string[] = [];
        start_pick(host, targets_in(window, 12, acted), SCHEME);
        const seen = press(key, chord);
        assert.equal(seen.prevented && seen.stopped, true, key);
        assert.equal(containers[0]!.removed, kind !== "none", key);
        assert.deepEqual(state.holds, kind === "typo" ? [2500] : [], `${key}: a typo holds until 1.5 s after the pick began`);
        assert.equal(state.stopped.includes("keys"), kind === "cancel", key);
        assert.deepEqual(acted, []);
        end_pick();
    }
});

// f, the labels, c (no label), then c again at a human pace: the second c must not run a command, in the body as in the list.
test("after a typo the pick drops plain keys until 1.5 s after it began, and lets the keys of a new pick through", () => {
    const { host, state, press } = fake_host();
    const { window } = fake_window("only");
    start_pick(host, targets_in(window, 12, []), SCHEME, "activate", [["f"], [";", "f"]]);
    state.now += 300;
    press("c");
    state.now += 150;
    assert.equal(press("c").prevented, true, "the second c is dropped");
    assert.equal(press("a").prevented, true, "so is a label letter typed from memory");
    assert.equal(press("Escape").prevented, false, "a named key passes");
    assert.equal(press(";").prevented, false, "the start of ; f passes");
    assert.equal(press("f").prevented, false, "and its end, so the runtime labels again");
    assert.equal(press("f").prevented, false, "a lone f passes too");
    assert.equal(press("d").prevented, true);
    assert.deepEqual(state.stopped, [], "the keys are still held");
    state.now += 1100;
    assert.equal(press("d").prevented, false, "once the hold is over, keys run");
    assert.deepEqual(state.stopped.sort(), ["disturb", "keys"]);
});

test("Backspace in the hold steps the held prefix back, so a c after ; Backspace is dropped but an unbroken ; c restarts", () => {
    const { host, state, press } = fake_host();
    const { window } = fake_window("only");
    start_pick(host, targets_in(window, 12, []), SCHEME, "activate", [["f"], [";", "c"]]);
    press("z");
    assert.equal(press(";").prevented, false);
    assert.equal(press("Backspace").prevented, false, "Backspace passes");
    assert.equal(press("c").prevented, true, "the matcher dropped the ;, so c stands alone");
    assert.equal(press(";").prevented, false);
    assert.equal(press("c").prevented, false, "an unbroken ; c is a restart");
    assert.deepEqual(state.stopped, []);
});

test("a hint binding that starts with Space passes the hold, where the tree token is <Space> and the event key is a space", () => {
    const { host, press } = fake_host();
    const { window } = fake_window("only");
    start_pick(host, targets_in(window, 12, []), SCHEME, "activate", as_event_keys([["<Space>", "f"]]));
    press("z");
    assert.equal(press(" ").prevented, false);
    assert.equal(press("f").prevented, false);
});

test("a scroll, a click or a lost focus ends the labels through the host", () => {
    const { host, state } = fake_host();
    const { window, containers } = fake_window("only");
    start_pick(host, targets_in(window, 3, []), SCHEME);
    state.disturb!();
    assert.equal(containers[0]!.removed, true);
    assert.deepEqual(state.stopped.sort(), ["disturb", "keys"]);
});

test("a second pick ends the first", () => {
    const first = fake_window("first");
    const second = fake_window("second");
    start_pick(fake_host().host, targets_in(first.window, 3, []), SCHEME);
    start_pick(fake_host().host, targets_in(second.window, 3, []), SCHEME);
    assert.equal(first.containers[0]!.removed, true);
    assert.equal(second.containers[0]!.removed, false);
});

test("each action runs its own step on the picked target: act, focus or copy the text", () => {
    for (const [action, result] of [["activate", ["t1"]], ["focus", ["focus t1"]], ["yank", []]] as const) {
        const { host, state, press } = fake_host();
        const acted: string[] = [];
        assert.equal(start_pick(host, targets_in(fake_window("only").window, 3, acted), SCHEME, action), 3);
        press("s");
        assert.deepEqual(acted, result, action);
        assert.deepEqual(state.copied, action === "yank" ? ["text1"] : [], action);
    }
});

test("a yank gives no label to a target with no text", () => {
    const { host, state, press } = fake_host();
    const { window, spans } = fake_window("only");
    assert.equal(start_pick(host, targets_in(window, 3, [], "t", (index) => (index === 1 ? "" : `text${index}`)), SCHEME, "yank"), 2);
    assert.equal(spans.length, 2);
    press("s");
    assert.deepEqual(state.copied, ["text2"]);
});

test("a yank with no text on screen starts nothing", () => {
    const { host, state } = fake_host();
    assert.equal(start_pick(host, targets_in(fake_window("only").window, 2, [], "t", () => ""), SCHEME, "yank"), 0);
    assert.equal(state.key, null);
});

test("focus, activate and yank each run their own act on the picked target", () => {
    for (const [action, result, copied] of [["focus", ["focus t0"], []], ["activate", ["t0"], []], ["yank", [], ["text0"]]] as const) {
        const { host, state, press } = fake_host();
        const acted: string[] = [];
        assert.equal(start_pick(host, targets_in(fake_window("only").window, 2, acted), SCHEME, action), 2);
        press("a");
        assert.deepEqual(acted, result, action);
        assert.deepEqual(state.copied, copied, action);
    }
});

test("a target that left its document (another message loaded) is not acted on", () => {
    const { host, press } = fake_host();
    const { window } = fake_window("only");
    const acted: string[] = [];
    const [target] = targets_in(window, 1, acted);
    (target!.element as { isConnected?: boolean }).isConnected = false;
    start_pick(host, [target!], SCHEME);
    press("a");
    assert.deepEqual(acted, []);
});
