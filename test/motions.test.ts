import assert from "node:assert/strict";
import { test } from "node:test";
import { MOTION_IDS, run_motion } from "../src/chrome/motions.ts";
import type { ViewPort } from "../src/chrome/motions.ts";

function fake_port(rows: number, selected = -1): ViewPort & { selected: number; selects: number[] } {
    const port = {
        selected,
        selects: [] as number[],
        row_count: () => rows,
        selected_index: () => port.selected,
        select(index: number) {
            port.selected = index;
            port.selects.push(index);
        },
    };
    return port;
}

test("the motion ids are exactly the four of the plan", () => {
    assert.deepEqual([...MOTION_IDS].sort(), ["motion.bottom", "motion.down", "motion.top", "motion.up"]);
});

test("down and up move one row and clamp at the ends", () => {
    const port = fake_port(5, 3);
    run_motion("motion.down", port, undefined);
    assert.equal(port.selected, 4);
    run_motion("motion.down", port, undefined);
    assert.equal(port.selected, 4);
    run_motion("motion.up", port, 99);
    assert.equal(port.selected, 0);
    run_motion("motion.up", port, undefined);
    assert.equal(port.selected, 0);
});

test("a count moves that many rows", () => {
    const port = fake_port(20, 2);
    run_motion("motion.down", port, 5);
    assert.equal(port.selected, 7);
    run_motion("motion.up", port, 3);
    assert.equal(port.selected, 4);
});

test("a clamped motion does not select again", () => {
    const port = fake_port(3, 2);
    run_motion("motion.down", port, 4);
    run_motion("motion.bottom", port, undefined);
    assert.deepEqual(port.selects, []);
});

test("with nothing selected, down picks the first row and up stays on it", () => {
    const down = fake_port(4);
    run_motion("motion.down", down, undefined);
    assert.equal(down.selected, 0);
    const up = fake_port(4);
    run_motion("motion.up", up, undefined);
    assert.equal(up.selected, 0);
});

test("top and bottom go to the first and last row", () => {
    const port = fake_port(10, 4);
    run_motion("motion.bottom", port, undefined);
    assert.equal(port.selected, 9);
    run_motion("motion.top", port, undefined);
    assert.equal(port.selected, 0);
});

test("top and bottom with a count go to that row, counted from 1, and clamp", () => {
    const port = fake_port(10, 4);
    run_motion("motion.top", port, 3);
    assert.equal(port.selected, 2);
    run_motion("motion.bottom", port, 7);
    assert.equal(port.selected, 6);
    run_motion("motion.bottom", port, 500);
    assert.equal(port.selected, 9);
});

test("an empty list takes no motion", () => {
    for (const id of MOTION_IDS) {
        const port = fake_port(0);
        run_motion(id, port, 3);
        assert.deepEqual(port.selects, [], id);
    }
});

test("a list of one row stays on its row", () => {
    const port = fake_port(1, 0);
    for (const id of MOTION_IDS) run_motion(id, port, undefined);
    assert.equal(port.selected, 0);
    assert.deepEqual(port.selects, []);
});

test("an unknown id runs nothing and reports false", () => {
    const port = fake_port(5, 2);
    assert.equal(run_motion("motion.sideways", port, 1), false);
    assert.equal(run_motion("toString", port, 1), false);
    assert.equal(run_motion("motion.down", port, 1), true);
    assert.deepEqual(port.selects, [3]);
});
