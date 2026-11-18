import assert from "node:assert/strict";
import { test } from "node:test";
import { LIST_ROWS, accepts_single_row, list_shown_after_answer, row_for_click, apply_pick, arrow_target, create_key_queue, cycle_index, enter_text, move_highlight, name_parts, name_width, note_text, prompt_look, read_history, rows_fit_after_wait, settle_latest, shown_highlight, wheel_rows, window_top } from "../src/overlay/line_edit.ts";

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

test("queued keys run in the order they arrive, and done waits for all of them", async () => {
    const order: string[] = [];
    const queue = create_key_queue();
    const slow = queue.add(() => new Promise((resolve) => setTimeout(() => { order.push("tab"); resolve(); }, 5)));
    const failing = queue.add(async () => { order.push("failing tab"); throw new Error("failed"); });
    void queue.add(async () => { order.push("down"); });
    await queue.done();
    order.push("enter");
    await slow;
    await assert.rejects(failing);
    assert.deepEqual(order, ["tab", "failing tab", "down", "enter"]);
});

test("a row key is dropped when the rows still do not fit the line after the wait", async () => {
    let fits = false;
    let waited = 0;
    assert.equal(await rows_fit_after_wait(() => fits, async () => { waited++; }), false);
    assert.equal(await rows_fit_after_wait(() => fits, async () => { waited++; fits = true; }), true);
    assert.equal(await rows_fit_after_wait(() => fits, async () => { waited++; }), true);
    assert.equal(waited, 2);
});

test("the list window moves the least that keeps the selected row inside it", () => {
    assert.equal(window_top(0, 3, 50), 0);
    assert.equal(window_top(0, LIST_ROWS, 50), 1);
    assert.equal(window_top(5, 2, 50), 2);
    assert.equal(window_top(7, -1, 50), 7);
    assert.equal(window_top(30, -1, 12), 2, "a shorter list pulls the window back");
    assert.equal(window_top(4, 0, 3), 0);
});

test("the name column is as wide as the widest visible name, up to 28", () => {
    assert.equal(name_width([]), 0);
    assert.equal(name_width(["tag", "move"]), 4);
    assert.equal(name_width(["x".repeat(40)]), 28);
});

test("the prompt is a caret, a colon or the custom text", () => {
    assert.deepEqual(prompt_look("caret"), { text: "> ", colon: false });
    assert.deepEqual(prompt_look("colon"), { text: ":", colon: true });
    assert.deepEqual(prompt_look("$ "), { text: "$ ", colon: false });
});

test("the note shows a message, else the selected row's usage, else the typed command's, else no match", () => {
    assert.equal(note_text("bad", "u", "t", 2, "x"), "bad");
    assert.equal(note_text(undefined, "u", "t", 2, "x"), "u");
    assert.equal(note_text(undefined, undefined, "t", 2, "x"), "t");
    assert.equal(note_text(undefined, undefined, undefined, 0, "zzz"), "no match");
    assert.equal(note_text(undefined, undefined, undefined, 0, " "), "");
    assert.equal(note_text(undefined, undefined, undefined, 3, "z"), "");
});

test("a wheel notch moves 3 rows and small pixel deltas add up to a row", () => {
    const state = { remainder_px: 0 };
    assert.equal(wheel_rows(state, 1, 1, 20), 3);
    assert.equal(wheel_rows(state, -3, 1, 20), -3);
    assert.equal(wheel_rows(state, 12, 0, 20), 0);
    assert.equal(wheel_rows(state, 12, 0, 20), 1);
    assert.equal(state.remainder_px, 4);
});

test("Enter with the list hidden runs the typed text, not a row of the hidden list", () => {
    const answer = { for_text: "move inb", for_caret: 8, rows: [{ insert: "/Inbox " }], start: 5, end: 8, highlight_first: true };
    assert.equal(enter_text("move inb", 8, answer, -1, false), "move /Inbox ");
    assert.equal(enter_text("move inb", 8, answer, -1, false, false), "move inb");
});

test("an answer that was on its way when Escape hid the list does not show it again", () => {
    assert.equal(list_shown_after_answer(0, 0, false), true, "no Escape since the request");
    assert.equal(list_shown_after_answer(0, 1, false), false, "an Escape since the request");
    assert.equal(list_shown_after_answer(0, 1, true), true);
});

test("a click picks the row it showed, and is dropped when the rows changed", () => {
    const drawn = { rows: [1] };
    assert.equal(row_for_click(drawn, drawn, 0, 1), 0);
    assert.equal(row_for_click(drawn, { rows: [2] }, 0, 1), -1);
    assert.equal(row_for_click(drawn, drawn, 3, 1), -1);
});
