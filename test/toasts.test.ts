import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TOASTS, create_toasts } from "../src/background/hud/toasts.ts";
import { fake_timers } from "./hud_fakes.ts";

function setup() {
    const timers = fake_timers();
    let changes = 0;
    return { timers, toasts: create_toasts(timers, () => void changes++), changes: () => changes };
}

test("a toast shows at once and is gone after its own time", () => {
    const { timers, toasts, changes } = setup();
    toasts.show("Saved", false, 3000);
    assert.deepEqual(toasts.list(), [{ id: 1, text: "Saved", is_error: false }]);
    timers.advance(2999);
    assert.equal(toasts.list().length, 1);
    timers.advance(1);
    assert.deepEqual(toasts.list(), []);
    assert.equal(changes(), 2);
});

test("toasts stack in order and each expires on its own clock", () => {
    const { timers, toasts } = setup();
    toasts.show("first", false, 3000);
    timers.advance(1000);
    toasts.show("second", true, 6000);
    assert.deepEqual(toasts.list().map((toast) => toast.text), ["first", "second"]);
    timers.advance(2000);
    assert.deepEqual(toasts.list().map((toast) => toast.text), ["second"]);
    assert.equal(toasts.list()[0]?.is_error, true);
    timers.advance(5000);
    assert.deepEqual(toasts.list(), []);
});

test("a burst past the cap pushes the oldest out and leaves no timer behind for it", () => {
    const { timers, toasts } = setup();
    for (let index = 0; index <= MAX_TOASTS; index++) toasts.show(`t${index}`, false, 1000);
    assert.equal(toasts.list().length, MAX_TOASTS);
    assert.equal(toasts.list()[0]?.text, "t1");
    assert.equal(timers.pending(), MAX_TOASTS);
});

test("clear drops every toast and its timer", () => {
    const { timers, toasts } = setup();
    toasts.show("a", false, 1000);
    toasts.show("b", true, 1000);
    toasts.clear();
    assert.deepEqual(toasts.list(), []);
    assert.equal(timers.pending(), 0);
});

test("a toast can be dismissed before its time and its timer goes with it", () => {
    const { timers, toasts } = setup();
    const id = toasts.show("a", false, 1000);
    toasts.dismiss(id);
    toasts.dismiss(id);
    assert.deepEqual(toasts.list(), []);
    assert.equal(timers.pending(), 0);
});
