import assert from "node:assert/strict";
import { test } from "node:test";
import { create_matcher } from "../vendor/desertfox/keys/matcher.ts";
import type { MatchResult } from "../vendor/desertfox/keys/matcher.ts";
import { DEFAULT_KEYMAP, compile_default_keymap } from "../src/background/commands/index.ts";

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
        [["."], "repeat.last", "chrome"],
        [["x"], "msg.archive", "background"],
        [["d", "d"], "msg.delete", "background"],
        [["r"], "msg.reply", "background"],
        [["R"], "msg.reply", "background"],
        [["m", "r"], "msg.read", "background"],
        [["m", "u"], "msg.read", "background"],
        [["m", "R"], "folder.read_all", "background"],
        [["m", "s"], "msg.flag", "background"],
        [["m", "j"], "msg.junk", "background"],
        [["m", "z", "l"], "msg.snooze", "background"],
        [["m", "z", "w"], "msg.snooze", "background"],
        [["m", "f", "d"], "msg.remind", "background"],
        [["m", "f", "c"], "msg.remind_cancel", "background"],
        [["g", "F"], "msg.forward", "background"],
        [["g", "u"], "msg.unsubscribe", "background"],
        [["c"], "msg.new", "background"],
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
    assert.equal(type_keys("d", "w").kind_, "no_match");
});

test("the tree survives the structured clone the Experiment boundary applies", () => {
    const root = compiled.modes.normal;
    assert.deepEqual(JSON.parse(JSON.stringify(root)), root);
});

// The phase 2 groups bind these chords. Until they land, the test adds each one to the default keymap as a motion, so the compile runs with the real command lookup.
test("the keymap compile accepts the bound chords and the matcher reads each one as a first key", () => {
    const chords = ["<C-o>", "<C-i>", "<C-l>", "<C-j>", "<C-k>", "<C-x>", "<C-c>", "<C-h>"];
    const default_normal = DEFAULT_KEYMAP.normal!;
    DEFAULT_KEYMAP.normal = { ...default_normal, ...Object.fromEntries(chords.map((chord) => [chord, { id: "motion.down" }])) };
    try {
        const result = compile_default_keymap();
        assert.deepEqual(result.warnings, []);
        const matcher = create_matcher(result.compiled);
        for (const chord of chords) assert.equal(matcher.feed("normal", chord).kind_, "match", chord);
    } finally {
        DEFAULT_KEYMAP.normal = default_normal;
    }
});

test("the command line opener is unrepeatable", async () => {
    const { UNREPEATABLE_IDS } = await import("../src/background/commands/index.ts");
    assert.deepEqual([...UNREPEATABLE_IDS].sort(), ["cmdline.open", "msg.archive", "msg.delete", "msg.move", "msg.remind", "msg.remind_cancel", "msg.reply_with", "msg.snooze", "msg.undo", "msg.unsubscribe", "notify.toggle"]);
});

test("mark_unrepeatable tags the steps of delete, archive and move and no other", async () => {
    const { mark_unrepeatable } = await import("../src/background/config/keymap.ts");
    const step = (id: string) => ({ invocation: { id } });
    const root = {
        kind: "branch",
        children: {
            x: { kind: "leaf", steps: [step("msg.archive")] },
            d: { kind: "branch", children: { d: { kind: "leaf", steps: [step("msg.delete")] } } },
            m: { kind: "leaf", steps: [step("msg.move")], otherwise: { kind: "leaf", steps: [step("msg.delete")] } },
            r: { kind: "leaf", steps: [step("msg.read")] },
        },
    };
    mark_unrepeatable(root);
    const flags = (node: { steps: object[] }) => node.steps.map((entry) => (entry as { repeatable?: boolean }).repeatable);
    assert.deepEqual(flags(root.children.x), [false]);
    assert.deepEqual(flags(root.children.d.children.d), [false]);
    assert.deepEqual(flags(root.children.m), [false]);
    assert.deepEqual(flags(root.children.m.otherwise), [false]);
    assert.deepEqual(flags(root.children.r), [undefined]);
});
