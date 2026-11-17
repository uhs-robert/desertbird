import assert from "node:assert/strict";
import { test } from "node:test";
import { HINT_ALPHABET, hint_labels, labels_matching } from "../src/shared/hint_labels.ts";

test("labels are unique, of one length, drawn from the alphabet and none starts another", () => {
    for (const count of [0, 1, 9, 10, 81, 82, 200]) {
        const labels = hint_labels(count);
        assert.equal(labels.length, count);
        assert.equal(new Set(labels).size, count, `${count} labels are unique`);
        assert.equal(new Set(labels.map((label) => label.length)).size, count === 0 ? 0 : 1);
        assert.ok(labels.every((label) => [...label].every((letter) => HINT_ALPHABET.includes(letter))));
        for (const label of labels) assert.equal(labels.filter((other) => other.startsWith(label)).length, 1, `${label} starts no other label`);
    }
});

test("up to nine targets get one letter and the first label is the first letter of the alphabet", () => {
    assert.deepEqual(hint_labels(3), ["a", "s", "d"]);
    assert.equal(hint_labels(9).every((label) => label.length === 1), true);
    assert.equal(hint_labels(10)[0]!.length, 2);
});

test("the generator takes its alphabet as an argument", () => {
    assert.deepEqual(hint_labels(5, "xy"), ["xxx", "xxy", "xyx", "xyy", "yxx"]);
});

test("labels_matching keeps the labels that start with the typed letters", () => {
    const labels = hint_labels(12);
    assert.deepEqual(labels_matching(labels, "s").length, 9 >= 1 ? labels.filter((label) => label.startsWith("s")).length : 0);
    assert.deepEqual(labels_matching(labels, "zz"), []);
});
