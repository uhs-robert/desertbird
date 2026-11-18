import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { end_pick, start_pick } from "../src/chrome/hint_pick.ts";
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
    const state = { key: null as null | ((event: PickKeyEvent) => void), disturb: null as null | (() => void), stopped: [] as string[] };
    const host: PickHost = {
        on_key: (listener) => ((state.key = listener), () => void state.stopped.push("keys")),
        on_disturb: (listener) => ((state.disturb = listener), () => void state.stopped.push("disturb")),
    };
    const press = (key: string, chord: Partial<PickKeyEvent> = {}) => {
        const seen = { prevented: false, stopped: false };
        state.key!({ key, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => void (seen.prevented = true), stopPropagation: () => void (seen.stopped = true), ...chord });
        return seen;
    };
    return { host, state, press };
}

function targets_in(window: HintWindow, count: number, acted: string[], prefix = "t"): PickTarget[] {
    return Array.from({ length: count }, (_, index) => ({ window, element: { getBoundingClientRect: () => ({ top: index * 20, left: 5, width: 30, height: 10 }) } as never, act: () => void acted.push(`${prefix}${index}`) }));
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

test("a key no label continues with, a chord and Escape end the labels and act on nothing, and a lone modifier does not", () => {
    for (const [key, chord, ends] of [["z", {}, true], ["Escape", {}, true], ["a", { ctrlKey: true }, true], ["Shift", {}, false], ["Tab", {}, true]] as const) {
        const { host, state, press } = fake_host();
        const { window, containers } = fake_window("only");
        const acted: string[] = [];
        start_pick(host, targets_in(window, 12, acted), SCHEME);
        const seen = press(key, chord);
        assert.equal(seen.prevented && seen.stopped, true, key);
        assert.equal(containers[0]!.removed, ends, key);
        assert.equal(state.stopped.length > 0, ends, key);
        assert.deepEqual(acted, []);
        end_pick();
    }
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
