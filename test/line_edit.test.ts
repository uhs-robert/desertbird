import assert from "node:assert/strict";
import { test } from "node:test";
import { accepts_single_row, apply_pick, arrow_target, cycle_index, enter_text, move_highlight, name_parts, read_history, settle_latest, shown_highlight } from "../src/overlay/line_edit.ts";

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

test("the first row is shown highlighted only when the completion asks for it", () => {
    assert.equal(shown_highlight(-1, 3, true), 0);
    assert.equal(shown_highlight(-1, 3, undefined), -1);
    assert.equal(shown_highlight(-1, 0, true), -1);
    assert.equal(shown_highlight(2, 3, true), 2);
});

const answer_for = (for_text: string, for_caret: number, extra: object = {}) => ({ for_text, for_caret, rows: [{ insert: "/Projects " }, { insert: "/Projects/2026 " }], start: 5, end: for_text.length, highlight_first: true, ...extra });

test("Enter swaps the typed word for the first row, unless a preview already did", () => {
    assert.equal(enter_text("move proj", 9, answer_for("move proj", 9), -1, false), "move /Projects ");
    assert.equal(enter_text("move /Projects ", 15, answer_for("move proj", 9), -1, true), "move /Projects ");
});

test("Enter ignores an answer for older text or another caret", () => {
    // Fast `o inb` Enter: the answer for `o i` must not splice into `open inb`.
    assert.equal(enter_text("open inb", 8, answer_for("open i", 6), -1, false), "open inb");
    // Tab then a fast Enter: the answer for `move proj` must not splice into `move /Projects `.
    assert.equal(enter_text("move /Projects ", 15, answer_for("move proj", 9), -1, false), "move /Projects ");
    assert.equal(enter_text("move arc", 8, answer_for("move pro", 8), -1, false), "move arc");
    assert.equal(enter_text("move proj", 5, answer_for("move proj", 9), -1, false), "move proj");
});

test("Enter takes a row reached with Down even when the completion did not highlight the first", () => {
    const answer = answer_for("move /Archive", 13, { highlight_first: undefined });
    assert.equal(enter_text("move /Archive", 13, answer, -1, false), "move /Archive");
    assert.equal(enter_text("move /Archive", 13, answer, 1, false), "move /Projects/2026 ");
});

test("settle_latest waits for a refresh started while it waited", async () => {
    const order: string[] = [];
    let latest: Promise<void> = new Promise((resolve) => setTimeout(() => { order.push("first"); resolve(); }, 5));
    const first = latest;
    first.then(() => { latest = new Promise((resolve) => setTimeout(() => { order.push("second"); resolve(); }, 5)); }).catch(() => undefined);
    await settle_latest(() => latest);
    assert.deepEqual(order, ["first", "second"]);
    const failed = Promise.reject(new Error("failed"));
    await settle_latest(() => failed);
});

test("a single row is accepted only while no row is selected", () => {
    assert.equal(accepts_single_row(1, -1), true);
    assert.equal(accepts_single_row(1, 0), false);
    assert.equal(accepts_single_row(2, -1), false);
    assert.equal(accepts_single_row(0, -1), false);
});
