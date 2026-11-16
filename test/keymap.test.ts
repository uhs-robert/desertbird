import assert from "node:assert/strict";
import { test } from "node:test";
import { create_matcher } from "../vendor/desertfox/keys/matcher.ts";
import type { MatchResult } from "../vendor/desertfox/keys/matcher.ts";
import { compile_default_keymap } from "../src/background/default_keymap.ts";

const { compiled, warnings } = compile_default_keymap();

function type_keys(...tokens: string[]): MatchResult {
    const matcher = create_matcher(compiled);
    let result: MatchResult = { kind_: "no_match" };
    for (const token of tokens) result = matcher.feed("normal", token);
    return result;
}

function matched_step(...tokens: string[]) {
    const result = type_keys(...tokens);
    assert.equal(result.kind_, "match", `${tokens.join(" ")} must match`);
    if (result.kind_ !== "match") throw new Error("unreachable");
    return { step: result.leaf.steps[0], count: result.count };
}

test("the default keymap compiles without a warning", () => {
    assert.deepEqual(warnings, []);
});

test("each default key reaches its command with the side that runs it", () => {
    const expected: [string[], string, string][] = [
        [["j"], "motion.down", "chrome"],
        [["k"], "motion.up", "chrome"],
        [["g", "g"], "motion.top", "chrome"],
        [["G"], "motion.bottom", "chrome"],
        [["x"], "msg.archive", "background"],
        [["d", "d"], "msg.delete", "background"],
        [["r"], "msg.reply", "background"],
    ];
    for (const [tokens, id, runs_in] of expected) {
        const { step } = matched_step(...tokens);
        assert.equal(step?.invocation.id, id);
        assert.equal(step?.runs_in, runs_in);
    }
});

test("r carries the reply target", () => {
    assert.deepEqual(matched_step("r").step?.invocation.args, { to: "sender" });
});

test("a count prefix reaches the matcher", () => {
    const { step, count } = matched_step("3", "j");
    assert.equal(step?.invocation.id, "motion.down");
    assert.equal(count, 3);
});

test("a lone g is pending, and a reset forgets it", () => {
    const matcher = create_matcher(compiled);
    assert.equal(matcher.feed("normal", "g").kind_, "pending");
    matcher.reset();
    assert.equal(matcher.feed("normal", "g").kind_, "pending");
    assert.equal(matcher.feed("normal", "g").kind_, "match");
});

// The matcher gives a key that breaks a half-typed sequence one more try as a first key. So d then x never reaches msg.delete, and x then runs as the archive key.
test("d then x drops the stray d and reads x as a first key", () => {
    const { step } = matched_step("d", "x");
    assert.equal(step?.invocation.id, "msg.archive");
});

test("d then an unbound key matches nothing", () => {
    assert.equal(type_keys("d", "q").kind_, "no_match");
});

test("the tree survives the structured clone the Experiment boundary applies", () => {
    const root = compiled.modes.normal;
    assert.deepEqual(JSON.parse(JSON.stringify(root)), root);
});
