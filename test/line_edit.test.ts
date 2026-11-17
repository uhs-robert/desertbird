import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_pick, arrow_target, cycle_index, move_highlight, name_parts, read_history } from "../src/overlay/line_edit.ts";

test("a pick replaces its span and puts the caret after the insert", () => {
    assert.deepEqual(apply_pick("ta", { start: 0, end: 2, insert: "tag " }), { text: "tag ", caret: 4 });
    assert.deepEqual(apply_pick("filter --u now", { start: 7, end: 10, insert: "--unread " }), { text: "filter --unread  now", caret: 16 });
});

test("the highlight starts from the first or the last row and stops at the ends", () => {
    assert.equal(move_highlight(-1, 1, 3), 0);
    assert.equal(move_highlight(-1, -1, 3), 2);
    assert.equal(move_highlight(2, 1, 3), 2);
    assert.equal(move_highlight(0, -1, 3), 0);
    assert.equal(move_highlight(1, 1, 3), 2);
    assert.equal(move_highlight(0, 1, 0), -1);
});

test("a name splits at the matched letters", () => {
    assert.deepEqual(name_parts("msg.tag", [0, 4]), [
        { text: "m", matched: true },
        { text: "sg.", matched: false },
        { text: "t", matched: true },
        { text: "ag", matched: false },
    ]);
    assert.deepEqual(name_parts("tag", []), [{ text: "tag", matched: false }]);
});

test("Up and Down walk the history on a fresh line or with no rows, and the highlight otherwise", () => {
    assert.equal(arrow_target(true, 5), "history");
    assert.equal(arrow_target(true, 0), "history");
    assert.equal(arrow_target(false, 0), "history");
    assert.equal(arrow_target(false, 5), "highlight");
});

test("two C-n presses preview the second row, and C-p goes back", () => {
    const rows = ["--unread ", "--all ", "--starred "];
    const preview = (index: number) => apply_pick("filter ", { start: 7, end: 7, insert: rows[index]! }).text;
    let current = cycle_index(-1, 1, rows.length);
    assert.equal(preview(current), "filter --unread ");
    current = cycle_index(current, 1, rows.length);
    assert.equal(preview(current), "filter --all ");
    current = cycle_index(current, -1, rows.length);
    assert.equal(preview(current), "filter --unread ");
    assert.equal(cycle_index(0, -1, 3), 2);
    assert.equal(cycle_index(2, 1, 3), 0);
    assert.equal(cycle_index(-1, -1, 3), 2);
    assert.equal(cycle_index(-1, 1, 0), -1);
});

test("a history read that rejects or holds odd data gives an empty list", async () => {
    assert.deepEqual(await read_history(() => Promise.reject(new Error("storage closed"))), []);
    assert.deepEqual(await read_history(async () => ({ bad: true })), []);
    assert.deepEqual(await read_history(async () => ["a", 3, "b"]), ["a", "b"]);
});
