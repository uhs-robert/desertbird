import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_pick, move_highlight, name_parts } from "../src/overlay/line_edit.ts";

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
