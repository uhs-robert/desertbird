import assert from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_LIMIT, apply_pick, create_history_cursor, move_highlight, name_parts, record_entry } from "../src/overlay/line_edit.ts";

test("a pick replaces its span and puts the caret after the insert", () => {
    assert.deepEqual(apply_pick("ta", { start: 0, end: 2, insert: "tag " }), { text: "tag ", caret: 4 });
    assert.deepEqual(apply_pick("filter --u now", { start: 7, end: 10, insert: "--unread " }), { text: "filter --unread  now", caret: 16 });
});

test("the highlight wraps and starts from the first or the last row", () => {
    assert.equal(move_highlight(-1, 1, 3), 0);
    assert.equal(move_highlight(-1, -1, 3), 2);
    assert.equal(move_highlight(2, 1, 3), 0);
    assert.equal(move_highlight(0, -1, 3), 2);
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

test("the history cursor walks back, then forward to the draft", () => {
    const cursor = create_history_cursor(["a", "b"]);
    assert.equal(cursor.newer(), undefined);
    assert.equal(cursor.older("draft"), "b");
    assert.equal(cursor.older("b"), "a");
    assert.equal(cursor.older("a"), undefined);
    assert.equal(cursor.newer(), "b");
    assert.equal(cursor.newer(), "draft");
    assert.equal(cursor.newer(), undefined);
});

test("an empty history has nothing to step to", () => {
    assert.equal(create_history_cursor([]).older("x"), undefined);
});

test("a recorded line moves to the newest place, blanks are skipped and the oldest fall off", () => {
    assert.deepEqual(record_entry(["a", "b"], "a"), ["b", "a"]);
    assert.deepEqual(record_entry(["a"], "  "), ["a"]);
    assert.deepEqual(record_entry(["a"], " b "), ["a", "b"]);
    const full = Array.from({ length: HISTORY_LIMIT }, (_, index) => `c${index}`);
    const grown = record_entry(full, "new");
    assert.equal(grown.length, HISTORY_LIMIT);
    assert.equal(grown[0], "c1");
    assert.equal(grown.at(-1), "new");
});
